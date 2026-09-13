import type { FastifyInstance } from 'fastify';
import { db } from '../db/schema.js';
import { isCaseMember } from '../plugins/auth.js';

export default async function stageRoutes(app: FastifyInstance) {
  // 阶段列表
  app.get('/api/cases/:id/stages', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const stages = db.prepare('SELECT * FROM case_stages WHERE case_id = ? ORDER BY sort_order').all(cid);
    return { stages };
  });

  // 添加阶段
  app.post('/api/cases/:id/stages', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const { name } = req.body as any;
    if (!name?.trim()) return reply.status(400).send({ error: '阶段名称必填' });
    const max = db.prepare('SELECT MAX(sort_order) as m FROM case_stages WHERE case_id = ?').get(cid) as any;
    const info = db.prepare(
      'INSERT INTO case_stages (case_id, name, sort_order, is_custom) VALUES (?, ?, ?, 1)'
    ).run(cid, name.trim(), (max?.m ?? -1) + 1);
    return reply.status(201).send({ id: Number(info.lastInsertRowid) });
  });

  // 重命名阶段
  app.put('/api/stages/:sid', async (req, reply) => {
    const sid = Number((req.params as any).sid);
    const { name } = req.body as any;
    if (!name?.trim()) return reply.status(400).send({ error: '阶段名称必填' });
    db.prepare('UPDATE case_stages SET name = ? WHERE id = ?').run(name.trim(), sid);
    return { ok: true };
  });

  // 删除阶段（先解绑记录与任务，避免级联丢失）
  app.delete('/api/stages/:sid', async (req) => {
    const sid = Number((req.params as any).sid);
    db.prepare('UPDATE case_notes SET stage_id = NULL WHERE stage_id = ?').run(sid);
    db.prepare('UPDATE tasks SET stage_id = NULL WHERE stage_id = ?').run(sid);
    db.prepare('DELETE FROM case_stages WHERE id = ?').run(sid);
    return { ok: true };
  });

  // 阶段拖拽排序
  app.put('/api/cases/:id/stages/reorder', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const { order } = req.body as { order: number[] };
    if (!Array.isArray(order)) return reply.status(400).send({ error: '参数错误' });
    const upd = db.prepare('UPDATE case_stages SET sort_order = ? WHERE id = ? AND case_id = ?');
    db.exec('BEGIN');
    try {
      order.forEach((sid, i) => upd.run(i, sid, cid));
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      return reply.status(500).send({ error: '排序失败' });
    }
    return { ok: true };
  });

  // 标记阶段开始/完成
  app.post('/api/stages/:sid/start', async (req) => {
    const sid = Number((req.params as any).sid);
    db.prepare("UPDATE case_stages SET started_at = datetime('now') WHERE id = ?").run(sid);
    return { ok: true };
  });
  app.post('/api/stages/:sid/complete', async (req) => {
    const sid = Number((req.params as any).sid);
    db.prepare("UPDATE case_stages SET completed_at = datetime('now') WHERE id = ?").run(sid);
    return { ok: true };
  });
}
