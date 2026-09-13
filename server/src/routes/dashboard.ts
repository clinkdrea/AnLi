import type { FastifyInstance } from 'fastify';
import { db } from '../db/schema.js';

export default async function dashboardRoutes(app: FastifyInstance) {
  app.get('/api/dashboard', async (req) => {
    const uid = req.user!.id;
    const myCases = db.prepare(
      `SELECT c.id, c.case_no, c.name, c.type, c.status FROM cases c
       JOIN case_members cm ON cm.case_id = c.id
       WHERE cm.user_id = ? ORDER BY c.created_at DESC LIMIT 10`
    ).all(uid);

    const myTasks = db.prepare(
      `SELECT t.*, c.name as case_name FROM tasks t JOIN cases c ON t.case_id = c.id
       WHERE t.assignee_id = ? AND t.status != 'done' ORDER BY t.due_date ASC LIMIT 20`
    ).all(uid);

    const upcoming = db.prepare(
      `SELECT d.*, c.name as case_name FROM deadlines d JOIN cases c ON d.case_id = c.id
       JOIN case_members cm ON cm.case_id = c.id
       WHERE cm.user_id = ? AND date(d.due_at) <= date('now','+3 days')
       ORDER BY d.due_at ASC`
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

    return { myCases, myTasks, upcoming, recentComments, unreadCount: unreadCount.c };
  });
}
