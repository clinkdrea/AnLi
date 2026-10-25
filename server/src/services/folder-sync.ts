// 案件文件夹同步：扫描磁盘目录，将新增文件入库、磁盘已删除的记录出库
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/schema.js';
import { caseDir } from './settings.js';
import { guessMime } from './mime.js';

const SKIP_NAMES = new Set(['Thumbs.db', '_案件元数据.json']);

// 过滤系统/隐藏文件：. 开头（含 .DS_Store/.Spotlight-V100/.fseventsd）、AppleDouble(._*)、
// Office 临时文件(~$*)、macOS 压缩残留(__MACOSX)、自定义图标(Icon\r)
function shouldSkip(name: string): boolean {
  if (!name || name === '.' || name === '..') return true;
  if (name.startsWith('.')) return true;
  if (name.startsWith('__MACOSX')) return true;
  if (name.startsWith('~$')) return true;
  if (name === 'Icon\r') return true;
  return SKIP_NAMES.has(name);
}

// 递归收集目录内的文件相对路径（POSIX 分隔符 + NFC 归一化）
function walk(dir: string, base: string, out: string[]) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (shouldSkip(ent.name)) continue;
    const full = path.join(dir, ent.name);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(full); // 用 lstat 避免跟随软链接
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      walk(full, base, out);
      continue;
    }
    if (!st.isFile()) continue;
    const rel = path.relative(base, full).split(path.sep).join('/').normalize('NFC');
    out.push(rel);
  }
}

export interface SyncResult {
  added: number;
  removed: number;
  updated: number;
  skipped: boolean;
}

// 同步单个案件的文件夹与 file_records 表
// 目录不存在时整案跳过且不删除任何记录（防止网盘未挂载导致清空）
export function syncCaseFolder(caseRow: { id: number; folder_path: string }): SyncResult {
  const dir = caseDir(caseRow.folder_path);
  if (!fs.existsSync(dir)) return { added: 0, removed: 0, updated: 0, skipped: true };

  const rels: string[] = [];
  walk(dir, dir, rels);
  const onDisk = new Set(rels);

  const existing = db.prepare('SELECT id, rel_path, size FROM file_records WHERE case_id = ?')
    .all(caseRow.id) as { id: number; rel_path: string; size: number }[];
  const byRel = new Map(existing.map((r) => [String(r.rel_path).normalize('NFC'), r]));

  let added = 0;
  let removed = 0;
  let updated = 0;

  const ins = db.prepare(
    `INSERT INTO file_records (case_id, rel_path, file_name, mime_type, size, category, uploaded_by)
     VALUES (?, ?, ?, ?, ?, 'file', NULL)`
  );
  const upd = db.prepare('UPDATE file_records SET size = ?, mime_type = ?, file_name = ? WHERE id = ?');
  const del = db.prepare('DELETE FROM file_records WHERE id = ?');

  db.exec('BEGIN');
  try {
    for (const rel of rels) {
      const full = path.join(dir, ...rel.split('/'));
      let st: fs.Stats;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      const name = path.basename(rel);
      const mime = guessMime(name, null);
      const ex = byRel.get(rel);
      if (!ex) {
        ins.run(caseRow.id, rel, name, mime, st.size);
        added++;
      } else if (ex.size !== st.size) {
        upd.run(st.size, mime, name, ex.id);
        updated++;
      }
    }
    for (const r of existing) {
      if (!onDisk.has(String(r.rel_path).normalize('NFC'))) {
        del.run(r.id);
        removed++;
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return { added, removed, updated, skipped: false };
}
