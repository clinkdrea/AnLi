import type { FastifyInstance } from 'fastify';
import { db } from '../db/schema.js';
import { isCaseMember } from '../plugins/auth.js';
import { logAudit } from '../services/audit.js';

export default async function commentRoutes(app: FastifyInstance) {
  // 评论列表
  // query: target_type=global|stage|task, target_id=<id>；不传则返回案件全部评论
  app.get('/api/cases/:id/comments', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const q = req.query as any;
    const where = ['cm.case_id = ?'];
    const params: any[] = [cid];
    if (q.target_type === 'global') {
      where.push("cm.target_type = 'global'");
    } else if (q.target_type === 'stage' || q.target_type === 'task') {
      where.push('cm.target_type = ?');
      params.push(q.target_type);
      if (q.target_id) {
        where.push('cm.target_id = ?');
        params.push(Number(q.target_id));
      }
    }
    const comments = db.prepare(
      `SELECT cm.*, u.name as author_name,
              s.name as stage_name, t.title as task_title
       FROM comments cm
       JOIN users u ON cm.author_id = u.id
       LEFT JOIN case_stages s ON cm.target_type = 'stage' AND cm.target_id = s.id
       LEFT JOIN tasks t ON cm.target_type = 'task' AND cm.target_id = t.id
       WHERE ${where.join(' AND ')}
       ORDER BY cm.created_at ASC`
    ).all(...params);
    return { comments };
  });

  // 创建评论（支持 @提及、可指定目标：全局/阶段/任务）
  app.post('/api/cases/:id/comments', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const { content, parent_id, target_type, target_id } = req.body as any;
    if (!content?.trim()) return reply.status(400).send({ error: '评论内容不能为空' });

    // 校验评论归属目标
    let tt: 'global' | 'stage' | 'task' = 'global';
    let tidVal: number | null = null;
    let targetLabel = '';
    if (target_type === 'stage' && target_id) {
      const stage = db.prepare('SELECT id, name FROM case_stages WHERE id = ? AND case_id = ?')
        .get(Number(target_id), cid) as any;
      if (!stage) return reply.status(400).send({ error: '指定阶段不存在' });
      tt = 'stage'; tidVal = stage.id; targetLabel = `阶段「${stage.name}」`;
    } else if (target_type === 'task' && target_id) {
      const task = db.prepare('SELECT id, title FROM tasks WHERE id = ? AND case_id = ?')
        .get(Number(target_id), cid) as any;
      if (!task) return reply.status(400).send({ error: '指定任务不存在' });
      tt = 'task'; tidVal = task.id; targetLabel = `任务「${task.title}」`;
    }

    // 提取 @用户名；@所有人 表示提及该案件全部成员
    const mentionMatches = content.match(/@([^\s@]+)/g) || [];
    const mentions: string[] = [];
    let mentionAll = false;
    for (const m of mentionMatches) {
      const name = m.slice(1);
      if (name === '所有人') { mentionAll = true; continue; }
      const user = db.prepare('SELECT id FROM users WHERE name = ?').get(name) as any;
      if (user && !mentions.includes(name)) mentions.push(name);
    }
    if (mentionAll) mentions.push('所有人');

    const info = db.prepare(
      'INSERT INTO comments (case_id, parent_id, target_type, target_id, content, mentions, author_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(cid, parent_id || null, tt, tidVal, content.trim(), mentions.length ? JSON.stringify(mentions) : null, req.user!.id);
    const cid2 = Number(info.lastInsertRowid);
    logAudit(req.user!.id, 'comment_create', 'comment', cid2, `case=${cid} target=${tt}${tidVal ? ':' + tidVal : ''}`);

    const scope = targetLabel ? `${targetLabel}：` : '';
    const preview = content.slice(0, 30);
    if (mentionAll) {
      // @所有人：案件全部成员（除作者）各发一条 mention 通知，不再叠加普通评论通知
      const members = db.prepare(
        'SELECT user_id FROM case_members WHERE case_id = ? AND user_id != ?'
      ).all(cid, req.user!.id) as any[];
      for (const m of members) {
        db.prepare('INSERT INTO notifications (user_id, type, content, ref_type, ref_id) VALUES (?, ?, ?, ?, ?)')
          .run(m.user_id, 'mention', `${scope}评论中 @了所有人：${preview}`, 'case', String(cid));
      }
    } else {
      // 通知被 @ 的用户
      for (const name of mentions) {
        const user = db.prepare('SELECT id FROM users WHERE name = ?').get(name) as any;
        if (user) {
          db.prepare('INSERT INTO notifications (user_id, type, content, ref_type, ref_id) VALUES (?, ?, ?, ?, ?)')
            .run(user.id, 'mention', `${scope}您在案件中被 @：${preview}`, 'case', String(cid));
        }
      }
      // 通知案件其他成员有新评论
      const members = db.prepare(
        'SELECT user_id FROM case_members WHERE case_id = ? AND user_id != ?'
      ).all(cid, req.user!.id) as any[];
      for (const m of members) {
        db.prepare('INSERT INTO notifications (user_id, type, content, ref_type, ref_id) VALUES (?, ?, ?, ?, ?)')
          .run(m.user_id, 'comment', `${scope}案件有新评论：${preview}`, 'case', String(cid));
      }
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
