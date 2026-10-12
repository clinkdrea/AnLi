import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { db } from '../db/schema.js';
import { isCaseMember } from '../plugins/auth.js';
import { config } from '../config.js';
import { logAudit } from '../services/audit.js';
import {
  isReady, listSkills, setSkillEnabled, initSkills, updateSkills,
} from '../services/legal-skills.js';
import {
  agentChat, getOllamaStatus,
  listThreads, createThread, deleteThread, getThread, updateThread,
  getThreadMessages, chatInThread,
} from '../services/ai-agent.js';
import { generateComplaint, isReady as complaintReady } from '../services/complaint-generator.js';

export default async function aiAgentRoutes(app: FastifyInstance) {
  // 状态：ollama 在线情况、已安装模型、可选模型列表、skills 库是否就绪
  app.get('/api/ai/status', async () => {
    const ollama = await getOllamaStatus();
    return {
      ollama,
      skillsReady: isReady(),
      complaintReady: complaintReady(),
      models: config.AI_MODELS,
      defaultModel: config.AI_MODEL,
    };
  });

  // skill 列表 + 启用状态
  app.get('/api/ai/skills', async () => {
    return { skills: listSkills(), ready: isReady() };
  });

  // 首次安装 skills 库（git clone，仅 admin）
  app.post('/api/ai/skills/init', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.status(403).send({ error: '仅管理员可初始化 skills 库' });
    try {
      const r = await initSkills();
      logAudit(req.user!.id, 'ai_skills_init', 'ai_skills', null, r.output.slice(0, 500));
      return { ok: true, output: r.output, skills: listSkills() };
    } catch (e: any) {
      return reply.status(500).send({ error: e.message });
    }
  });

  // 更新 skills 库（git pull，仅 admin）
  app.post('/api/ai/skills/update', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.status(403).send({ error: '仅管理员可更新 skills 库' });
    try {
      const r = await updateSkills();
      logAudit(req.user!.id, 'ai_skills_update', 'ai_skills', null, r.output.slice(0, 500));
      return { ok: true, output: r.output };
    } catch (e: any) {
      return reply.status(500).send({ error: e.message });
    }
  });

  // 开关某个 skill（全局配置，登录用户均可按需启用/关闭）
  app.patch('/api/ai/skills/:name', async (req, reply) => {
    const name = decodeURIComponent((req.params as any).name);
    const enabled = !!(req.body as any)?.enabled;
    try {
      const skills = setSkillEnabled(name, enabled);
      return { ok: true, skills };
    } catch (e: any) {
      return reply.status(404).send({ error: e.message });
    }
  });

  // ---------------- 聊天线程 ----------------

  // 列出当前用户的线程（自动清理 30 天未使用的）
  app.get('/api/ai/threads', async (req) => {
    return { threads: listThreads(req.user!.id) };
  });

  // 新建线程
  app.post('/api/ai/threads', async (req) => {
    const body = req.body as { case_id?: number | null; title?: string; model?: string } | undefined;
    const thread = createThread(req.user!.id, body || {});
    return { thread };
  });

  // 删除线程
  app.delete('/api/ai/threads/:id', async (req, reply) => {
    const tid = Number((req.params as any).id);
    const ok = deleteThread(req.user!.id, tid);
    if (!ok) return reply.status(404).send({ error: '线程不存在或无权删除' });
    return { ok: true };
  });

  // 更新线程（case_id / title / model）
  app.patch('/api/ai/threads/:id', async (req, reply) => {
    const tid = Number((req.params as any).id);
    const body = req.body as { case_id?: number | null; title?: string; model?: string };
    const thread = updateThread(req.user!.id, tid, body);
    if (!thread) return reply.status(404).send({ error: '线程不存在' });
    return { thread };
  });

  // 获取线程消息历史
  app.get('/api/ai/threads/:id/messages', async (req, reply) => {
    const tid = Number((req.params as any).id);
    const thread = getThread(req.user!.id, tid);
    if (!thread) return reply.status(404).send({ error: '线程不存在' });
    return { messages: getThreadMessages(tid), thread };
  });

  // 在线程内发送消息（自动携带历史上下文）
  app.post('/api/ai/threads/:id/chat', async (req, reply) => {
    const tid = Number((req.params as any).id);
    const thread = getThread(req.user!.id, tid);
    if (!thread) return reply.status(404).send({ error: '线程不存在' });
    const body = req.body as { message?: string; model?: string; skills?: string[] };
    const message = body.message?.trim();
    if (!message) return reply.status(400).send({ error: '消息不能为空' });

    // 案件上下文权限校验（线程绑定的案件）
    if (thread.case_id) {
      if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, thread.case_id)) {
        return reply.status(403).send({ error: '无权使用该案件作为上下文' });
      }
    }

    const skills = Array.isArray(body.skills) ? body.skills.slice(0, 10).map(String) : undefined;
    try {
      const r = await chatInThread(req.user!.id, tid, message, { model: body.model, skills });
      return r;
    } catch (e: any) {
      req.log.error(e, 'thread chat failed');
      return reply.status(503).send({ error: e.message || 'AI 服务不可用' });
    }
  });

  // ---------------- 要素式起诉状生成 ----------------

  // 生成要素式起诉状 docx：基于案件上下文 + 可选补充描述，LLM 抽要素后渲染
  app.post('/api/ai/agent/generate-complaint', async (req, reply) => {
    const body = req.body as {
      case_id?: number | null;
      description?: string;
      model?: string;
    };
    const caseId = body.case_id ? Number(body.case_id) : null;
    if (caseId) {
      const c = db.prepare('SELECT id FROM cases WHERE id = ?').get(caseId);
      if (!c) return reply.status(404).send({ error: '案件不存在' });
      if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, caseId)) {
        return reply.status(403).send({ error: '无权使用该案件作为上下文' });
      }
    }
    if (!complaintReady()) {
      return reply.status(503).send({ error: '要素式起诉状生成器未就绪，请先初始化 legal-skills 库' });
    }
    try {
      const result = await generateComplaint({
        caseId,
        description: body.description,
        model: body.model,
      });
      logAudit(req.user!.id, 'ai_generate_complaint', 'ai_complaint', null,
        `case_type=${result.case_type}, size=${result.fileSize}`);
      // 返回下载链接 + 抽取要素（前端用于复核）
      return {
        ok: true,
        case_type: result.case_type,
        elements: result.elements,
        file_size: result.fileSize,
        download_url: `/api/ai/agent/complaint-download?path=${encodeURIComponent(result.docxPath)}`,
      };
    } catch (e: any) {
      req.log.error(e, 'generate complaint failed');
      return reply.status(500).send({ error: e.message || '生成失败' });
    }
  });

  // 下载生成的起诉状 docx（路径必须在系统临时目录内）
  app.get('/api/ai/agent/complaint-download', async (req, reply) => {
    const p = decodeURIComponent(String((req.query as any).path || ''));
    if (!p) return reply.status(400).send({ error: '缺少路径' });
    const full = path.resolve(p);
    const tmp = path.resolve(os.tmpdir());
    if (!full.startsWith(tmp + path.sep) || !fs.existsSync(full)) {
      return reply.status(404).send({ error: '文件不存在或已过期' });
    }
    const name = `要素式起诉状_${Date.now()}.docx`;
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    reply.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    return reply.send(fs.createReadStream(full));
  });

  // ---------------- 兼容旧的无状态对话接口 ----------------
  app.post('/api/ai/agent/chat', async (req, reply) => {
    const body = req.body as {
      case_id?: number | null;
      message?: string;
      history?: { role: string; content: string }[];
      model?: string;
      skills?: string[];
    };
    const message = body.message?.trim();
    if (!message) return reply.status(400).send({ error: '消息不能为空' });

    const caseId = body.case_id ? Number(body.case_id) : null;
    if (caseId) {
      const c = db.prepare('SELECT id FROM cases WHERE id = ?').get(caseId);
      if (!c) return reply.status(404).send({ error: '案件不存在' });
      if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, caseId)) {
        return reply.status(403).send({ error: '无权使用该案件作为上下文' });
      }
    }

    const history = Array.isArray(body.history)
      ? body.history
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
      : [];
    const skills = Array.isArray(body.skills) ? body.skills.slice(0, 10).map(String) : undefined;

    try {
      const r = await agentChat({ caseId, message, history, model: body.model, skills });
      return r;
    } catch (e: any) {
      req.log.error(e, 'agent chat failed');
      return reply.status(503).send({ error: e.message || 'AI 服务不可用' });
    }
  });
}
