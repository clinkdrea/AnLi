import type { FastifyInstance } from 'fastify';
import { db } from '../db/schema.js';

export default async function notificationRoutes(app: FastifyInstance) {
  // 通知列表
  app.get('/api/notifications', async (req) => {
    const { unread_only } = req.query as any;
    let sql = 'SELECT * FROM notifications WHERE user_id = ?';
    const params: any[] = [req.user!.id];
    if (unread_only) { sql += ' AND is_read = 0'; }
    sql += ' ORDER BY created_at DESC LIMIT 100';
    const notifications = db.prepare(sql).all(...params);
    const unreadCount = db.prepare(
      'SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0'
    ).get(req.user!.id) as { c: number };
    return { notifications, unreadCount: unreadCount.c };
  });

  // 标记已读
  app.post('/api/notifications/:id/read', async (req) => {
    const nid = Number((req.params as any).id);
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(nid, req.user!.id);
    return { ok: true };
  });

  // 全部已读
  app.post('/api/notifications/read-all', async (req) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user!.id);
    return { ok: true };
  });
}
