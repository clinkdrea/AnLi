import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { db } from '../db/schema.js';
import { logAudit } from '../services/audit.js';

export default async function userRoutes(app: FastifyInstance) {
  app.get('/api/users', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.status(403).send({ error: '仅管理员可查看' });
    const users = db.prepare('SELECT id, name, account, role, status, created_at FROM users ORDER BY id').all();
    return { users };
  });

  app.post('/api/users', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.status(403).send({ error: '仅管理员可创建' });
    const { name, account, password, role } = req.body as any;
    if (!name || !account || !password || !role) return reply.status(400).send({ error: '参数不全' });
    const hash = bcrypt.hashSync(password, 10);
    try {
      const info = db.prepare(
        'INSERT INTO users (name, account, password_hash, role) VALUES (?, ?, ?, ?)'
      ).run(name, account, hash, role);
      logAudit(req.user!.id, 'user_create', 'user', info.lastInsertRowid, account);
      return { id: info.lastInsertRowid };
    } catch {
      return reply.status(400).send({ error: '账号已存在' });
    }
  });
}
