import type { FastifyInstance } from 'fastify';
import { db } from '../db/schema.js';
import { cleanupNotifications } from '../services/cleanup.js';

export default async function notificationRoutes(app: FastifyInstance) {
  // 通知列表：支持 offset 翻页（"加载更多"模式），默认每页 20 条
  app.get('/api/notifications', async (req) => {
    // 懒执行：查询时顺手清理超过 30 天的已读通知
    try { cleanupNotifications(); } catch { /* 忽略 */ }

    const { unread_only } = req.query as any;
    const offset = Math.max(0, Number((req.query as any).offset) || 0);
    const limit = Math.min(100, Math.max(1, Number((req.query as any).limit) || 20));
    let sql = 'SELECT * FROM notifications WHERE user_id = ?';
    const params: any[] = [req.user!.id];
    if (unread_only) { sql += ' AND is_read = 0'; }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    const notifications = db.prepare(sql).all(...params, limit, offset);
    const unreadCount = db.prepare(
      'SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0'
    ).get(req.user!.id) as { c: number };
    const total = (db.prepare(
      'SELECT COUNT(*) as c FROM notifications WHERE user_id = ?'
    ).get(req.user!.id) as { c: number }).c;
    return { notifications, unreadCount: unreadCount.c, total, offset, limit };
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
