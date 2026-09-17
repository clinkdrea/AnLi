import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { db } from '../db/schema.js';
import { isCaseMember } from '../plugins/auth.js';
import { logAudit } from '../services/audit.js';

// 证据文件统一存放在案件文件夹的 evidence 子目录下
function evidenceDir(caseId: number) {
  const caseRow = db.prepare('SELECT folder_path FROM cases WHERE id = ?').get(caseId) as any;
  const dir = path.join(caseRow.folder_path, 'evidence');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// 防覆盖命名
function uniquePath(dir: string, fileName: string) {
  const safe = path.basename(fileName).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
  let dest = path.join(dir, safe);
  let n = 1;
  while (fs.existsSync(dest)) {
    const ext = path.extname(safe);
    dest = path.join(dir, `${path.basename(safe, ext)}_${n}${ext}`);
    n++;
  }
  return dest;
}

// 保存 multipart 中的文件 parts，返回写入的 file_records id 列表
async function saveEvidenceFiles(req: any, caseId: number, dir: string): Promise<number[]> {
  const ids: number[] = [];
  const parts = req.parts();
  for await (const part of parts) {
    if (part.type === 'file') {
      const dest = uniquePath(dir, part.filename);
      await pipeline(part.file, fs.createWriteStream(dest));
      const stat = fs.statSync(dest);
      const info = db.prepare(
        `INSERT INTO file_records (case_id, rel_path, file_name, mime_type, size, category, uploaded_by)
         VALUES (?, ?, ?, ?, ?, 'evidence', ?)`
      ).run(caseId, path.join('evidence', path.basename(dest)), path.basename(dest), part.mimetype, stat.size, req.user!.id);
      ids.push(Number(info.lastInsertRowid));
    }
  }
  return ids;
}

export default async function evidenceRoutes(app: FastifyInstance) {
  // 证据列表（含分组、文件列表）
  app.get('/api/cases/:id/evidences', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const evidences = db.prepare(
      `SELECT e.*, f.file_name FROM evidences e
       LEFT JOIN file_records f ON e.file_id = f.id
       WHERE e.case_id = ? ORDER BY (e.group_name IS NULL), e.group_name, e.id`
    ).all(cid) as any[];
    const files = db.prepare(
      `SELECT ef.evidence_id, fr.id, fr.file_name, fr.mime_type, fr.size, fr.ocr_status, fr.ocr_text
       FROM evidence_files ef JOIN file_records fr ON ef.file_id = fr.id
       WHERE fr.case_id = ? ORDER BY ef.id`
    ).all(cid) as any[];
    const fileMap = new Map<number, any[]>();
    for (const f of files) {
      const list = fileMap.get(f.evidence_id) || [];
      list.push(f);
      fileMap.set(f.evidence_id, list);
    }
    evidences.forEach((e) => {
      e.files = fileMap.get(e.id) || [];
    });
    return { evidences };
  });

  // 新建证据（multipart：表单字段 + 可选多文件）
  app.post('/api/cases/:id/evidences', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    if (!db.prepare('SELECT id FROM cases WHERE id = ?').get(cid)) {
      return reply.status(404).send({ error: '案件不存在' });
    }

    // 收集字段（multipart field parts）
    const fields: Record<string, string> = {};
    const fileIds: number[] = [];
    let dir = '';
    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === 'field') {
        fields[(part as any).fieldname] = (part as any).value;
      } else if (part.type === 'file') {
        if (!dir) dir = evidenceDir(cid);
        const dest = uniquePath(dir, part.filename);
        await pipeline(part.file, fs.createWriteStream(dest));
        const stat = fs.statSync(dest);
        const info = db.prepare(
          `INSERT INTO file_records (case_id, rel_path, file_name, mime_type, size, category, uploaded_by)
           VALUES (?, ?, ?, ?, ?, 'evidence', ?)`
        ).run(cid, path.join('evidence', path.basename(dest)), path.basename(dest), part.mimetype, stat.size, req.user!.id);
        fileIds.push(Number(info.lastInsertRowid));
      }
    }

    const name = (fields.name || '').trim();
    if (!name) return reply.status(400).send({ error: '证据名称必填' });

    const info = db.prepare(
      `INSERT INTO evidences (case_id, group_name, name, source, purpose, remark)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      cid,
      (fields.group_name || '').trim() || null,
      name,
      fields.source || null,
      fields.purpose || null,
      fields.remark || null
    );
    const eid = Number(info.lastInsertRowid);
    const ins = db.prepare('INSERT INTO evidence_files (evidence_id, file_id) VALUES (?, ?)');
    for (const fid of fileIds) ins.run(eid, fid);
    logAudit(req.user!.id, 'evidence_create', 'evidence', eid, `${cid}/${name} files=${fileIds.length}`);
    return reply.status(201).send({ id: eid, file_count: fileIds.length });
  });

  // 编辑证据元信息
  app.put('/api/evidences/:eid', async (req, reply) => {
    const eid = Number((req.params as any).eid);
    const ev = db.prepare('SELECT * FROM evidences WHERE id = ?').get(eid) as any;
    if (!ev) return reply.status(404).send({ error: '证据不存在' });
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, ev.case_id)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const { group_name, name, source, purpose, remark } = req.body as any;
    db.prepare(
      `UPDATE evidences SET group_name=?, name=?, source=?, purpose=?, remark=? WHERE id=?`
    ).run((group_name || '').trim() || null, name, source || null, purpose || null, remark || null, eid);
    return { ok: true };
  });

  // 给已有证据追加文件（多选）
  app.post('/api/evidences/:eid/files', async (req, reply) => {
    const eid = Number((req.params as any).eid);
    const ev = db.prepare('SELECT * FROM evidences WHERE id = ?').get(eid) as any;
    if (!ev) return reply.status(404).send({ error: '证据不存在' });
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, ev.case_id)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const dir = evidenceDir(ev.case_id);
    const fileIds = await saveEvidenceFiles(req, ev.case_id, dir);
    const ins = db.prepare('INSERT INTO evidence_files (evidence_id, file_id) VALUES (?, ?)');
    for (const fid of fileIds) ins.run(eid, fid);
    logAudit(req.user!.id, 'evidence_upload', 'evidence', eid, `files=${fileIds.length}`);
    return reply.status(201).send({ count: fileIds.length });
  });

  // 删除证据的单个文件
  app.delete('/api/evidences/:eid/files/:fid', async (req, reply) => {
    const eid = Number((req.params as any).eid);
    const fid = Number((req.params as any).fid);
    const ev = db.prepare('SELECT * FROM evidences WHERE id = ?').get(eid) as any;
    if (!ev) return reply.status(404).send({ error: '证据不存在' });
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, ev.case_id)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const link = db.prepare('SELECT id FROM evidence_files WHERE evidence_id=? AND file_id=?').get(eid, fid);
    if (!link) return reply.status(404).send({ error: '文件不属于该证据' });
    const file = db.prepare('SELECT * FROM file_records WHERE id=?').get(fid) as any;
    const caseRow = db.prepare('SELECT folder_path FROM cases WHERE id=?').get(ev.case_id) as any;
    const full = path.join(caseRow.folder_path, file.rel_path);
    if (fs.existsSync(full)) fs.unlinkSync(full);
    db.prepare('DELETE FROM evidence_files WHERE id=?').run((link as any).id);
    db.prepare('DELETE FROM file_records WHERE id=?').run(fid);
    return { ok: true };
  });

  // 删除证据（同时删除关联文件记录与磁盘文件）
  app.delete('/api/evidences/:eid', async (req, reply) => {
    const eid = Number((req.params as any).eid);
    const ev = db.prepare('SELECT * FROM evidences WHERE id = ?').get(eid) as any;
    if (!ev) return reply.status(404).send({ error: '证据不存在' });
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, ev.case_id)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const caseRow = db.prepare('SELECT folder_path FROM cases WHERE id=?').get(ev.case_id) as any;
    const links = db.prepare('SELECT file_id FROM evidence_files WHERE evidence_id=?').all(eid) as any[];
    for (const lk of links) {
      const file = db.prepare('SELECT rel_path FROM file_records WHERE id=?').get(lk.file_id) as any;
      if (file) {
        const full = path.join(caseRow.folder_path, file.rel_path);
        if (fs.existsSync(full)) fs.unlinkSync(full);
        db.prepare('DELETE FROM file_records WHERE id=?').run(lk.file_id);
      }
    }
    db.prepare('DELETE FROM evidences WHERE id=?').run(eid);
    logAudit(req.user!.id, 'evidence_delete', 'evidence', eid, ev.name);
    return { ok: true };
  });
}
