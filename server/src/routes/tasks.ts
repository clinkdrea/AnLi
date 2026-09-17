import type { FastifyInstance } from 'fastify';
import { db } from '../db/schema.js';
import { isCaseMember } from '../plugins/auth.js';
import { logAudit } from '../services/audit.js';
import { buildTaskIcs, buildTasksIcs, safeIcsName } from '../services/ics.js';

export default async function taskRoutes(app: FastifyInstance) {
  // 案件任务列表
  // query: sort=due|created, order=asc|desc, include_expired=1（默认隐藏 expired）
  app.get('/api/cases/:id/tasks', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    // 懒执行：自动关闭过期任务
    db.prepare(
      `UPDATE tasks SET status = 'expired'
       WHERE case_id = ? AND status = 'todo'
         AND due_date IS NOT NULL AND due_date != ''
         AND due_date < datetime('now')`
    ).run(cid);

    const q = req.query as any;
    const sort = q.sort === 'created' ? 'created_at' : 'due_date';
    const order = q.order === 'asc' ? 'ASC' : 'DESC';
    const includeExpired = q.include_expired === '1';
    // 默认只显示 todo + done（隐藏 expired）；include_expired=1 显示全部
    const statusFilter = includeExpired ? '' : " AND t.status != 'expired'";
    const tasks = db.prepare(
      `SELECT t.*, u.name as assignee_name, s.name as stage_name
       FROM tasks t
       LEFT JOIN users u ON t.assignee_id = u.id
       LEFT JOIN case_stages s ON t.stage_id = s.id
       WHERE t.case_id = ?${statusFilter}
       ORDER BY ${(sort === 'due_date' ? '(t.due_date IS NULL), t.due_date' : 't.created_at')} ${order}`
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
    // 未指定负责人时默认分配给当前操作用户，确保任务出现在其"我的待办"
    const finalAssignee = assignee_id || req.user!.id;
    const info = db.prepare(
      `INSERT INTO tasks (case_id, stage_id, title, description, assignee_id, due_date, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(cid, stage_id || null, title.trim(), description || null, finalAssignee, due_date || null, priority || 'medium');
    const tid = Number(info.lastInsertRowid);
    logAudit(req.user!.id, 'task_create', 'task', tid, title);
    // 通知负责人（仅当负责人不是创建者本人）
    if (assignee_id && assignee_id !== req.user!.id) {
      db.prepare('INSERT INTO notifications (user_id, type, content) VALUES (?, ?, ?)')
        .run(assignee_id, 'task', `您被分配了新任务：${title}`);
    }
    return reply.status(201).send({ id: tid });
  });

  // 新建个人待办（不关联案件）
  app.post('/api/tasks', async (req, reply) => {
    const { title, due_date, priority } = req.body as any;
    if (!title?.trim()) return reply.status(400).send({ error: '待办标题必填' });
    const info = db.prepare(
      `INSERT INTO tasks (case_id, title, assignee_id, due_date, priority)
       VALUES (NULL, ?, ?, ?, ?)`
    ).run(title.trim(), req.user!.id, due_date || null, priority || 'medium');
    const tid = Number(info.lastInsertRowid);
    logAudit(req.user!.id, 'task_create', 'task', tid, title.trim());
    return reply.status(201).send({ id: tid });
  });

  // 待办中心：全量查询当前用户的任务，支持筛选与排序
  // query:
  //   status=todo|expired|done|all（默认 all）
  //   case_id=N（按案件筛选）
  //   from=YYYY-MM-DD, to=YYYY-MM-DD（按截止时间范围筛选）
  //   q=关键词（标题模糊）
  //   sort=due|created（默认 due）
  //   order=asc|desc（默认 asc for due, desc for created）
  app.get('/api/todos', async (req) => {
    const uid = req.user!.id;
    // 懒执行：先自动关闭过期任务
    db.prepare(
      `UPDATE tasks SET status = 'expired'
       WHERE assignee_id = ? AND status = 'todo'
         AND due_date IS NOT NULL AND due_date != ''
         AND due_date < datetime('now')`
    ).run(uid);

    const q = req.query as any;
    const where = ['t.assignee_id = ?'];
    const params: any[] = [uid];

    const status = q.status || 'all';
    if (status !== 'all') {
      where.push('t.status = ?');
      params.push(status);
    }
    if (q.case_id) {
      where.push('t.case_id = ?');
      params.push(Number(q.case_id));
    }
    if (q.from) {
      where.push("t.due_date >= ?");
      params.push(String(q.from));
    }
    if (q.to) {
      where.push("t.due_date <= ?");
      params.push(String(q.to) + 'T23:59:59');
    }
    if (q.q) {
      where.push('t.title LIKE ?');
      params.push(`%${String(q.q)}%`);
    }

    const sort = q.sort === 'created' ? 'created_at' : 'due_date';
    const defaultOrder = sort === 'due_date' ? 'ASC' : 'DESC';
    const order = q.order === 'asc' ? 'ASC' : q.order === 'desc' ? 'DESC' : defaultOrder;
    const orderExpr = sort === 'due_date' ? '(t.due_date IS NULL), t.due_date' : 't.created_at';

    const tasks = db.prepare(
      `SELECT t.*, c.name as case_name, c.case_no as case_no
       FROM tasks t LEFT JOIN cases c ON t.case_id = c.id
       WHERE ${where.join(' AND ')}
       ORDER BY ${orderExpr} ${order}`
    ).all(...params);
    return { tasks };
  });

  // 更新任务状态（个人待办仅本人/管理员；案件任务限案件成员或管理员）
  app.put('/api/tasks/:tid', async (req, reply) => {
    const tid = Number((req.params as any).tid);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(tid) as any;
    if (!task) return reply.status(404).send({ error: '任务不存在' });
    const uid = req.user!.id;
    const caseRow = task.case_id
      ? db.prepare('SELECT lead_id FROM cases WHERE id = ?').get(task.case_id) as any
      : null;
    const allowed = req.user!.role === 'admin'
      || task.assignee_id === uid
      || (!!task.case_id && (isCaseMember(uid, task.case_id) || caseRow?.lead_id === uid));
    if (!allowed) return reply.status(403).send({ error: '无权操作该任务' });
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

  // 删除任务（权限同更新）
  app.delete('/api/tasks/:tid', async (req, reply) => {
    const tid = Number((req.params as any).tid);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(tid) as any;
    if (!task) return reply.status(404).send({ error: '任务不存在' });
    const uid = req.user!.id;
    const allowed = req.user!.role === 'admin'
      || task.assignee_id === uid
      || (task.case_id && isCaseMember(uid, task.case_id));
    if (!allowed) return reply.status(403).send({ error: '无权操作该任务' });
    db.prepare('DELETE FROM tasks WHERE id = ?').run(tid);
    logAudit(req.user!.id, 'task_delete', 'task', tid);
    return { ok: true };
  });

  // 批量删除任务
  // body: { ids: [1, 2, 3] }；权限校验同单条删除
  app.post('/api/tasks/batch-delete', async (req, reply) => {
    const ids = (req.body as any)?.ids as number[] | undefined;
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: '请指定要删除的任务' });
    }
    if (ids.length > 200) return reply.status(400).send({ error: '一次最多删除 200 个任务' });
    const uid = req.user!.id;
    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(`SELECT id, assignee_id, case_id FROM tasks WHERE id IN (${placeholders})`).all(...ids) as any[];
    // 权限校验：每个任务都要校验
    for (const t of rows) {
      const allowed = uid === t.assignee_id
        || req.user!.role === 'admin'
        || (t.case_id && isCaseMember(uid, t.case_id));
      if (!allowed) return reply.status(403).send({ error: `无权删除任务 ${t.id}` });
    }
    const deleted = db.prepare(`DELETE FROM tasks WHERE id IN (${placeholders})`).run(...ids);
    logAudit(uid, 'task_batch_delete', 'task', null, `count=${deleted.changes}`);
    return { ok: true, deleted: deleted.changes };
  });

  // 推送到 macOS 提醒事项 / 日历的接口已移除：
  // osascript 只能操作部署平台本机，远程访问（如蒲公英）场景下写入的是服务器而非当前电脑。
  // 统一改为下载 .ics 文件，双击导入当前电脑的日历（事件含 VALARM 到点提醒，可替代提醒事项）。

  // 批量导出多个任务为一个 .ics 文件（合并为单 VCALENDAR 多 VEVENT）
  // 用法：GET /api/tasks/export-ics?ids=1,2,3
  app.get('/api/tasks/export-ics', async (req, reply) => {
    const idsParam = String((req.query as any).ids || '');
    const ids = idsParam.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length === 0) return reply.status(400).send({ error: '请指定要导出的任务' });
    if (ids.length > 200) return reply.status(400).send({ error: '一次最多导出 200 个任务' });

    const uid = req.user!.id;
    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT t.*, c.name as case_name FROM tasks t
       LEFT JOIN cases c ON t.case_id = c.id
       WHERE t.id IN (${placeholders})`
    ).all(...ids) as any[];

    // 权限校验：每个任务都要校验（admin / 负责人 / 案件成员）
    for (const t of rows) {
      const allowed = uid === t.assignee_id
        || req.user!.role === 'admin'
        || (t.case_id && isCaseMember(uid, t.case_id));
      if (!allowed) return reply.status(403).send({ error: `无权导出任务 ${t.id}` });
    }

    const icsTasks = rows.map((t) => ({
      id: t.id, title: t.title, caseName: t.case_name || null,
      description: t.description || undefined, dueDate: t.due_date || null,
    }));
    const ics = buildTasksIcs(icsTasks);
    if (!ics) {
      return reply.status(400).send({ error: '所选任务都没有截止时间，无法导出日历事件，请先设置截止时间' });
    }
    const exported = icsTasks.filter((t) => t.dueDate).length;
    logAudit(uid, 'task_export_ics_batch', 'task', null, `count=${exported}/${ids.length}`);
    reply.header('Content-Type', 'text/calendar; charset=utf-8');
    reply.header('Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(`tasks-${exported}items`)}.ics`);
    return reply.send(ics);
  });

  // 导出单个任务为 .ics 日历文件
  app.get('/api/tasks/:tid/export-ics', async (req, reply) => {
    const tid = Number((req.params as any).tid);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(tid) as any;
    if (!task) return reply.status(404).send({ error: '任务不存在' });
    const uid = req.user!.id;
    const allowed = req.user!.role === 'admin'
      || task.assignee_id === uid
      || (task.case_id && isCaseMember(uid, task.case_id));
    if (!allowed) return reply.status(403).send({ error: '无权操作该任务' });
    if (!task.due_date) {
      return reply.status(400).send({ error: '任务没有截止时间，无法导出日历事件，请先设置截止时间' });
    }
    const caseName = task.case_id
      ? (db.prepare('SELECT name FROM cases WHERE id = ?').get(task.case_id) as any)?.name
      : null;
    const ics = buildTaskIcs({
      id: task.id, title: task.title, caseName,
      description: task.description || undefined, dueDate: task.due_date,
    });
    if (!ics) return reply.status(400).send({ error: '无法生成日历文件' });
    logAudit(uid, 'task_export_ics', 'task', tid, task.title);
    const fileBase = safeIcsName(task.title);
    reply.header('Content-Type', 'text/calendar; charset=utf-8');
    reply.header('Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileBase)}.ics`);
    return reply.send(ics);
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
