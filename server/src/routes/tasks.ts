import type { FastifyInstance } from 'fastify';
import { db } from '../db/schema.js';
import { isCaseMember } from '../plugins/auth.js';
import { logAudit } from '../services/audit.js';
import { buildTaskIcs, buildTasksIcs, safeIcsName } from '../services/ics.js';

// 为任务列表附加多选处理人
function withAssignees(tasks: any[]) {
  if (!tasks.length) return tasks;
  const ids = tasks.map((t) => t.id);
  const ph = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT ta.task_id, u.id as user_id, u.name as user_name
     FROM task_assignees ta JOIN users u ON ta.user_id = u.id
     WHERE ta.task_id IN (${ph}) ORDER BY u.id`
  ).all(...ids) as any[];
  const map = new Map<number, any[]>();
  for (const r of rows) {
    if (!map.has(r.task_id)) map.set(r.task_id, []);
    map.get(r.task_id)!.push({ id: r.user_id, name: r.user_name });
  }
  for (const t of tasks) t.assignees = map.get(t.id) || [];
  return tasks;
}

// 当前用户是否为任务处理人
function isAssignee(tid: number, uid: number): boolean {
  return !!(db.prepare('SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ?').get(tid, uid));
}

// 规整处理人列表：去重、必须为在职用户
function resolveAssigneeIds(raw: any, fallbackUid: number): number[] {
  let ids = Array.isArray(raw)
    ? raw.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  ids = [...new Set(ids)];
  const valid = ids.filter((id) =>
    (db.prepare("SELECT 1 FROM users WHERE id = ? AND status = 'active'").get(id))
  );
  if (valid.length === 0) return [fallbackUid];
  return valid;
}

export default async function taskRoutes(app: FastifyInstance) {
  // 案件任务列表（即案件待办）
  // query: sort=due|created|order, order=asc|desc, include_expired=1, board=1（看板模式按 sort_order）
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
    const includeExpired = q.include_expired === '1';
    const statusFilter = includeExpired ? '' : " AND t.status != 'expired'";
    let orderSql = 't.created_at DESC';
    if (q.board === '1') orderSql = 't.sort_order, t.id';
    else {
      const sort = q.sort === 'created' ? 'created_at' : 'due_date';
      const order = q.order === 'asc' ? 'ASC' : 'DESC';
      orderSql = sort === 'due_date' ? `(t.due_date IS NULL), t.due_date ${order}` : `t.created_at ${order}`;
    }
    // 单案件任务软上限 500 条
    const tasks = db.prepare(
      `SELECT t.*, s.name as stage_name
       FROM tasks t
       LEFT JOIN case_stages s ON t.stage_id = s.id
       WHERE t.case_id = ?${statusFilter}
       ORDER BY ${orderSql}
       LIMIT 500`
    ).all(cid);
    return { tasks: withAssignees(tasks as any[]) };
  });

  // 创建任务（看板/待办共用）：支持多处理人、开始/截止时间、阶段、状态、优先级
  app.post('/api/cases/:id/tasks', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const b = req.body as any;
    if (!b.title?.trim()) return reply.status(400).send({ error: '任务标题必填' });
    const assigneeIds = resolveAssigneeIds(b.assignee_ids ?? b.assignee_id, req.user!.id);
    const status = ['todo', 'doing', 'done'].includes(b.status) ? b.status : 'todo';
    const priority = ['high', 'medium', 'low'].includes(b.priority) ? b.priority : 'medium';
    // 排到所在阶段（或未分配）末尾
    const stageId = b.stage_id || null;
    const maxRow = db.prepare(
      'SELECT MAX(sort_order) as m FROM tasks WHERE case_id = ? AND COALESCE(stage_id, 0) = COALESCE(?, 0)'
    ).get(cid, stageId) as any;

    const info = db.prepare(
      `INSERT INTO tasks (case_id, stage_id, title, description, assignee_id, start_date, due_date, sort_order, priority, status, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      cid, stageId, b.title.trim(), b.description?.trim() || null,
      assigneeIds[0], b.start_date || null, b.due_date || null,
      (maxRow?.m ?? -1) + 1, priority, status, status === 'done' ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null
    );
    const tid = Number(info.lastInsertRowid);
    const insTA = db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)');
    for (const uid of assigneeIds) insTA.run(tid, uid);

    logAudit(req.user!.id, 'task_create', 'task', tid, b.title.trim());
    // 通知被分配的处理人（除创建者）
    for (const uid of assigneeIds) {
      if (uid !== req.user!.id) {
        db.prepare('INSERT INTO notifications (user_id, type, content) VALUES (?, ?, ?)')
          .run(uid, 'task', `您被分配了新任务：${b.title.trim()}`);
      }
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
    db.prepare('INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)').run(tid, req.user!.id);
    logAudit(req.user!.id, 'task_create', 'task', tid, title.trim());
    return reply.status(201).send({ id: tid });
  });

  // 待办中心：当前用户作为处理人的全部任务（多选处理人通过 task_assignees 关联）
  app.get('/api/todos', async (req) => {
    const uid = req.user!.id;
    // 懒执行：先自动关闭过期任务
    db.prepare(
      `UPDATE tasks SET status = 'expired'
       WHERE status = 'todo'
         AND due_date IS NOT NULL AND due_date != ''
         AND due_date < datetime('now')
         AND id IN (SELECT task_id FROM task_assignees WHERE user_id = ?)`
    ).run(uid);

    const q = req.query as any;
    const where = ['EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?)'];
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

    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 20));
    const offset = (page - 1) * pageSize;
    const whereSql = where.join(' AND ');

    const total = (db.prepare(
      `SELECT COUNT(*) as c FROM tasks t LEFT JOIN cases c ON t.case_id = c.id WHERE ${whereSql}`
    ).get(...params) as { c: number }).c;

    const tasks = db.prepare(
      `SELECT t.*, c.name as case_name, c.case_no as case_no
       FROM tasks t LEFT JOIN cases c ON t.case_id = c.id
       WHERE ${whereSql}
       ORDER BY ${orderExpr} ${order}
       LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset);
    return { tasks: withAssignees(tasks as any[]), total, page, pageSize };
  });

  // 任务详情（二级页面）
  app.get('/api/tasks/:tid/detail', async (req, reply) => {
    const tid = Number((req.params as any).tid);
    const task = db.prepare(
      `SELECT t.*, s.name as stage_name, c.name as case_name
       FROM tasks t
       LEFT JOIN case_stages s ON t.stage_id = s.id
       LEFT JOIN cases c ON t.case_id = c.id
       WHERE t.id = ?`
    ).get(tid) as any;
    if (!task) return reply.status(404).send({ error: '任务不存在' });
    if (task.case_id && req.user!.role !== 'admin' && !isCaseMember(req.user!.id, task.case_id)) {
      return reply.status(403).send({ error: '无权访问该任务' });
    }
    withAssignees([task]);
    return { task };
  });

  // 更新任务（全字段；个人待办仅本人/管理员；案件任务限案件成员或管理员）
  app.put('/api/tasks/:tid', async (req, reply) => {
    const tid = Number((req.params as any).tid);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(tid) as any;
    if (!task) return reply.status(404).send({ error: '任务不存在' });
    const uid = req.user!.id;
    const allowed = req.user!.role === 'admin'
      || isAssignee(tid, uid)
      || (!!task.case_id && isCaseMember(uid, task.case_id));
    if (!allowed) return reply.status(403).send({ error: '无权操作该任务' });

    const b = req.body as any;
    const fields: string[] = [];
    const params: any[] = [];
    const set = (col: string, val: any) => { fields.push(`${col} = ?`); params.push(val); };

    if (b.title !== undefined) {
      if (!String(b.title).trim()) return reply.status(400).send({ error: '任务标题必填' });
      set('title', String(b.title).trim());
    }
    if (b.description !== undefined) set('description', b.description?.trim() || null);
    if (b.due_date !== undefined) set('due_date', b.due_date || null);
    if (b.start_date !== undefined) set('start_date', b.start_date || null);
    if (b.priority !== undefined) {
      if (!['high', 'medium', 'low'].includes(b.priority)) return reply.status(400).send({ error: '优先级非法' });
      set('priority', b.priority);
    }
    if (b.stage_id !== undefined) set('stage_id', b.stage_id || null);
    if (b.status !== undefined) {
      if (!['todo', 'doing', 'done', 'expired'].includes(b.status)) {
        return reply.status(400).send({ error: '状态非法' });
      }
      set('status', b.status);
      // 完成记录完成时间；从完成态改回则清空（datetime('now') 为固定表达式，直接内联）
      if (b.status === 'done') {
        fields.push("completed_at = datetime('now')");
      } else if (task.status === 'done') {
        fields.push('completed_at = NULL');
      }
    }
    if (fields.length) {
      params.push(tid);
      db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    }

    // 处理人多选更新
    if (Array.isArray(b.assignee_ids)) {
      const ids = resolveAssigneeIds(b.assignee_ids, uid);
      db.prepare('DELETE FROM task_assignees WHERE task_id = ?').run(tid);
      const insTA = db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)');
      for (const x of ids) insTA.run(tid, x);
      // assignee_id 冗余为首位处理人
      db.prepare('UPDATE tasks SET assignee_id = ? WHERE id = ?').run(ids[0], tid);
      for (const x of ids) {
        if (x !== uid) {
          db.prepare('INSERT INTO notifications (user_id, type, content) VALUES (?, ?, ?)')
            .run(x, 'task', `您被分配了任务：${task.title}`);
        }
      }
    }
    return { ok: true };
  });

  // 看板任务排序（支持跨阶段移动）
  // body: { items: [{ id, stage_id }] }，数组顺序即列内/全局顺序
  app.put('/api/cases/:id/tasks/reorder', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const { items } = req.body as { items: { id: number; stage_id: number | null }[] };
    if (!Array.isArray(items)) return reply.status(400).send({ error: '参数错误' });
    const upd = db.prepare('UPDATE tasks SET sort_order = ?, stage_id = ? WHERE id = ? AND case_id = ?');
    db.exec('BEGIN');
    try {
      items.forEach((it, i) => upd.run(i, it.stage_id ?? null, it.id, cid));
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      return reply.status(500).send({ error: '排序失败' });
    }
    return { ok: true };
  });

  // 删除任务
  app.delete('/api/tasks/:tid', async (req, reply) => {
    const tid = Number((req.params as any).tid);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(tid) as any;
    if (!task) return reply.status(404).send({ error: '任务不存在' });
    const uid = req.user!.id;
    const allowed = req.user!.role === 'admin'
      || isAssignee(tid, uid)
      || (task.case_id && isCaseMember(uid, task.case_id));
    if (!allowed) return reply.status(403).send({ error: '无权操作该任务' });
    db.prepare('DELETE FROM tasks WHERE id = ?').run(tid);
    logAudit(req.user!.id, 'task_delete', 'task', tid);
    return { ok: true };
  });

  // 批量删除任务
  app.post('/api/tasks/batch-delete', async (req, reply) => {
    const ids = (req.body as any)?.ids as number[] | undefined;
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: '请指定要删除的任务' });
    }
    if (ids.length > 200) return reply.status(400).send({ error: '一次最多删除 200 个' });
    const uid = req.user!.id;
    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(`SELECT id, case_id FROM tasks WHERE id IN (${placeholders})`).all(...ids) as any[];
    for (const t of rows) {
      const allowed = isAssignee(t.id, uid)
        || req.user!.role === 'admin'
        || (t.case_id && isCaseMember(uid, t.case_id));
      if (!allowed) return reply.status(403).send({ error: `无权删除任务 ${t.id}` });
    }
    const deleted = db.prepare(`DELETE FROM tasks WHERE id IN (${placeholders})`).run(...ids);
    logAudit(uid, 'task_batch_delete', 'task', null, `count=${deleted.changes}`);
    return { ok: true, deleted: deleted.changes };
  });

  // 批量导出 .ics
  app.get('/api/tasks/export-ics', async (req, reply) => {
    const idsParam = String((req.query as any).ids || '');
    const ids = idsParam.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length === 0) return reply.status(400).send({ error: '请指定要导出的任务' });
    if (ids.length > 200) return reply.status(400).send({ error: '一次最多导出 200 个' });

    const uid = req.user!.id;
    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT t.*, c.name as case_name FROM tasks t
       LEFT JOIN cases c ON t.case_id = c.id
       WHERE t.id IN (${placeholders})`
    ).all(...ids) as any[];

    for (const t of rows) {
      const allowed = isAssignee(t.id, uid)
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

  // 导出单个任务 .ics
  app.get('/api/tasks/:tid/export-ics', async (req, reply) => {
    const tid = Number((req.params as any).tid);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(tid) as any;
    if (!task) return reply.status(404).send({ error: '任务不存在' });
    const uid = req.user!.id;
    const allowed = req.user!.role === 'admin'
      || isAssignee(tid, uid)
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
