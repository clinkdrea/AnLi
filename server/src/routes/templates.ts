import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import { exec } from 'node:child_process';
import { db, TEMPLATES_DIR } from '../db/schema.js';
import { scanTemplates, getTemplatesDir } from '../services/templates-scan.js';
import { logAudit } from '../services/audit.js';
import { guessMime } from '../services/mime.js';

// 安全校验：请求路径必须位于模板目录内
function resolveSafe(subPath?: string): string | null {
  const base = path.resolve(TEMPLATES_DIR);
  const target = path.resolve(base, subPath || '.');
  if (target === base || target.startsWith(base + path.sep)) return target;
  return null;
}

export default async function templateRoutes(app: FastifyInstance) {
  // 模板列表（支持分类/关键词/顶级分类筛选）+ 分类树
  app.get('/api/templates', async (req) => {
    const { category, q, top } = req.query as any;
    let sql = `SELECT t.*, u.name as creator_name FROM templates t
               LEFT JOIN users u ON t.creator_id = u.id WHERE 1=1`;
    const params: any[] = [];
    if (category) { sql += ' AND t.category = ?'; params.push(category); }
    if (top) { sql += ' AND (t.category_path = ? OR t.category_path LIKE ?)'; params.push(top, `${top}/%`); }
    if (q) { sql += ' AND t.name LIKE ?'; params.push(`%${q}%`); }
    sql += ' ORDER BY t.category_path, t.name';
    const templates = db.prepare(sql).all(...params);

    // 分类树：顶级分类 -> 子分类 -> 文件数量
    const grouped = db.prepare(
      "SELECT category_path, COUNT(*) as cnt FROM templates WHERE is_file = 1 AND category_path IS NOT NULL AND category_path != '' GROUP BY category_path"
    ).all() as { category_path: string; cnt: number }[];
    const tree: Record<string, { name: string; count: number; children: Record<string, number> }> = {};
    for (const row of grouped) {
      const parts = row.category_path.split('/');
      const topName = parts[0] || '未分类';
      const subName = parts[1] || '';
      if (!tree[topName]) tree[topName] = { name: topName, count: 0, children: {} };
      tree[topName].count += row.cnt;
      if (subName) tree[topName].children[subName] = (tree[topName].children[subName] || 0) + row.cnt;
    }

    return { templates, categories: Object.values(tree) };
  });

  // 刷新扫描模板目录
  app.post('/api/templates/scan', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.status(403).send({ error: '仅管理员可扫描' });
    const result = scanTemplates();
    logAudit(req.user!.id, 'templates_scan', 'templates', null, JSON.stringify(result));
    return result;
  });

  // 模板根目录信息（前端显示路径）
  app.get('/api/templates/folder', () => {
    return { path: getTemplatesDir() };
  });

  // 在 macOS Finder 中打开模板文件夹（本地部署）
  app.post('/api/templates/open-folder', async (req, reply) => {
    const { path: sub } = req.body as { path?: string } || {};
    const target = resolveSafe(sub);
    if (!target) return reply.status(400).send({ error: '非法路径' });
    if (!fs.existsSync(target)) return reply.status(404).send({ error: '文件夹不存在' });
    exec(`open ${JSON.stringify(target)}`);
    return { ok: true, path: target };
  });

  // 下载文件型模板（原始 Word/PDF 文件）
  app.get('/api/templates/:id/download', async (req, reply) => {
    const tid = Number((req.params as any).id);
    const tpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(tid) as any;
    if (!tpl) return reply.status(404).send({ error: '模板不存在' });
    if (!tpl.is_file || !tpl.file_path) return reply.status(400).send({ error: '该模板无可下载文件' });
    const full = path.resolve(TEMPLATES_DIR, tpl.file_path);
    if (!full.startsWith(path.resolve(TEMPLATES_DIR) + path.sep) || !fs.existsSync(full)) {
      return reply.status(404).send({ error: '模板文件已丢失' });
    }
    const inline = (req.query as any).inline === '1';
    const baseName = path.basename(full);
    reply.header('Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(baseName)}`);
    if (inline) reply.type(guessMime(baseName));
    return reply.send(fs.createReadStream(full));
  });

  // 用本地系统默认应用打开文件型模板（macOS: open 命令）
  app.post('/api/templates/:id/open', async (req, reply) => {
    const tid = Number((req.params as any).id);
    const tpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(tid) as any;
    if (!tpl) return reply.status(404).send({ error: '模板不存在' });
    if (!tpl.is_file || !tpl.file_path) return reply.status(400).send({ error: '该模板无本地文件' });
    const full = path.resolve(TEMPLATES_DIR, tpl.file_path);
    if (!full.startsWith(path.resolve(TEMPLATES_DIR) + path.sep) || !fs.existsSync(full)) {
      return reply.status(404).send({ error: '模板文件已丢失' });
    }
    exec(`open ${JSON.stringify(full)}`, (err) => {
      if (err) console.error('open template failed:', err);
    });
    logAudit(req.user!.id, 'template_open_local', 'template', tid, tpl.name);
    return { ok: true, path: full };
  });

  // 创建文本模板（保留原功能）
  app.post('/api/templates', async (req, reply) => {
    const { name, category, content, placeholders } = req.body as any;
    if (!name?.trim() || !content) return reply.status(400).send({ error: '名称和内容必填' });
    const info = db.prepare(
      'INSERT INTO templates (name, category, content, placeholders, creator_id) VALUES (?, ?, ?, ?, ?)'
    ).run(name.trim(), category || null, content, placeholders || null, req.user!.id);
    logAudit(req.user!.id, 'template_create', 'template', Number(info.lastInsertRowid), name);
    return reply.status(201).send({ id: Number(info.lastInsertRowid) });
  });

  // 从文本模板生成文书到案件文件夹（保留原功能）
  app.post('/api/templates/:tid/generate', async (req, reply) => {
    const tid = Number((req.params as any).tid);
    const { case_id, filename } = req.body as any;
    const tpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(tid) as any;
    if (!tpl) return reply.status(404).send({ error: '模板不存在' });
    if (tpl.is_file) return reply.status(400).send({ error: '文件型模板请直接下载使用' });
    const caseRow = db.prepare('SELECT case_no, name, folder_path FROM cases WHERE id = ?').get(case_id) as any;
    if (!caseRow) return reply.status(404).send({ error: '案件不存在' });

    let content = tpl.content;
    content = content.replace(/\{\{案件编号\}\}/g, caseRow.case_no);
    content = content.replace(/\{\{案件名称\}\}/g, caseRow.name);

    const fname = filename || `${tpl.name}-${caseRow.case_no}.txt`;
    const dest = path.join(caseRow.folder_path, fname);
    fs.writeFileSync(dest, content, 'utf-8');

    const info = db.prepare(
      `INSERT INTO file_records (case_id, rel_path, file_name, mime_type, size, uploaded_by)
       VALUES (?, ?, ?, 'text/plain', ?, ?)`
    ).run(case_id, fname, fname, Buffer.byteLength(content), req.user!.id);
    logAudit(req.user!.id, 'template_generate', 'file', Number(info.lastInsertRowid), `${tpl.name} -> ${fname}`);
    return reply.status(201).send({ file_name: fname });
  });

  app.delete('/api/templates/:tid', async (req) => {
    const tid = Number((req.params as any).tid);
    db.prepare('DELETE FROM templates WHERE id = ?').run(tid);
    return { ok: true };
  });
}
