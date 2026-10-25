// 系统设置：管理员配置「所有案件的主文件夹根路径」「文书模板路径」（如局域网共享网盘挂载路径）
import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { getSetting, setSetting, CASES_ROOT_KEY, TEMPLATES_ROOT_KEY } from '../services/settings.js';
import { logAudit } from '../services/audit.js';

export default async function settingsRoutes(app: FastifyInstance) {
  // 读取设置（仅管理员）
  app.get('/api/settings', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.status(403).send({ error: '仅管理员可查看系统设置' });
    return {
      settings: {
        cases_root: getSetting(CASES_ROOT_KEY),
        templates_root: getSetting(TEMPLATES_ROOT_KEY),
      },
    };
  });

  // 保存设置（仅管理员）：各项均允许为空（表示使用服务器默认目录）或绝对路径
  app.put('/api/settings', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.status(403).send({ error: '仅管理员可修改系统设置' });
    const body = (req.body || {}) as { cases_root?: string; templates_root?: string };
    const fields: { key: string; raw: string }[] = [];
    for (const [key, value] of [
      [CASES_ROOT_KEY, body.cases_root],
      [TEMPLATES_ROOT_KEY, body.templates_root],
    ] as [string, string | undefined][]) {
      if (value === undefined) continue; // 未提交该项则保持原值
      const raw = String(value).trim();
      if (raw && !path.isAbsolute(raw)) {
        return reply.status(400).send({ error: '请输入绝对路径（如 /Volumes/共享盘/案理）' });
      }
      fields.push({ key, raw });
    }
    for (const f of fields) setSetting(f.key, f.raw);
    logAudit(req.user!.id, 'settings_update', 'settings', null,
      fields.map((f) => `${f.key}=${f.raw || '(默认)'}`).join(', ') || '(无变更)');
    return {
      ok: true,
      cases_root: getSetting(CASES_ROOT_KEY),
      templates_root: getSetting(TEMPLATES_ROOT_KEY),
    };
  });
}
