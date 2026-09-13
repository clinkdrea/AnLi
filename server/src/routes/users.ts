import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { db } from '../db/schema.js';
import { logAudit } from '../services/audit.js';

const ROLES = ['admin', 'lead', 'co', 'assistant'];

// PRD：用户与角色（仅管理员）：账号增删改、重置密码、角色分配
export default async function userRoutes(app: FastifyInstance) {
  const requireAdmin = (req: any, reply: any): boolean => {
    if (req.user?.role !== 'admin') { reply.status(403).send({ error: '仅管理员可操作' }); return false; }
    return true;
  };

  app.get('/api/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const users = db.prepare('SELECT id, name, account, role, status, created_at FROM users ORDER BY id').all();
    return { users };
  });

  app.post('/api/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { name, account, password, role } = req.body as any;
    if (!name || !account || !password || !role) return reply.status(400).send({ error: '姓名、账号、密码、角色为必填' });
    if (String(password).length < 6) return reply.status(400).send({ error: '密码至少 6 位' });
    if (!ROLES.includes(role)) return reply.status(400).send({ error: '角色不合法' });
    const hash = bcrypt.hashSync(password, 10);
    try {
      const info = db.prepare(
        'INSERT INTO users (name, account, password_hash, role) VALUES (?, ?, ?, ?)'
      ).run(name, account, hash, role);
      logAudit(req.user!.id, 'user_create', 'user', info.lastInsertRowid, `${account}(${role})`);
      return { id: info.lastInsertRowid };
    } catch {
      return reply.status(400).send({ error: '账号已存在' });
    }
  });

  // 编辑：姓名 / 角色 / 启用停用
  app.put('/api/users/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const uid = Number((req.params as any).id);
    const { name, role, status } = req.body as any;
    const target = db.prepare('SELECT id, account, role, status FROM users WHERE id = ?').get(uid) as any;
    if (!target) return reply.status(404).send({ error: '用户不存在' });

    // 自保护：不能停用自己、不能变更自己的角色
    if (target.id === req.user!.id && ((status && status !== 'active') || (role && role !== 'admin'))) {
      return reply.status(400).send({ error: '不能停用自己的账号或变更自己的角色' });
    }
    if (role && !ROLES.includes(role)) return reply.status(400).send({ error: '角色不合法' });
    if (status && status !== 'active' && status !== 'disabled') return reply.status(400).send({ error: '状态不合法' });

    const sets: string[] = [];
    const params: any[] = [];
    if (name !== undefined) { sets.push('name = ?'); params.push(name); }
    if (role !== undefined) { sets.push('role = ?'); params.push(role); }
    if (status !== undefined) { sets.push('status = ?'); params.push(status); }
    if (sets.length === 0) return reply.status(400).send({ error: '没有需要修改的字段' });
    params.push(uid);
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    logAudit(req.user!.id, 'user_update', 'user', uid, JSON.stringify({ name, role, status }));
    return { ok: true };
  });

  // 重置密码
  app.put('/api/users/:id/password', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const uid = Number((req.params as any).id);
    const { password } = req.body as any;
    if (!password || String(password).length < 6) return reply.status(400).send({ error: '密码至少 6 位' });
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(uid) as any;
    if (!target) return reply.status(404).send({ error: '用户不存在' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), uid);
    logAudit(req.user!.id, 'user_reset_password', 'user', uid);
    return { ok: true };
  });

  // 删除（已加入案件的账号不可删，需先停用）
  app.delete('/api/users/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const uid = Number((req.params as any).id);
    if (uid === req.user!.id) return reply.status(400).send({ error: '不能删除自己的账号' });
    const target = db.prepare('SELECT id, account FROM users WHERE id = ?').get(uid) as any;
    if (!target) return reply.status(404).send({ error: '用户不存在' });
    const member = db.prepare('SELECT COUNT(*) as c FROM case_members WHERE user_id = ?').get(uid) as { c: number };
    if (member.c > 0) return reply.status(400).send({ error: '该账号已加入案件，请改为停用' });
    // 审计留痕保留但操作人匿名化；通知随账号删除
    db.prepare('UPDATE audit_logs SET user_id = NULL WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM users WHERE id = ?').run(uid);
    logAudit(req.user!.id, 'user_delete', 'user', uid, target.account);
    return { ok: true };
  });
}
