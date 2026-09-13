import type { FastifyInstance } from 'fastify';
import { db } from '../db/schema.js';
import { isCaseMember } from '../plugins/auth.js';

export default async function evidenceRoutes(app: FastifyInstance) {
  app.get('/api/cases/:id/evidences', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const evidences = db.prepare(
      `SELECT e.*, f.file_name FROM evidences e
       LEFT JOIN file_records f ON e.file_id = f.id
       WHERE e.case_id = ? ORDER BY e.id`
    ).all(cid);
    return { evidences };
  });

  app.post('/api/cases/:id/evidences', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const { group_name, name, source, purpose, file_id, remark } = req.body as any;
    if (!name?.trim()) return reply.status(400).send({ error: '证据名称必填' });
    const info = db.prepare(
      `INSERT INTO evidences (case_id, group_name, name, source, purpose, file_id, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(cid, group_name || null, name.trim(), source || null, purpose || null, file_id || null, remark || null);
    return reply.status(201).send({ id: Number(info.lastInsertRowid) });
  });

  app.put('/api/evidences/:eid', async (req) => {
    const eid = Number((req.params as any).eid);
    const { group_name, name, source, purpose, file_id, remark } = req.body as any;
    db.prepare(
      `UPDATE evidences SET group_name=?, name=?, source=?, purpose=?, file_id=?, remark=? WHERE id=?`
    ).run(group_name || null, name, source || null, purpose || null, file_id || null, remark || null, eid);
    return { ok: true };
  });

  app.delete('/api/evidences/:eid', async (req) => {
    const eid = Number((req.params as any).eid);
    db.prepare('DELETE FROM evidences WHERE id = ?').run(eid);
    return { ok: true };
  });
}
