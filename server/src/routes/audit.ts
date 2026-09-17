import type { FastifyInstance } from 'fastify';
import { db } from '../db/schema.js';
import { cleanupAuditLogs } from '../services/cleanup.js';

export default async function auditRoutes(app: FastifyInstance) {
  app.get('/api/audit/logs', async (req, reply) => {
    // 懒执行：查询时顺手清理超过 90 天的审计日志
    try { cleanupAuditLogs(); } catch { /* 忽略 */ }

    if (req.user!.role !== 'admin') return reply.status(403).send({ error: '仅管理员' });
    const { action, user_id, object_type, from, to } = req.query as any;
    const page = Math.max(1, Number((req.query as any).page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number((req.query as any).pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const where: string[] = [];
    const params: any[] = [];
    if (action) { where.push('al.action = ?'); params.push(action); }
    if (user_id) { where.push('al.user_id = ?'); params.push(user_id); }
    if (object_type) { where.push('al.object_type = ?'); params.push(object_type); }
    if (from) { where.push('al.created_at >= ?'); params.push(from); }
    if (to) { where.push('al.created_at <= ?'); params.push(to); }
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

    const total = (db.prepare(
      `SELECT COUNT(*) as c FROM audit_logs al${whereSql}`
    ).get(...params) as { c: number }).c;

    const logs = db.prepare(
      `SELECT al.*, u.name as user_name FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id${whereSql}
       ORDER BY al.created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset);
    return { logs, total, page, pageSize };
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
