import type { FastifyInstance } from 'fastify';
import { db } from '../db/schema.js';
import { isCaseMember } from '../plugins/auth.js';
import { logAudit } from '../services/audit.js';

export default async function taskRoutes(app: FastifyInstance) {
  // 案件任务列表
  app.get('/api/cases/:id/tasks', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const tasks = db.prepare(
      `SELECT t.*, u.name as assignee_name, s.name as stage_name
       FROM tasks t
       LEFT JOIN users u ON t.assignee_id = u.id
       LEFT JOIN case_stages s ON t.stage_id = s.id
       WHERE t.case_id = ? ORDER BY t.created_at DESC`
    ).all(cid);
    return { tasks };
  });

  // 创建任务
  app.post('/api/cases/:id/tasks', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const { title, description, assignee_id, due_date, priority, stage_id } = req.body as any;
    if (!title?.trim()) return reply.status(400).send({ error: '任务标题必填' });
    const info = db.prepare(
      `INSERT INTO tasks (case_id, stage_id, title, description, assignee_id, due_date, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(cid, stage_id || null, title.trim(), description || null, assignee_id || null, due_date || null, priority || 'medium');
    const tid = Number(info.lastInsertRowid);
    logAudit(req.user!.id, 'task_create', 'task', tid, title);
    // 通知负责人
    if (assignee_id && assignee_id !== req.user!.id) {
      db.prepare('INSERT INTO notifications (user_id, type, content) VALUES (?, ?, ?)')
        .run(assignee_id, 'task', `您被分配了新任务：${title}`);
    }
    return reply.status(201).send({ id: tid });
  });

  // 更新任务状态
  app.put('/api/tasks/:tid', async (req) => {
    const tid = Number((req.params as any).tid);
    const { status, title, due_date } = req.body as any;
    const fields: string[] = [];
    const params: any[] = [];
    if (status) { fields.push('status = ?'); params.push(status); }
    if (title) { fields.push('title = ?'); params.push(title); }
    if (due_date !== undefined) { fields.push('due_date = ?'); params.push(due_date); }
    if (fields.length) {
      params.push(tid);
      db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    }
    return { ok: true };
  });

  // 删除任务
  app.delete('/api/tasks/:tid', async (req) => {
    const tid = Number((req.params as any).tid);
    db.prepare('DELETE FROM tasks WHERE id = ?').run(tid);
    logAudit(req.user!.id, 'task_delete', 'task', tid);
    return { ok: true };
  });

  // 期限列表
  app.get('/api/cases/:id/deadlines', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const deadlines = db.prepare('SELECT * FROM deadlines WHERE case_id = ? ORDER BY due_at ASC').all(cid);
    return { deadlines };
  });

  // 创建期限
  app.post('/api/cases/:id/deadlines', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const { type, due_at } = req.body as any;
    if (!type || !due_at) return reply.status(400).send({ error: '类型和到期时间必填' });
    const info = db.prepare(
      'INSERT INTO deadlines (case_id, type, due_at) VALUES (?, ?, ?)'
    ).run(cid, type, due_at);
    return reply.status(201).send({ id: Number(info.lastInsertRowid) });
  });
}
