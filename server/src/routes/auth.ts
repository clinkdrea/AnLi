import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { db } from '../db/schema.js';
import { signToken } from '../plugins/auth.js';
import { logAudit } from '../services/audit.js';

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req, reply) => {
    const { account, password } = req.body as { account: string; password: string };
    const row = db.prepare(
      'SELECT id, name, account, password_hash, role FROM users WHERE account = ? AND status = ?'
    ).get(account, 'active') as { id: number; name: string; account: string; password_hash: string; role: string } | undefined;
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      logAudit(null, 'login_failed', 'user', account);
      return reply.status(401).send({ error: '账号或密码错误' });
    }
    const user = { id: row.id, name: row.name, account: row.account, role: row.role as any };
    const token = signToken(user);
    reply.setCookie('token', token, { httpOnly: true, path: '/', maxAge: 7 * 24 * 60 * 60, sameSite: 'lax' });
    logAudit(row.id, 'login');
    return { user, token };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    reply.clearCookie('token');
    logAudit(req.user?.id ?? null, 'logout');
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ user: req.user }));
}
