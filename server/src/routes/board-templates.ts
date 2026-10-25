// 看板模板管理：管理员维护案件看板的阶段列模板；建案时可选用
import type { FastifyInstance } from 'fastify';
import { db } from '../db/schema.js';
import { logAudit } from '../services/audit.js';

interface TplBody {
  name?: string;
  stages?: string[];
}

// 校验并规整模板数据：名称非空、阶段 2~20 个且去重
function normalize(body: TplBody): { error?: string; name?: string; stages?: string[] } {
  const name = body.name?.trim();
  if (!name) return { error: '模板名称为必填' };
  const raw = Array.isArray(body.stages) ? body.stages : [];
  const stages = raw.map((s) => String(s).trim()).filter(Boolean);
  const deduped = [...new Set(stages)];
  if (deduped.length < 2) return { error: '至少需要 2 个不重复的阶段列' };
  if (deduped.length > 20) return { error: '阶段列最多 20 个' };
  return { name, stages: deduped };
}

export default async function boardTemplateRoutes(app: FastifyInstance) {
  // 模板列表：所有登录用户可读（新建案件选择时使用）；type_key 非空为内置默认模板
  app.get('/api/board-templates', async () => {
    const templates = db.prepare(
      `SELECT bt.id, bt.name, bt.stages, bt.type_key, bt.created_at, u.name AS creator_name
       FROM board_templates bt LEFT JOIN users u ON bt.creator_id = u.id
       ORDER BY (bt.type_key IS NULL), bt.id`
    ).all() as any[];
    for (const t of templates) {
      try { t.stages = JSON.parse(t.stages); } catch { t.stages = []; }
      t.is_default = !!t.type_key;
    }
    return { templates };
  });

  // 新建模板（仅管理员）
  app.post('/api/board-templates', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.status(403).send({ error: '仅管理员可管理「看板管理」' });
    const { error, name, stages } = normalize(req.body as TplBody);
    if (error || !name || !stages) return reply.status(400).send({ error });
    const dup = db.prepare('SELECT id FROM board_templates WHERE name = ?').get(name) as any;
    if (dup) return reply.status(400).send({ error: '同名模板已存在' });
    const info = db.prepare('INSERT INTO board_templates (name, stages, creator_id) VALUES (?, ?, ?)')
      .run(name, JSON.stringify(stages), req.user!.id);
    logAudit(req.user!.id, 'board_template_create', 'board_template', Number(info.lastInsertRowid), name);
    return reply.status(201).send({ id: Number(info.lastInsertRowid) });
  });

  // 编辑模板（仅管理员）
  app.put('/api/board-templates/:id', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.status(403).send({ error: '仅管理员可管理「看板管理」' });
    const id = Number((req.params as any).id);
    const row = db.prepare('SELECT id FROM board_templates WHERE id = ?').get(id) as any;
    if (!row) return reply.status(404).send({ error: '模板不存在' });
    const { error, name, stages } = normalize(req.body as TplBody);
    if (error || !name || !stages) return reply.status(400).send({ error });
    const dup = db.prepare('SELECT id FROM board_templates WHERE name = ? AND id != ?').get(name, id) as any;
    if (dup) return reply.status(400).send({ error: '同名模板已存在' });
    db.prepare('UPDATE board_templates SET name = ?, stages = ? WHERE id = ?')
      .run(name, JSON.stringify(stages), id);
    logAudit(req.user!.id, 'board_template_update', 'board_template', id, name);
    return { ok: true };
  });

  // 删除模板（仅管理员；内置默认模板禁止删除，仅可修改）
  app.delete('/api/board-templates/:id', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.status(403).send({ error: '仅管理员可管理「看板管理」' });
    const id = Number((req.params as any).id);
    const row = db.prepare('SELECT name, type_key FROM board_templates WHERE id = ?').get(id) as any;
    if (!row) return reply.status(404).send({ error: '模板不存在' });
    if (row.type_key) return reply.status(400).send({ error: '默认模板不可删除，仅可修改' });
    db.prepare('DELETE FROM board_templates WHERE id = ?').run(id);
    logAudit(req.user!.id, 'board_template_delete', 'board_template', id, row.name);
    return { ok: true };
  });
}
