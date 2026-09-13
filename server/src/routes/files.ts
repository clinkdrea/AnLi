import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { db, TEMPLATES_DIR } from '../db/schema.js';
import { isCaseMember } from '../plugins/auth.js';
import { logAudit } from '../services/audit.js';
import { triggerOCR } from '../services/ocr.js';

export default async function fileRoutes(app: FastifyInstance) {
  // 文件列表
  app.get('/api/cases/:id/files', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const files = db.prepare(
      `SELECT f.*, u.name as uploader_name FROM file_records f
       LEFT JOIN users u ON f.uploaded_by = u.id
       WHERE f.case_id = ? ORDER BY f.created_at DESC`
    ).all(cid);
    return { files };
  });

  // 上传文件（multipart）
  app.post('/api/cases/:id/files', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const caseRow = db.prepare('SELECT folder_path FROM cases WHERE id = ?').get(cid) as any;
    if (!caseRow) return reply.status(404).send({ error: '案件不存在' });

    const parts = req.parts();
    const uploaded: any[] = [];
    for await (const part of parts) {
      if (part.type === 'file') {
        const safeName = path.basename(part.filename).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
        const destPath = path.join(caseRow.folder_path, safeName);
        // 防止覆盖：若已存在则加序号
        let finalPath = destPath;
        let counter = 1;
        while (fs.existsSync(finalPath)) {
          const ext = path.extname(safeName);
          const base = path.basename(safeName, ext);
          finalPath = path.join(caseRow.folder_path, `${base}_${counter}${ext}`);
          counter++;
        }
        await pipeline(part.file, fs.createWriteStream(finalPath));
        const stat = fs.statSync(finalPath);
        const info = db.prepare(
          `INSERT INTO file_records (case_id, rel_path, file_name, mime_type, size, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(cid, path.basename(finalPath), path.basename(finalPath), part.mimetype, stat.size, req.user!.id);
        const fid = Number(info.lastInsertRowid);
        logAudit(req.user!.id, 'file_upload', 'file', fid, `${cid}/${path.basename(finalPath)}`);
        uploaded.push({ id: fid, file_name: path.basename(finalPath) });
      }
    }
    return reply.status(201).send({ uploaded });
  });

  // 下载文件
  app.get('/api/files/:fileId/download', async (req, reply) => {
    const fid = Number((req.params as any).fileId);
    const file = db.prepare('SELECT * FROM file_records WHERE id = ?').get(fid) as any;
    if (!file) return reply.status(404).send({ error: '文件不存在' });
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, file.case_id)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const caseRow = db.prepare('SELECT folder_path FROM cases WHERE id = ?').get(file.case_id) as any;
    const fullPath = path.join(caseRow.folder_path, file.rel_path);
    if (!fs.existsSync(fullPath)) return reply.status(404).send({ error: '文件已丢失' });
    logAudit(req.user!.id, 'file_download', 'file', fid, file.file_name);
    return reply.send(fs.createReadStream(fullPath));
  });

  // 删除文件
  app.delete('/api/files/:fileId', async (req, reply) => {
    const fid = Number((req.params as any).fileId);
    const file = db.prepare('SELECT * FROM file_records WHERE id = ?').get(fid) as any;
    if (!file) return reply.status(404).send({ error: '文件不存在' });
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, file.case_id)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const caseRow = db.prepare('SELECT folder_path FROM cases WHERE id = ?').get(file.case_id) as any;
    const fullPath = path.join(caseRow.folder_path, file.rel_path);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    db.prepare('DELETE FROM file_records WHERE id = ?').run(fid);
    logAudit(req.user!.id, 'file_delete', 'file', fid, file.file_name);
    return { ok: true };
  });

  // 触发单个文件 OCR
  app.post('/api/files/:fileId/ocr', async (req, reply) => {
    const fid = Number((req.params as any).fileId);
    const file = db.prepare('SELECT * FROM file_records WHERE id = ?').get(fid) as any;
    if (!file) return reply.status(404).send({ error: '文件不存在' });
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, file.case_id)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    triggerOCR(fid);
    return { ok: true, message: 'OCR 已加入队列' };
  });

  // 复制文书：从文书模板库（支持单个 template_id 或批量 template_ids）
  app.post('/api/cases/:id/files/copy-from-template', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const body = req.body as { template_id?: number; template_ids?: number[] };
    const ids = (body.template_ids?.length ? body.template_ids : body.template_id ? [body.template_id] : [])
      .map(Number).filter(Boolean);
    if (ids.length === 0) return reply.status(400).send({ error: '未指定模板' });
    const caseRow = db.prepare('SELECT folder_path FROM cases WHERE id = ?').get(cid) as any;
    if (!caseRow) return reply.status(404).send({ error: '案件不存在' });

    const copied: string[] = [];
    const failed: string[] = [];
    for (const tid of ids) {
      const tpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(tid) as any;
      if (!tpl || !tpl.is_file || !tpl.file_path) { failed.push(`模板#${tid}`); continue; }
      const src = path.resolve(TEMPLATES_DIR, tpl.file_path);
      if (!src.startsWith(path.resolve(TEMPLATES_DIR) + path.sep) || !fs.existsSync(src)) {
        failed.push(tpl.name || `模板#${tid}`); continue;
      }
      // 防覆盖命名
      const ext = path.extname(src);
      const base = tpl.name || path.basename(src, ext);
      let destPath = path.join(caseRow.folder_path, `${base}${ext}`);
      let counter = 1;
      while (fs.existsSync(destPath)) {
        destPath = path.join(caseRow.folder_path, `${base}_${counter}${ext}`);
        counter++;
      }
      fs.copyFileSync(src, destPath);
      const stat = fs.statSync(destPath);
      const info = db.prepare(
        `INSERT INTO file_records (case_id, rel_path, file_name, mime_type, size, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(cid, path.basename(destPath), path.basename(destPath), 'application/octet-stream', stat.size, req.user!.id);
      logAudit(req.user!.id, 'file_copy_template', 'file', Number(info.lastInsertRowid), `tpl=${tpl.id} -> case=${cid}`);
      copied.push(path.basename(destPath));
    }
    if (copied.length === 0) return reply.status(400).send({ error: '没有可复制的模板文件' });
    return reply.status(201).send({ count: copied.length, copied, failed });
  });

  // 复制文书：从其他案件（支持单个 source_file_id 或批量 source_file_ids，需同时是两个案件的成员）
  app.post('/api/cases/:id/files/copy-from-case', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const body = req.body as { source_file_id?: number; source_file_ids?: number[] };
    const ids = (body.source_file_ids?.length ? body.source_file_ids : body.source_file_id ? [body.source_file_id] : [])
      .map(Number).filter(Boolean);
    if (ids.length === 0) return reply.status(400).send({ error: '未指定文件' });
    const caseRow = db.prepare('SELECT folder_path FROM cases WHERE id = ?').get(cid) as any;
    if (!caseRow) return reply.status(404).send({ error: '案件不存在' });

    const copied: string[] = [];
    const failed: string[] = [];
    for (const fid of ids) {
      const src = db.prepare('SELECT * FROM file_records WHERE id = ?').get(fid) as any;
      if (!src) { failed.push(`文件#${fid}`); continue; }
      if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, src.case_id)) { failed.push(src.file_name); continue; }
      if (src.case_id === cid) { failed.push(src.file_name); continue; }
      const srcCase = db.prepare('SELECT folder_path FROM cases WHERE id = ?').get(src.case_id) as any;
      const srcPath = srcCase ? path.join(srcCase.folder_path, src.rel_path) : '';
      if (!srcCase || !fs.existsSync(srcPath)) { failed.push(src.file_name); continue; }

      const ext = path.extname(src.file_name);
      const base = path.basename(src.file_name, ext);
      let destPath = path.join(caseRow.folder_path, `${base}${ext}`);
      let counter = 1;
      while (fs.existsSync(destPath)) {
        destPath = path.join(caseRow.folder_path, `${base}_${counter}${ext}`);
        counter++;
      }
      fs.copyFileSync(srcPath, destPath);
      const stat = fs.statSync(destPath);
      const info = db.prepare(
        `INSERT INTO file_records (case_id, rel_path, file_name, mime_type, size, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(cid, path.basename(destPath), path.basename(destPath), src.mime_type, stat.size, req.user!.id);
      logAudit(req.user!.id, 'file_copy_case', 'file', Number(info.lastInsertRowid), `src=${src.id} -> case=${cid}`);
      copied.push(path.basename(destPath));
    }
    if (copied.length === 0) return reply.status(400).send({ error: '没有可复制的文件' });
    return reply.status(201).send({ count: copied.length, copied, failed });
  });
}
