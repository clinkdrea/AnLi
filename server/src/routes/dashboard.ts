import type { FastifyInstance } from 'fastify';
import { db } from '../db/schema.js';

// 懒执行：把当前用户已过期但仍为 todo 的任务自动标记为 expired
// due_date 格式 YYYY-MM-DD 或 YYYY-MM-DDTHH:MM；与 datetime('now') 字典序比较即可
function expireOverdueTasks(uid: number) {
  db.prepare(
    `UPDATE tasks SET status = 'expired'
     WHERE assignee_id = ? AND status = 'todo'
       AND due_date IS NOT NULL AND due_date != ''
       AND due_date < datetime('now')`
  ).run(uid);
}

export default async function dashboardRoutes(app: FastifyInstance) {
  app.get('/api/dashboard', async (req) => {
    const uid = req.user!.id;
    // 先把过期任务自动关闭，确保待办列表只显示尚未过期的
    expireOverdueTasks(uid);
    const myCases = db.prepare(
      `SELECT c.id, c.case_no, c.name, c.type, c.status, cm.pinned, cm.last_opened_at, c.created_at
       FROM cases c
       JOIN case_members cm ON cm.case_id = c.id
       WHERE cm.user_id = ?
       ORDER BY cm.pinned DESC, cm.last_opened_at DESC, c.created_at DESC LIMIT 200`
    ).all(uid);

    // 我的待办：只显示 status='todo'（不含过期、已完成）
    const myTasks = db.prepare(
      `SELECT t.*, c.name as case_name FROM tasks t LEFT JOIN cases c ON t.case_id = c.id
       WHERE t.assignee_id = ? AND t.status = 'todo'
       ORDER BY (t.due_date IS NULL), t.due_date ASC LIMIT 50`
    ).all(uid);

    const recentComments = db.prepare(
      `SELECT cm.*, c.name as case_name, u.name as author_name FROM comments cm
       JOIN cases c ON cm.case_id = c.id
       JOIN users u ON cm.author_id = u.id
       JOIN case_members m ON m.case_id = c.id
       WHERE m.user_id = ? ORDER BY cm.created_at DESC LIMIT 20`
    ).all(uid);

    const unreadCount = db.prepare(
      'SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0'
    ).get(uid) as { c: number };

    return { myCases, myTasks, recentComments, unreadCount: unreadCount.c };
  });
}
