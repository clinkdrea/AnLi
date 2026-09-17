import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import { db, CASES_DIR } from '../db/schema.js';
import { STAGE_TEMPLATES, CASE_TYPE_LABELS } from '../db/seed.js';
import { isCaseMember } from '../plugins/auth.js';
import { logAudit } from '../services/audit.js';

function genCaseNo(type: string): string {
  const year = new Date().getFullYear();
  const prefix = type.toUpperCase().slice(0, 3);
  const row = db.prepare("SELECT COUNT(*) as c FROM cases WHERE case_no LIKE ?").get(`${year}-${prefix}-%`) as { c: number };
  const seq = String(row.c + 1).padStart(3, '0');
  return `${year}-${prefix}-${seq}`;
}

interface ContactInput {
  category?: string; side?: string; name: string; party_type?: string;
  id_number?: string; phone?: string; address?: string;
  organization?: string; role?: string; remark?: string;
}

export default async function caseRoutes(app: FastifyInstance) {
  // 案件列表：关键字搜名称/编号/法院/案号/当事人姓名，支持类型与状态筛选
  // 翻页：page（1-based，默认 1）、pageSize（默认 20，最大 100）
  app.get('/api/cases', async (req) => {
    const { type, status, keyword } = req.query as any;
    const page = Math.max(1, Number((req.query as any).page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number((req.query as any).pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const where: string[] = [];
    const params: any[] = [];
    if (req.user!.role !== 'admin') {
      where.push(`c.id IN (SELECT case_id FROM case_members WHERE user_id = ?)`);
      params.push(req.user!.id);
    }
    if (type) { where.push(`c.type = ?`); params.push(type); }
    if (status) { where.push(`c.status = ?`); params.push(status); }
    if (keyword?.trim()) {
      const kw = `%${keyword.trim()}%`;
      where.push(`(
        c.name LIKE ? OR c.case_no LIKE ? OR c.court LIKE ?
        OR (SELECT court_case_no FROM case_legal_info WHERE case_id = c.id) LIKE ?
        OR EXISTS (SELECT 1 FROM case_parties p WHERE p.case_id = c.id AND p.name LIKE ?)
      )`);
      params.push(kw, kw, kw, kw, kw);
    }
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

    // 总数
    const total = (db.prepare(
      `SELECT COUNT(*) as c FROM cases c${whereSql}`
    ).get(...params) as { c: number }).c;

    const sql = `SELECT c.*, u.name as lead_name FROM cases c
                 LEFT JOIN users u ON c.lead_id = u.id${whereSql}
                 ORDER BY c.created_at DESC LIMIT ? OFFSET ?`;
    const cases = db.prepare(sql).all(...params, pageSize, offset);
    return { cases, total, page, pageSize, typeLabels: CASE_TYPE_LABELS };
  });

  // 案件下拉选择：返回当前用户可见的全部案件（仅 id/name/case_no），供筛选下拉使用，不分页
  app.get('/api/cases/select', async (req) => {
    const params: any[] = [];
    let sql = `SELECT c.id, c.case_no, c.name FROM cases c WHERE 1=1`;
    if (req.user!.role !== 'admin') {
      sql += ` AND c.id IN (SELECT case_id FROM case_members WHERE user_id = ?)`;
      params.push(req.user!.id);
    }
    sql += ` ORDER BY c.created_at DESC`;
    const cases = db.prepare(sql).all(...params);
    return { cases };
  });

  // 案件详情
  app.get('/api/cases/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const cid = Number(id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问该案件' });
    }
    const caseRow = db.prepare('SELECT * FROM cases WHERE id = ?').get(cid) as any;
    if (!caseRow) return reply.status(404).send({ error: '案件不存在' });
    // 记录近期打开（仅案件成员；用于看板"近期打开"展示）
    db.prepare("UPDATE case_members SET last_opened_at = datetime('now') WHERE case_id = ? AND user_id = ?")
      .run(cid, req.user!.id);
    const parties = db.prepare('SELECT * FROM case_parties WHERE case_id = ? ORDER BY side, id').all(cid);
    const related = db.prepare('SELECT * FROM related_parties WHERE case_id = ?').all(cid);
    const legal = db.prepare('SELECT * FROM case_legal_info WHERE case_id = ?').get(cid);
    const stages = db.prepare('SELECT * FROM case_stages WHERE case_id = ? ORDER BY sort_order').all(cid);
    const members = db.prepare(
      'SELECT u.id, u.name, u.role FROM case_members cm JOIN users u ON cm.user_id = u.id WHERE cm.case_id = ?'
    ).all(cid);
    return { case: caseRow, parties, related, legal, stages, members };
  });

  // 创建案件：联系人按分类提交（我方/对方/第三人/法院人员/其他联系人）
  app.post('/api/cases', async (req, reply) => {
    const role = req.user!.role;
    if (role !== 'admin' && role !== 'lead') {
      return reply.status(403).send({ error: '仅管理员与主办律师可创建案件' });
    }
    const body = req.body as any;
    // 兼容两种提交结构：顶层字段 或 legal 嵌套对象（NewCaseModal）
    const legalBody = body.legal || {};
    const pick = (k: string) => (body[k] !== undefined ? body[k] : legalBody[k]);
    const name = pick('name');
    const type = pick('type');
    const court = pick('court');
    const hearingDate = pick('hearing_date') || pick('hearing_at') || null;
    const summary = pick('summary');
    const cause = pick('cause');
    const court_case_no = pick('court_case_no');
    const amount = pick('amount');
    const entrust_start = pick('entrust_start');
    const { contacts } = body;
    if (!name?.trim() || !type) return reply.status(400).send({ error: '案件名称与类型为必填' });
    if (!hearingDate) return reply.status(400).send({ error: '开庭时间为必填' });
    const list: ContactInput[] = Array.isArray(contacts) ? contacts : [];
    const hasOur = list.some((c) => c.category === 'our' && c.name?.trim());
    const hasOpp = list.some((c) => c.category === 'opponent' && c.name?.trim());
    if (!hasOur || !hasOpp) {
      return reply.status(400).send({ error: '我方与对方当事人为必填' });
    }

    const caseNo = genCaseNo(type);
    const folderName = `${caseNo}-${name}`;
    const folderPath = path.join(CASES_DIR, folderName);
    fs.mkdirSync(folderPath, { recursive: true });

    db.exec('BEGIN');
    try {
      const info = db.prepare(
        'INSERT INTO cases (case_no, name, type, lead_id, folder_path, court, hearing_date, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(caseNo, name.trim(), type, req.user!.id, folderPath, court || null, hearingDate, summary || null);
      const cid = Number(info.lastInsertRowid);

      const insParty = db.prepare(
        `INSERT INTO case_parties (case_id, side, name, party_type, id_number, phone, address, organization, role, remark)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const c of list) {
        if (!c.name?.trim()) continue;
        const side = c.category || 'contact';
        // 法院人员/其他联系人默认自然人；当事人可选自然人/法人
        const ptype = (side === 'our' || side === 'opponent' || side === 'third') ? (c.party_type || 'natural') : 'natural';
        insParty.run(cid, side, c.name.trim(), ptype,
          c.id_number || null, c.phone || null, c.address || null,
          c.organization || null, c.role || null, c.remark || null);
      }

      db.prepare(
        'INSERT INTO case_legal_info (case_id, cause, court_case_no, amount, entrust_start) VALUES (?, ?, ?, ?, ?)'
      ).run(cid, cause || null, court_case_no || null, amount || null, entrust_start || null);

      const stageList = STAGE_TEMPLATES[type] || STAGE_TEMPLATES.other;
      const insStage = db.prepare('INSERT INTO case_stages (case_id, name, sort_order) VALUES (?, ?, ?)');
      stageList.forEach((s: string, i: number) => insStage.run(cid, s, i));

      db.prepare('INSERT INTO case_members (case_id, user_id) VALUES (?, ?)').run(cid, req.user!.id);

      // 开庭时间自动记入待办（负责人=主办律师，高优先级）
      db.prepare(
        `INSERT INTO tasks (case_id, title, assignee_id, due_date, priority, kind)
         VALUES (?, '开庭', ?, ?, 'high', 'hearing')`
      ).run(cid, req.user!.id, hearingDate);

      logAudit(req.user!.id, 'case_create', 'case', cid, `${caseNo} ${name}`);
      db.exec('COMMIT');
      return reply.status(201).send({ id: cid, case_no: caseNo });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  });

  // 编辑案件基本信息
  app.patch('/api/cases/:id', async (req, reply) => {
    const cid = Number((req.params as any).id);
    const caseRow = db.prepare('SELECT * FROM cases WHERE id = ?').get(cid) as any;
    if (!caseRow) return reply.status(404).send({ error: '案件不存在' });
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问该案件' });
    }
    const b = req.body as any;
    const fields: string[] = [];
    const params: any[] = [];
    for (const k of ['name', 'court', 'hearing_date', 'summary']) {
      if (b[k] !== undefined) { fields.push(`${k} = ?`); params.push(b[k] || null); }
    }
    if (fields.length) {
      db.prepare(`UPDATE cases SET ${fields.join(', ')} WHERE id = ?`).run(...params, cid);
    }
    // 开庭时间变更时同步自动生成的开庭待办
    if (b.hearing_date !== undefined) {
      const hd = b.hearing_date || null;
      const hearingTask = db.prepare(
        "SELECT id FROM tasks WHERE case_id = ? AND kind = 'hearing' AND status != 'done'"
      ).get(cid) as { id: number } | undefined;
      if (hd) {
        if (hearingTask) {
          db.prepare('UPDATE tasks SET due_date = ? WHERE id = ?').run(hd, hearingTask.id);
        } else {
          db.prepare(
            "INSERT INTO tasks (case_id, title, assignee_id, due_date, priority, kind) VALUES (?, '开庭', ?, ?, 'high', 'hearing')"
          ).run(cid, caseRow.lead_id, hd);
        }
      } else if (hearingTask) {
        db.prepare('DELETE FROM tasks WHERE id = ?').run(hearingTask.id);
      }
    }
    // 法律信息：案由/案号
    const legalFields: string[] = [];
    const legalParams: any[] = [];
    for (const k of ['cause', 'court_case_no']) {
      if (b[k] !== undefined) { legalFields.push(`${k} = ?`); legalParams.push(b[k] || null); }
    }
    if (legalFields.length) {
      db.prepare(`UPDATE case_legal_info SET ${legalFields.join(', ')} WHERE case_id = ?`).run(...legalParams, cid);
    }
    // 案件状态变更：仅主办律师或管理员
    if (b.status !== undefined && b.status !== caseRow.status) {
      if (!['active', 'closed', 'archived'].includes(b.status)) {
        return reply.status(400).send({ error: '非法状态值' });
      }
      if (req.user!.role !== 'admin' && caseRow.lead_id !== req.user!.id) {
        return reply.status(403).send({ error: '仅主办律师或管理员可变更案件状态' });
      }
      if (b.status === 'closed') {
        db.prepare("UPDATE cases SET status='closed', closed_at=COALESCE(closed_at, datetime('now')) WHERE id=?").run(cid);
      } else if (caseRow.status === 'closed') {
        // 从结案状态改回办理中/归档：清除结案时间
        db.prepare('UPDATE cases SET status=?, closed_at=NULL WHERE id=?').run(b.status, cid);
      } else {
        db.prepare('UPDATE cases SET status=? WHERE id=?').run(b.status, cid);
      }
      logAudit(req.user!.id, 'case_status_change', 'case', cid, `${caseRow.status} -> ${b.status}`);
    }
    logAudit(req.user!.id, 'case_update', 'case', cid);
    return { ok: true };
  });

  // ---- 联系人（当事人/法院人员等）CRUD ----

  // 新增联系人
  app.post('/api/cases/:id/parties', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问该案件' });
    }
    const b = req.body as ContactInput;
    if (!b.name?.trim()) return reply.status(400).send({ error: '姓名/名称必填' });
    const side = b.category || b.side || 'contact';
    const ptype = (side === 'our' || side === 'opponent' || side === 'third') ? (b.party_type || 'natural') : 'natural';
    const info = db.prepare(
      `INSERT INTO case_parties (case_id, side, name, party_type, id_number, phone, address, organization, role, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(cid, side, b.name.trim(), ptype, b.id_number || null, b.phone || null,
      b.address || null, b.organization || null, b.role || null, b.remark || null);
    logAudit(req.user!.id, 'party_create', 'case_party', Number(info.lastInsertRowid), `case=${cid}`);
    return reply.status(201).send({ id: Number(info.lastInsertRowid) });
  });

  // 编辑联系人
  app.put('/api/parties/:pid', async (req, reply) => {
    const pid = Number((req.params as any).pid);
    const party = db.prepare('SELECT * FROM case_parties WHERE id = ?').get(pid) as any;
    if (!party) return reply.status(404).send({ error: '联系人不存在' });
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, party.case_id)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const b = req.body as any;
    const map: Record<string, any> = {
      name: b.name, party_type: b.party_type, id_number: b.id_number, phone: b.phone,
      address: b.address, organization: b.organization, role: b.role, remark: b.remark,
    };
    const fields: string[] = [];
    const params: any[] = [];
    for (const [k, v] of Object.entries(map)) {
      if (v !== undefined) { fields.push(`${k} = ?`); params.push(v || null); }
    }
    if (fields.length) {
      db.prepare(`UPDATE case_parties SET ${fields.join(', ')} WHERE id = ?`).run(...params, pid);
      logAudit(req.user!.id, 'party_update', 'case_party', pid);
    }
    return { ok: true };
  });

  // 删除联系人
  app.delete('/api/parties/:pid', async (req, reply) => {
    const pid = Number((req.params as any).pid);
    const party = db.prepare('SELECT * FROM case_parties WHERE id = ?').get(pid) as any;
    if (!party) return reply.status(404).send({ error: '联系人不存在' });
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, party.case_id)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    db.prepare('DELETE FROM case_parties WHERE id = ?').run(pid);
    logAudit(req.user!.id, 'party_delete', 'case_party', pid, party.name);
    return { ok: true };
  });

  // 可分配用户列表（主办律师或管理员添加案件成员时使用）
  app.get('/api/users/assignable', async (req, reply) => {
    if (req.user!.role !== 'admin' && req.user!.role !== 'lead') {
      return reply.status(403).send({ error: '仅主办律师或管理员可获取用户列表' });
    }
    const users = db.prepare("SELECT id, name, role FROM users WHERE status = 'active' ORDER BY id").all();
    return { users };
  });

  // 添加成员
  app.post('/api/cases/:id/members', async (req, reply) => {
    const { id } = req.params as { id: string };
    const cid = Number(id);
    const { user_id } = req.body as { user_id: number };
    const caseRow = db.prepare('SELECT lead_id FROM cases WHERE id = ?').get(cid) as any;
    if (!caseRow) return reply.status(404).send({ error: '案件不存在' });
    if (req.user!.role !== 'admin' && caseRow.lead_id !== req.user!.id) {
      return reply.status(403).send({ error: '仅主办律师或管理员可管理成员' });
    }
    db.prepare('INSERT OR IGNORE INTO case_members (case_id, user_id) VALUES (?, ?)').run(cid, user_id);
    logAudit(req.user!.id, 'case_add_member', 'case', cid, `user=${user_id}`);
    return { ok: true };
  });

  // 移除成员（不能移除主办律师）
  app.delete('/api/cases/:id/members/:userId', async (req, reply) => {
    const cid = Number((req.params as any).id);
    const uid = Number((req.params as any).userId);
    const caseRow = db.prepare('SELECT lead_id FROM cases WHERE id = ?').get(cid) as any;
    if (!caseRow) return reply.status(404).send({ error: '案件不存在' });
    if (req.user!.role !== 'admin' && caseRow.lead_id !== req.user!.id) {
      return reply.status(403).send({ error: '仅主办律师或管理员可管理成员' });
    }
    if (uid === caseRow.lead_id) return reply.status(400).send({ error: '不能移除主办律师' });
    db.prepare('DELETE FROM case_members WHERE case_id = ? AND user_id = ?').run(cid, uid);
    logAudit(req.user!.id, 'case_remove_member', 'case', cid, `user=${uid}`);
    return { ok: true };
  });

  // 置顶/取消置顶（按成员维度，各成员独立）
  app.post('/api/cases/:id/pin', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问该案件' });
    }
    const { pinned } = req.body as { pinned?: boolean };
    db.prepare('UPDATE case_members SET pinned = ? WHERE case_id = ? AND user_id = ?')
      .run(pinned ? 1 : 0, cid, req.user!.id);
    return { ok: true };
  });

  // 结案
  app.post('/api/cases/:id/close', async (req, reply) => {
    const { id } = req.params as { id: string };
    const cid = Number(id);
    const { close_date, close_method } = req.body as any;
    const caseRow = db.prepare('SELECT lead_id FROM cases WHERE id = ?').get(cid) as any;
    if (req.user!.role !== 'admin' && caseRow.lead_id !== req.user!.id) {
      return reply.status(403).send({ error: '仅主办律师或管理员可结案' });
    }
    db.prepare("UPDATE cases SET status='closed', closed_at=?, close_method=? WHERE id=?")
      .run(close_date || new Date().toISOString(), close_method || null, cid);
    db.prepare('UPDATE case_legal_info SET close_date = ? WHERE case_id = ?').run(close_date || null, cid);
    logAudit(req.user!.id, 'case_close', 'case', cid, close_method);
    return { ok: true };
  });
}
