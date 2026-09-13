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

export default async function caseRoutes(app: FastifyInstance) {
  app.get('/api/cases', async (req) => {
    const { type, status, keyword } = req.query as any;
    let sql = `SELECT c.*, u.name as lead_name FROM cases c LEFT JOIN users u ON c.lead_id = u.id WHERE 1=1`;
    const params: any[] = [];
    if (req.user!.role !== 'admin') {
      sql += ` AND c.id IN (SELECT case_id FROM case_members WHERE user_id = ?)`;
      params.push(req.user!.id);
    }
    if (type) { sql += ` AND c.type = ?`; params.push(type); }
    if (status) { sql += ` AND c.status = ?`; params.push(status); }
    if (keyword) { sql += ` AND c.name LIKE ?`; params.push(`%${keyword}%`); }
    sql += ` ORDER BY c.created_at DESC`;
    const cases = db.prepare(sql).all(...params);
    return { cases, typeLabels: CASE_TYPE_LABELS };
  });

  app.get('/api/cases/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const cid = Number(id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问该案件' });
    }
    const caseRow = db.prepare('SELECT * FROM cases WHERE id = ?').get(cid) as any;
    if (!caseRow) return reply.status(404).send({ error: '案件不存在' });
    const parties = db.prepare('SELECT * FROM case_parties WHERE case_id = ? ORDER BY side, id').all(cid);
    const related = db.prepare('SELECT * FROM related_parties WHERE case_id = ?').all(cid);
    const legal = db.prepare('SELECT * FROM case_legal_info WHERE case_id = ?').get(cid);
    const stages = db.prepare('SELECT * FROM case_stages WHERE case_id = ? ORDER BY sort_order').all(cid);
    const members = db.prepare(
      'SELECT u.id, u.name, u.role FROM case_members cm JOIN users u ON cm.user_id = u.id WHERE cm.case_id = ?'
    ).all(cid);
    return { case: caseRow, parties, related, legal, stages, members };
  });

  app.post('/api/cases', async (req, reply) => {
    const role = req.user!.role;
    if (role !== 'admin' && role !== 'lead') {
      return reply.status(403).send({ error: '仅管理员与主办律师可创建案件' });
    }
    const body = req.body as any;
    const { name, type, parties, relatedParties, legal, stages } = body;
    if (!name || !type || !parties?.our?.name || !parties?.opponent?.name) {
      return reply.status(400).send({ error: '案件名称、类型、我方/对方当事人为必填' });
    }
    const caseNo = genCaseNo(type);
    const folderName = `${caseNo}-${name}`;
    const folderPath = path.join(CASES_DIR, folderName);
    fs.mkdirSync(folderPath, { recursive: true });

    db.exec('BEGIN');
    try {
      const info = db.prepare(
        'INSERT INTO cases (case_no, name, type, lead_id, folder_path) VALUES (?, ?, ?, ?, ?)'
      ).run(caseNo, name, type, req.user!.id, folderPath);
      const cid = Number(info.lastInsertRowid);

      const insParty = db.prepare(
        'INSERT INTO case_parties (case_id, side, name, party_type, contact, relation) VALUES (?, ?, ?, ?, ?, ?)'
      );
      insParty.run(cid, 'our', parties.our.name, parties.our.party_type || 'natural', parties.our.contact || null, parties.our.relation || null);
      insParty.run(cid, 'opponent', parties.opponent.name, parties.opponent.party_type || 'natural', parties.opponent.contact || null, parties.opponent.relation || null);
      for (const t of parties.third || []) {
        insParty.run(cid, 'third', t.name, t.party_type || 'natural', t.contact || null, t.relation || null);
      }

      const insRel = db.prepare('INSERT INTO related_parties (case_id, name, relation_type) VALUES (?, ?, ?)');
      for (const r of relatedParties || []) insRel.run(cid, r.name, r.relation_type);

      db.prepare(
        'INSERT INTO case_legal_info (case_id, cause, court_case_no, amount, entrust_start) VALUES (?, ?, ?, ?, ?)'
      ).run(cid, legal?.cause || null, legal?.court_case_no || null, legal?.amount || null, legal?.entrust_start || null);

      const stageList = stages?.length ? stages : STAGE_TEMPLATES[type] || STAGE_TEMPLATES.other;
      const insStage = db.prepare('INSERT INTO case_stages (case_id, name, sort_order) VALUES (?, ?, ?)');
      stageList.forEach((s: string, i: number) => insStage.run(cid, s, i));

      db.prepare('INSERT INTO case_members (case_id, user_id) VALUES (?, ?)').run(cid, req.user!.id);
      logAudit(req.user!.id, 'case_create', 'case', cid, `${caseNo} ${name}`);
      db.exec('COMMIT');
      return reply.status(201).send({ id: cid, case_no: caseNo });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  });

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
