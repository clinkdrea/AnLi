import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { db } from '../db/schema.js';
import { config } from '../config.js';

const JWT_SECRET = config.JWT_SECRET;

export interface AuthUser {
  id: number;
  name: string;
  account: string;
  role: 'admin' | 'lead' | 'co' | 'assistant';
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export function signToken(user: AuthUser) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
}

export function authPlugin(app: FastifyInstance) {
  app.decorateRequest('user', null);
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.url === '/api/auth/login' || req.url === '/api/health') return;
    const token = req.cookies?.token || (req.headers.authorization?.replace('Bearer ', ''));
    if (!token) { reply.status(401).send({ error: '未登录' }); return; }
    try {
      const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
      const row = db.prepare('SELECT id, name, account, role FROM users WHERE id = ? AND status = ?')
        .get(payload.id, 'active') as AuthUser | undefined;
      if (!row) { reply.status(401).send({ error: '账号不可用' }); return; }
      req.user = row;
    } catch {
      reply.status(401).send({ error: '登录已过期' });
    }
  });
}

export function isCaseMember(userId: number, caseId: number): boolean {
  const row = db.prepare('SELECT 1 FROM case_members WHERE case_id = ? AND user_id = ?').get(caseId, userId);
  return !!row;
}
