import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/schema.js';
import { resolveTemplatesRoot } from './settings.js';

// 支持的模板文件扩展名
const ALLOWED_EXTS = new Set(['.docx', '.doc', '.pdf', '.wps', '.txt', '.dot', '.dotx', '.xlsx', '.xls']);

interface ScanResult {
  added: number;
  updated: number;
  removed: number;
  total: number;
  error?: string;
}

// 递归收集模板文件
function walk(dir: string, results: string[] = []): string[] {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.startsWith('~$')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, results);
    } else if (ALLOWED_EXTS.has(path.extname(entry.name).toLowerCase())) {
      results.push(full);
    }
  }
  return results;
}

// 扫描模板目录并入库（按 file_path 去重）
export function scanTemplates(): ScanResult {
  const root = resolveTemplatesRoot();
  // 路径不存在（如网盘未挂载）时不扫描、不删除记录，避免误清空模板库
  if (!fs.existsSync(root)) {
    return { added: 0, updated: 0, removed: 0, total: 0, error: '文书模板路径不存在或未挂载' };
  }
  const files = walk(root);
  let added = 0;
  let updated = 0;

  const selectStmt = db.prepare('SELECT id, name, category, category_path FROM templates WHERE file_path = ?');
  const insertStmt = db.prepare(
    `INSERT INTO templates (name, category, category_path, file_path, is_file, content)
     VALUES (?, ?, ?, ?, 1, '')`
  );
  const updateStmt = db.prepare(
    'UPDATE templates SET name = ?, category = ?, category_path = ? WHERE id = ?'
  );

  const currentPaths = new Set<string>();

  for (const full of files) {
    const relPath = path.relative(root, full);
    currentPaths.add(relPath);

    const ext = path.extname(full);
    const baseName = path.basename(full, ext); // 文件名（不含扩展名）即模板名
    const relDir = path.dirname(relPath);      // 相对目录
    const parts = relDir.split(path.sep);
    // 分类显示：取最后一级子文件夹（如 判决书）；若只有一级则用一级
    const category = parts[parts.length - 1] && parts[parts.length - 1] !== '.' ? parts[parts.length - 1] : '未分类';
    const categoryPath = relDir === '.' ? '' : relDir;

    const existing = selectStmt.get(relPath) as any;
    if (existing) {
      if (existing.name !== baseName || existing.category !== category || existing.category_path !== categoryPath) {
        updateStmt.run(baseName, category, categoryPath, existing.id);
        updated++;
      }
    } else {
      insertStmt.run(baseName, category, categoryPath, relPath);
      added++;
    }
  }

  // 清理磁盘上已删除的文件型模板记录
  const dbFiles = db.prepare("SELECT id, file_path FROM templates WHERE is_file = 1").all() as { id: number; file_path: string }[];
  let removed = 0;
  const deleteStmt = db.prepare('DELETE FROM templates WHERE id = ?');
  for (const f of dbFiles) {
    if (!currentPaths.has(f.file_path)) {
      deleteStmt.run(f.id);
      removed++;
    }
  }

  return { added, updated, removed, total: files.length };
}

// 获取模板根目录绝对路径（供"打开文件夹"功能使用）
export function getTemplatesDir(): string {
  return resolveTemplatesRoot();
}
