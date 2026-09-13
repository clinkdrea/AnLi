import type { FastifyInstance } from 'fastify';
import { db } from '../db/schema.js';
import { isCaseMember } from '../plugins/auth.js';
import { logAudit } from '../services/audit.js';

export default async function commentRoutes(app: FastifyInstance) {
  // 评论列表
  app.get('/api/cases/:id/comments', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const comments = db.prepare(
      `SELECT cm.*, u.name as author_name FROM comments cm
       JOIN users u ON cm.author_id = u.id
       WHERE cm.case_id = ? ORDER BY cm.created_at ASC`
    ).all(cid);
    return { comments };
  });

  // 创建评论（支持 @提及）
  app.post('/api/cases/:id/comments', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const { content, parent_id } = req.body as any;
    if (!content?.trim()) return reply.status(400).send({ error: '评论内容不能为空' });

    // 提取 @用户名
    const mentionMatches = content.match(/@(\S+)/g) || [];
    const mentions: string[] = [];
    for (const m of mentionMatches) {
      const name = m.slice(1);
      const user = db.prepare('SELECT id FROM users WHERE name = ?').get(name) as any;
      if (user) mentions.push(name);
    }

    const info = db.prepare(
      'INSERT INTO comments (case_id, parent_id, content, mentions, author_id) VALUES (?, ?, ?, ?, ?)'
    ).run(cid, parent_id || null, content.trim(), mentions.length ? JSON.stringify(mentions) : null, req.user!.id);
    const cid2 = Number(info.lastInsertRowid);
    logAudit(req.user!.id, 'comment_create', 'comment', cid2, `case=${cid}`);

    // 通知被 @ 的用户
    for (const name of mentions) {
      const user = db.prepare('SELECT id FROM users WHERE name = ?').get(name) as any;
      if (user) {
        db.prepare('INSERT INTO notifications (user_id, type, content, ref_type, ref_id) VALUES (?, ?, ?, ?, ?)')
          .run(user.id, 'mention', `您在案件中被 @：${content.slice(0, 30)}`, 'case', String(cid));
      }
    }
    // 通知案件其他成员有新评论
    const members = db.prepare(
      'SELECT user_id FROM case_members WHERE case_id = ? AND user_id != ?'
    ).all(cid, req.user!.id) as any[];
    for (const m of members) {
      db.prepare('INSERT INTO notifications (user_id, type, content, ref_type, ref_id) VALUES (?, ?, ?, ?, ?)')
        .run(m.user_id, 'comment', `案件有新评论：${content.slice(0, 30)}`, 'case', String(cid));
    }

    return reply.status(201).send({ id: cid2 });
  });

  // 删除评论
  app.delete('/api/comments/:cid', async (req, reply) => {
    const cid = Number((req.params as any).cid);
    const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(cid) as any;
    if (!comment) return reply.status(404).send({ error: '评论不存在' });
    if (req.user!.role !== 'admin' && comment.author_id !== req.user!.id) {
      return reply.status(403).send({ error: '只能删除自己的评论' });
    }
    db.prepare('DELETE FROM comments WHERE id = ?').run(cid);
    logAudit(req.user!.id, 'comment_delete', 'comment', cid);
    return { ok: true };
  });
}
