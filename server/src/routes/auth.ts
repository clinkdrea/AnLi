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

  // 个人信息：查看本人完整资料
  app.get('/api/profile', async (req, reply) => {
    const row = db.prepare('SELECT id, name, account, role, status, created_at FROM users WHERE id = ?')
      .get(req.user!.id) as any;
    if (!row) return reply.status(404).send({ error: '用户不存在' });
    return { user: row };
  });

  // 个人信息：自助修改密码（需校验原密码）
  app.put('/api/profile/password', async (req, reply) => {
    const { oldPassword, newPassword } = req.body as { oldPassword?: string; newPassword?: string };
    if (!oldPassword || !newPassword) return reply.status(400).send({ error: '原密码与新密码为必填' });
    if (String(newPassword).length < 6) return reply.status(400).send({ error: '新密码至少 6 位' });
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as any;
    if (!row || !bcrypt.compareSync(oldPassword, row.password_hash)) {
      logAudit(req.user!.id, 'password_change_failed');
      return reply.status(400).send({ error: '原密码不正确' });
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(bcrypt.hashSync(newPassword, 10), req.user!.id);
    logAudit(req.user!.id, 'password_change');
    return { ok: true };
  });
}
