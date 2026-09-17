import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { db, TEMPLATES_DIR } from '../db/schema.js';
import { isCaseMember } from '../plugins/auth.js';
import { logAudit } from '../services/audit.js';
import { triggerOCR } from '../services/ocr.js';
import { guessMime } from '../services/mime.js';

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
       WHERE f.case_id = ? AND COALESCE(f.category, 'file') != 'evidence'
       ORDER BY f.created_at DESC`
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
    const encoded = encodeURIComponent(file.file_name);
    const inline = (req.query as any).inline === '1';
    reply.header('Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encoded}`);
    if (inline) reply.type(guessMime(file.file_name, file.mime_type));
    return reply.send(fs.createReadStream(fullPath));
  });

  // 用本地系统默认应用打开文件（macOS: open 命令）
  app.post('/api/files/:fileId/open', async (req, reply) => {
    const fid = Number((req.params as any).fileId);
    const file = db.prepare('SELECT * FROM file_records WHERE id = ?').get(fid) as any;
    if (!file) return reply.status(404).send({ error: '文件不存在' });
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, file.case_id)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const caseRow = db.prepare('SELECT folder_path FROM cases WHERE id = ?').get(file.case_id) as any;
    const fullPath = path.join(caseRow.folder_path, file.rel_path);
    if (!fs.existsSync(fullPath)) return reply.status(404).send({ error: '文件已丢失' });
    exec(`open ${JSON.stringify(fullPath)}`, (err) => {
      if (err) {
        console.error('open file failed:', err);
      }
    });
    logAudit(req.user!.id, 'file_open_local', 'file', fid, file.file_name);
    return { ok: true, path: fullPath };
  });

  // 重命名文件（同时改磁盘文件名与数据库记录，保留原扩展名）
  // body: { name: "新文件名" }（可带可不带扩展名；最终以磁盘文件原扩展名为准）
  app.patch('/api/files/:fileId/rename', async (req, reply) => {
    const fid = Number((req.params as any).fileId);
    const file = db.prepare('SELECT * FROM file_records WHERE id = ?').get(fid) as any;
    if (!file) return reply.status(404).send({ error: '文件不存在' });
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, file.case_id)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const { name } = req.body as { name?: string };
    if (!name || !name.trim()) return reply.status(400).send({ error: '文件名不能为空' });

    // 原扩展名（保留原大小写）；新文件名主体做安全过滤：去掉路径分隔符等危险字符与控制字符
    const oldExt = path.extname(file.file_name);
    let safeBase = path.basename(name.trim())
      .replace(/[\x00-\x1f/\\:*?"<>|]/g, '_')
      .replace(/\.+$/, '')
      .trim();
    // 用户若带了与原文件一致的扩展名（不区分大小写），先剥离，避免 .pdf.pdf
    const inputExt = path.extname(safeBase);
    if (oldExt && inputExt && inputExt.toLowerCase() === oldExt.toLowerCase()) {
      safeBase = safeBase.slice(0, -inputExt.length).replace(/\.+$/, '').trim();
    }
    if (!safeBase) return reply.status(400).send({ error: '文件名不合法' });

    const caseRow = db.prepare('SELECT folder_path FROM cases WHERE id = ?').get(file.case_id) as any;
    const oldFull = path.join(caseRow.folder_path, file.rel_path);
    if (!fs.existsSync(oldFull)) return reply.status(404).send({ error: '文件已丢失，无法重命名' });

    // rel_path 的目录部分保持不变（证据文件位于 evidence/ 子目录）
    const relDir = path.dirname(file.rel_path);
    const dir = relDir === '.' ? caseRow.folder_path : path.join(caseRow.folder_path, relDir);

    // 新名与原名相同（含扩展名）：无需改动，直接返回
    const targetName = safeBase + oldExt;
    if (targetName === path.basename(file.rel_path)) {
      return { ok: true, file_name: file.file_name, rel_path: file.rel_path, unchanged: true };
    }
    // 同目录防重名（旧文件已占用原名，需要先检测目标再改名），冲突时自动追加 _1 / _2 ...
    let finalBase = targetName;
    let counter = 1;
    while (fs.existsSync(path.join(dir, finalBase))) {
      finalBase = `${safeBase}_${counter}${oldExt}`;
      counter++;
    }

    const newFull = path.join(dir, finalBase);
    fs.renameSync(oldFull, newFull);
    const newRel = relDir === '.' ? finalBase : path.join(relDir, finalBase);
    db.prepare('UPDATE file_records SET file_name = ?, rel_path = ? WHERE id = ?')
      .run(finalBase, newRel, fid);
    logAudit(req.user!.id, 'file_rename', 'file', fid, `${file.file_name} -> ${finalBase}`);
    return { ok: true, file_name: finalBase, rel_path: newRel };
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

  // 触发单个文件 OCR（同步等待识别完成）
  // query: force=1 强制重新识别（已有结果也重跑）
  app.post('/api/files/:fileId/ocr', async (req, reply) => {
    const fid = Number((req.params as any).fileId);
    const file = db.prepare('SELECT * FROM file_records WHERE id = ?').get(fid) as any;
    if (!file) return reply.status(404).send({ error: '文件不存在' });
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, file.case_id)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const force = (req.query as any).force === '1' || (req.body as any)?.force === true;
    const status = await triggerOCR(fid, force);
    if (status === 'skipped') {
      return reply.status(400).send({ error: '仅支持图片文件 OCR（jpg / jpeg / png / gif / bmp / tiff / heic / webp）' });
    }
    if (status === 'failed') {
      return reply.status(500).send({ error: 'OCR 识别失败，请重试或检查文件是否损坏' });
    }
    logAudit(req.user!.id, 'file_ocr', 'file', fid, `force=${force} status=${status}`);
    // 返回最新记录（含 ocr_text），前端可直接展示
    const fresh = db.prepare('SELECT ocr_status, ocr_text FROM file_records WHERE id = ?').get(fid) as any;
    return { ok: true, status: fresh.ocr_status, ocr_text: fresh.ocr_text };
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
