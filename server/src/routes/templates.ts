import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import { exec } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { db, TEMPLATES_DIR } from '../db/schema.js';
import { scanTemplates, getTemplatesDir } from '../services/templates-scan.js';
import { logAudit } from '../services/audit.js';
import { guessMime } from '../services/mime.js';

// 允许上传的模板扩展名（与 templates-scan.ts 保持一致）
const ALLOWED_EXTS = new Set(['.docx', '.doc', '.pdf', '.wps', '.txt', '.dot', '.dotx', '.xlsx', '.xls']);

// 安全校验：请求路径必须位于模板目录内
function resolveSafe(subPath?: string): string | null {
  const base = path.resolve(TEMPLATES_DIR);
  const target = path.resolve(base, subPath || '.');
  if (target === base || target.startsWith(base + path.sep)) return target;
  return null;
}

// 清洗用户输入的目标目录字符串：仅允许汉字/字母数字/下划线/连字符/点；过滤 .. 与控制字符
function sanitizeTargetDir(input: string): { ok: true; relDir: string; segs: string[] } | { ok: false; error: string } {
  let raw = (input || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const segs = raw.split('/').map((s) => s.trim()).filter(Boolean);
  if (segs.some((s) => s === '..' || s === '.')) return { ok: false, error: '目标目录不合法' };
  const clean = segs.map((s) => s.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').replace(/\.+$/, '').trim()).filter(Boolean);
  return { ok: true, relDir: clean.join('/'), segs: clean };
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

  // 在 macOS Finder 中打开模板文件夹（仅 admin 可用，本地部署场景）
  app.post('/api/templates/open-folder', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.status(403).send({ error: '仅管理员可在 Finder 中打开' });
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

  // 上传模板文件（multipart）：字段 target_dir 指定模板所在目录（可新建或现有），file 为模板文件本体
  // 同名检测：目标目录下已有同名文件则返回 409，前端提示用户
  app.post('/api/templates/upload', async (req, reply) => {
    const uid = req.user!.id;
    const parts = req.parts();
    let targetDirRaw = '';
    let filePart: any = null;
    for await (const part of parts) {
      if (part.type === 'file') {
        filePart = part;
      } else if (part.type === 'field' && part.fieldname === 'target_dir') {
        targetDirRaw = String(part.value || '');
      }
    }
    if (!filePart) return reply.status(400).send({ error: '请选择模板文件' });

    const originalName = filePart.filename;
    const ext = path.extname(originalName).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      return reply.status(400).send({ error: '不支持的模板格式，仅支持 docx/doc/pdf/wps/txt/dot/dotx/xlsx/xls' });
    }

    // 文件名做安全过滤，保留汉字
    const safeBase = path.basename(originalName).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
    if (!safeBase) return reply.status(400).send({ error: '文件名不合法' });

    // 目标目录安全清洗
    const dir = sanitizeTargetDir(targetDirRaw);
    if (!dir.ok) return reply.status(400).send({ error: dir.error });
    const relDir = dir.relDir;
    const fullDir = path.resolve(TEMPLATES_DIR, relDir || '.');
    const baseResolved = path.resolve(TEMPLATES_DIR);
    if (fullDir !== baseResolved && !fullDir.startsWith(baseResolved + path.sep)) {
      return reply.status(400).send({ error: '目标目录不合法' });
    }

    // 同名文件检测：目标目录下已有同名文件则阻断
    const finalPath = path.join(fullDir, safeBase);
    if (fs.existsSync(finalPath)) {
      return reply.status(409).send({ error: `该目录下已有同名文件：${safeBase}` });
    }
    // 同名模板检测：数据库中已存在同 name（模板显示名）的记录则提示
    const baseName = path.basename(safeBase, ext);
    const sameName = db.prepare('SELECT id FROM templates WHERE name = ?').get(baseName) as { id: number } | undefined;
    if (sameName) {
      return reply.status(409).send({ error: `已有同名模板：${baseName}，请改名后再上传` });
    }

    // 创建目标目录（如不存在）
    if (!fs.existsSync(fullDir)) fs.mkdirSync(fullDir, { recursive: true });
    // 写入磁盘
    await pipeline(filePart.file, fs.createWriteStream(finalPath));

    const category = dir.segs.length > 0 ? dir.segs[dir.segs.length - 1] : '未分类';
    const categoryPath = relDir || '';
    const relPath = relDir ? `${relDir}/${safeBase}` : safeBase;
    const info = db.prepare(
      `INSERT INTO templates (name, category, category_path, file_path, is_file, content, creator_id)
       VALUES (?, ?, ?, ?, 1, '', ?)`
    ).run(baseName, category, categoryPath, relPath, uid);
    const newId = Number(info.lastInsertRowid);
    logAudit(uid, 'template_upload', 'template', newId, relPath);
    return reply.status(201).send({ id: newId, name: baseName, file_path: relPath, category, category_path: categoryPath });
  });

  // 创建文本模板（保留原功能；前端入口已切换为上传文件，此接口仍可用于脚本或后续启用）
  app.post('/api/templates', async (req, reply) => {
    const { name, category, content, placeholders } = req.body as any;
    if (!name?.trim() || !content) return reply.status(400).send({ error: '名称和内容必填' });
    // 同名模板检测
    const sameName = db.prepare('SELECT id FROM templates WHERE name = ?').get(name.trim()) as { id: number } | undefined;
    if (sameName) return reply.status(409).send({ error: `已有同名模板：${name.trim()}` });
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

  // 删除模板：仅 admin 或模板上传者本人可删除；其他用户仅可查看
  // 文件型模板同时删除磁盘文件（如位于模板根目录内）
  app.delete('/api/templates/:tid', async (req, reply) => {
    const tid = Number((req.params as any).tid);
    const uid = req.user!.id;
    const role = req.user!.role;
    const tpl = db.prepare('SELECT id, name, is_file, file_path, creator_id FROM templates WHERE id = ?').get(tid) as any;
    if (!tpl) return reply.status(404).send({ error: '模板不存在' });
    if (role !== 'admin' && tpl.creator_id !== uid) {
      return reply.status(403).send({ error: '无权删除该模板，仅管理员或上传者可删除' });
    }
    if (tpl.is_file && tpl.file_path) {
      const full = path.resolve(TEMPLATES_DIR, tpl.file_path);
      const baseResolved = path.resolve(TEMPLATES_DIR);
      if (full.startsWith(baseResolved + path.sep) && fs.existsSync(full)) {
        try { fs.unlinkSync(full); } catch { /* 忽略磁盘删除失败，仍删库记录 */ }
      }
    }
    db.prepare('DELETE FROM templates WHERE id = ?').run(tid);
    logAudit(uid, 'template_delete', 'template', tid, tpl.name);
    return { ok: true };
  });
}
