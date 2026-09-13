import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { db } from '../db/schema.js';
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
}
