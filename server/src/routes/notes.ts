import type { FastifyInstance } from 'fastify';
import { db } from '../db/schema.js';
import { isCaseMember } from '../plugins/auth.js';
import { logAudit } from '../services/audit.js';

export default async function noteRoutes(app: FastifyInstance) {
  // 案情记录列表
  app.get('/api/cases/:id/notes', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const notes = db.prepare(
      `SELECT n.*, u.name as author_name, s.name as stage_name
       FROM case_notes n
       LEFT JOIN users u ON n.author_id = u.id
       LEFT JOIN case_stages s ON n.stage_id = s.id
       WHERE n.case_id = ? ORDER BY n.created_at DESC`
    ).all(cid);
    return { notes };
  });

  // 创建案情记录
  app.post('/api/cases/:id/notes', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const { content, stage_id } = req.body as any;
    if (!content?.trim()) return reply.status(400).send({ error: '内容不能为空' });
    const info = db.prepare(
      'INSERT INTO case_notes (case_id, stage_id, content, author_id) VALUES (?, ?, ?, ?)'
    ).run(cid, stage_id || null, content.trim(), req.user!.id);
    logAudit(req.user!.id, 'note_create', 'case_note', info.lastInsertRowid, `case=${cid}`);
    return reply.status(201).send({ id: Number(info.lastInsertRowid) });
  });

  // 更新案情记录
  app.put('/api/notes/:noteId', async (req, reply) => {
    const nid = Number((req.params as any).noteId);
    const note = db.prepare('SELECT * FROM case_notes WHERE id = ?').get(nid) as any;
    if (!note) return reply.status(404).send({ error: '记录不存在' });
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, note.case_id)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const { content } = req.body as any;
    if (!content?.trim()) return reply.status(400).send({ error: '内容不能为空' });
    db.prepare('UPDATE case_notes SET content = ? WHERE id = ?').run(content.trim(), nid);
    logAudit(req.user!.id, 'note_update', 'case_note', nid);
    return { ok: true };
  });

  // 删除案情记录
  app.delete('/api/notes/:noteId', async (req, reply) => {
    const nid = Number((req.params as any).noteId);
    const note = db.prepare('SELECT * FROM case_notes WHERE id = ?').get(nid) as any;
    if (!note) return reply.status(404).send({ error: '记录不存在' });
    if (req.user!.role !== 'admin' && note.author_id !== req.user!.id) {
      return reply.status(403).send({ error: '只能删除自己的记录' });
    }
    db.prepare('DELETE FROM case_notes WHERE id = ?').run(nid);
    logAudit(req.user!.id, 'note_delete', 'case_note', nid);
    return { ok: true };
  });

  // 时间轴：案情记录 + 阶段流转 + 关键任务完成事件
  app.get('/api/cases/:id/timeline', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const events: any[] = [];

    const notes = db.prepare(
      `SELECT n.id, n.content, n.created_at, u.name as author_name
       FROM case_notes n JOIN users u ON n.author_id = u.id
       WHERE n.case_id = ?`
    ).all(cid);
    notes.forEach((n: any) => events.push({ type: 'note', id: n.id, time: n.created_at, content: n.content, author: n.author_name }));

    const stages = db.prepare(
      'SELECT id, name, started_at, completed_at FROM case_stages WHERE case_id = ?'
    ).all(cid);
    stages.forEach((s: any) => {
      if (s.started_at) events.push({ type: 'stage_start', id: s.id, time: s.started_at, content: `阶段开始：${s.name}` });
      if (s.completed_at) events.push({ type: 'stage_done', id: s.id, time: s.completed_at, content: `阶段完成：${s.name}` });
    });

    const tasks = db.prepare(
      `SELECT id, title, created_at FROM tasks WHERE case_id = ? AND status = 'done'`
    ).all(cid);
    tasks.forEach((t: any) => events.push({ type: 'task_done', id: t.id, time: t.created_at, content: `任务完成：${t.title}` }));

    events.sort((a, b) => a.time.localeCompare(b.time));
    return { events };
  });
}
