import type { FastifyInstance } from 'fastify';
import { db } from '../db/schema.js';

export default async function knowledgeRoutes(app: FastifyInstance) {
  // 分类列表
  app.get('/api/knowledge/categories', async () => {
    const categories = db.prepare('SELECT * FROM knowledge_categories ORDER BY sort_order').all();
    return { categories };
  });

  app.post('/api/knowledge/categories', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.status(403).send({ error: '仅管理员' });
    const { name } = req.body as any;
    const max = db.prepare('SELECT MAX(sort_order) as m FROM knowledge_categories').get() as any;
    const info = db.prepare('INSERT INTO knowledge_categories (name, sort_order) VALUES (?, ?)').run(name, (max?.m ?? -1) + 1);
    return reply.status(201).send({ id: Number(info.lastInsertRowid) });
  });

  // 文档列表
  app.get('/api/knowledge/docs', async (req) => {
    const { category_id, q } = req.query as any;
    let sql = `SELECT kd.*, u.name as creator_name, kc.name as category_name
               FROM knowledge_docs kd
               LEFT JOIN users u ON kd.creator_id = u.id
               LEFT JOIN knowledge_categories kc ON kd.category_id = kc.id
               WHERE (kd.visibility = 'shared' OR kd.creator_id = ?)`;
    const params: any[] = [req.user!.id];
    if (category_id) { sql += ' AND kd.category_id = ?'; params.push(category_id); }
    if (q) { sql += ' AND (kd.title LIKE ? OR kd.content LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
    sql += ' ORDER BY kd.updated_at DESC';
    const docs = db.prepare(sql).all(...params);
    return { docs };
  });

  // 文档详情
  app.get('/api/knowledge/docs/:id', async (req, reply) => {
    const did = Number((req.params as any).id);
    const doc = db.prepare('SELECT * FROM knowledge_docs WHERE id = ?').get(did) as any;
    if (!doc) return reply.status(404).send({ error: '不存在' });
    if (doc.visibility === 'private' && doc.creator_id !== req.user!.id && req.user!.role !== 'admin') {
      return reply.status(403).send({ error: '无权访问' });
    }
    return { doc };
  });

  // 创建文档
  app.post('/api/knowledge/docs', async (req, reply) => {
    const { title, category_id, tags, content, visibility } = req.body as any;
    if (!title?.trim()) return reply.status(400).send({ error: '标题必填' });
    const info = db.prepare(
      `INSERT INTO knowledge_docs (title, category_id, tags, content, visibility, creator_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(title.trim(), category_id || null, tags || null, content || '', visibility || 'shared', req.user!.id);
    return reply.status(201).send({ id: Number(info.lastInsertRowid) });
  });

  app.put('/api/knowledge/docs/:id', async (req, reply) => {
    const did = Number((req.params as any).id);
    const { title, category_id, tags, content, visibility } = req.body as any;
    db.prepare(
      `UPDATE knowledge_docs SET title=?, category_id=?, tags=?, content=?, visibility=?, updated_at=datetime('now') WHERE id=?`
    ).run(title, category_id || null, tags || null, content || '', visibility || 'shared', did);
    return { ok: true };
  });

  app.delete('/api/knowledge/docs/:id', async (req) => {
    const did = Number((req.params as any).id);
    db.prepare('DELETE FROM knowledge_docs WHERE id = ?').run(did);
    return { ok: true };
  });
}
