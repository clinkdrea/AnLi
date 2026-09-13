import type { FastifyInstance } from 'fastify';
import { db } from '../db/schema.js';
import { chat, getConversation } from '../services/ai.js';
import { isCaseMember } from '../plugins/auth.js';

export default async function aiRoutes(app: FastifyInstance) {
  // 对话（流式用 SSE，这里简化为普通请求）
  app.post('/api/cases/:id/ai/chat', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const { message } = req.body as any;
    if (!message?.trim()) return reply.status(400).send({ error: '消息不能为空' });

    const history = getConversation(cid);
    try {
      const replyText = await chat(cid, message.trim(), history);
      return { reply: replyText };
    } catch (e: any) {
      return reply.status(503).send({ error: e.message });
    }
  });

  // 获取对话历史
  app.get('/api/cases/:id/ai/history', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    return { messages: getConversation(cid) };
  });
}
