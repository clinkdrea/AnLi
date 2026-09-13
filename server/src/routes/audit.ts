import type { FastifyInstance } from 'fastify';
import { db } from '../db/schema.js';

export default async function auditRoutes(app: FastifyInstance) {
  app.get('/api/audit/logs', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.status(403).send({ error: '仅管理员' });
    const { action, user_id, object_type, from, to, limit } = req.query as any;
    let sql = `SELECT al.*, u.name as user_name FROM audit_logs al
               LEFT JOIN users u ON al.user_id = u.id WHERE 1=1`;
    const params: any[] = [];
    if (action) { sql += ' AND al.action = ?'; params.push(action); }
    if (user_id) { sql += ' AND al.user_id = ?'; params.push(user_id); }
    if (object_type) { sql += ' AND al.object_type = ?'; params.push(object_type); }
    if (from) { sql += ' AND al.created_at >= ?'; params.push(from); }
    if (to) { sql += ' AND al.created_at <= ?'; params.push(to); }
    sql += ' ORDER BY al.created_at DESC LIMIT ?';
    params.push(Number(limit) || 200);
    const logs = db.prepare(sql).all(...params);
    return { logs };
  });

  // 操作统计报表
  app.get('/api/audit/stats', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.status(403).send({ error: '仅管理员' });
    const byAction = db.prepare(
      'SELECT action, COUNT(*) as count FROM audit_logs GROUP BY action ORDER BY count DESC'
    ).all();
    const byUser = db.prepare(
      `SELECT u.name, COUNT(*) as count FROM audit_logs al JOIN users u ON al.user_id = u.id
       GROUP BY al.user_id ORDER BY count DESC LIMIT 20`
    ).all();
    const recent7Days = db.prepare(
      `SELECT date(created_at) as day, COUNT(*) as count FROM audit_logs
       WHERE created_at >= date('now', '-7 days') GROUP BY day ORDER BY day`
    ).all();
    return { byAction, byUser, recent7Days };
  });
}
