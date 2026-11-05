// 系统设置：
// - 管理员可配置「所有案件的主文件夹根路径」「文书模板路径」
// - 所有用户可配置「OCR 结果输出目录」（写入全局 settings 表）
import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import {
  getSetting, setSetting,
  CASES_ROOT_KEY, TEMPLATES_ROOT_KEY, OCR_RESULTS_KEY, OCR_AUTO_KEY,
  MINERU_API_TOKEN_KEY, MINERU_API_BASE_KEY, OCR_RETENTION_KEY,
  resolveOcrResultsRoot, resolveMineruApiBase, resolveOcrRetentionDays,
} from '../services/settings.js';
import { logAudit } from '../services/audit.js';

export default async function settingsRoutes(app: FastifyInstance) {
  // 读取设置（已登录用户均可读）
  app.get('/api/settings', async (req, reply) => {
    const isAdmin = req.user!.role === 'admin';
    // MinerU Token 只返回是否已配置，不返回明文
    const mineruTokenRaw = getSetting(MINERU_API_TOKEN_KEY);
    return {
      settings: {
        cases_root: isAdmin ? getSetting(CASES_ROOT_KEY) : null,
        templates_root: isAdmin ? getSetting(TEMPLATES_ROOT_KEY) : null,
        ocr_results: getSetting(OCR_RESULTS_KEY),
        ocr_results_default: resolveOcrResultsRoot(),
        ocr_auto: isAdmin ? getSetting(OCR_AUTO_KEY) === '1' : null,
        ocr_retention_days: resolveOcrRetentionDays(),
        mineru_api_base: resolveMineruApiBase(),
        mineru_api_token_configured: !!mineruTokenRaw,
      },
    };
  });

  // 保存设置：
  // - cases_root / templates_root / ocr_auto 仅管理员可改
  // - ocr_results / mineru_api_base / mineru_api_token / ocr_retention_days 所有用户可改
  app.put('/api/settings', async (req, reply) => {
    const body = (req.body || {}) as {
      cases_root?: string; templates_root?: string; ocr_results?: string;
      mineru_api_base?: string; mineru_api_token?: string; ocr_auto?: boolean;
      ocr_retention_days?: number;
    };
    const isAdmin = req.user!.role === 'admin';
    const fields: { key: string; raw: string }[] = [];

    if (body.cases_root !== undefined) {
      if (!isAdmin) return reply.status(403).send({ error: '仅管理员可修改案件主文件夹路径' });
      const raw = String(body.cases_root).trim();
      if (raw && !path.isAbsolute(raw)) return reply.status(400).send({ error: '请输入绝对路径' });
      fields.push({ key: CASES_ROOT_KEY, raw });
    }
    if (body.templates_root !== undefined) {
      if (!isAdmin) return reply.status(403).send({ error: '仅管理员可修改文书模板路径' });
      const raw = String(body.templates_root).trim();
      if (raw && !path.isAbsolute(raw)) return reply.status(400).send({ error: '请输入绝对路径' });
      fields.push({ key: TEMPLATES_ROOT_KEY, raw });
    }
    if (body.ocr_results !== undefined) {
      const raw = String(body.ocr_results).trim();
      if (raw && !path.isAbsolute(raw)) return reply.status(400).send({ error: '请输入绝对路径' });
      fields.push({ key: OCR_RESULTS_KEY, raw });
    }
    if (body.ocr_retention_days !== undefined) {
      const n = Number(body.ocr_retention_days);
      if (!Number.isFinite(n) || n < 0) return reply.status(400).send({ error: '保存天数需为 ≥0 的数字（0=永久）' });
      fields.push({ key: OCR_RETENTION_KEY, raw: String(Math.floor(n)) });
    }
    if (body.ocr_auto !== undefined) {
      if (!isAdmin) return reply.status(403).send({ error: '仅管理员可修改自动 OCR 开关' });
      fields.push({ key: OCR_AUTO_KEY, raw: body.ocr_auto ? '1' : '0' });
    }
    if (body.mineru_api_base !== undefined) {
      const raw = String(body.mineru_api_base).trim();
      fields.push({ key: MINERU_API_BASE_KEY, raw });
    }
    if (body.mineru_api_token !== undefined) {
      const raw = String(body.mineru_api_token).trim();
      fields.push({ key: MINERU_API_TOKEN_KEY, raw });
    }

    for (const f of fields) setSetting(f.key, f.raw);
    logAudit(req.user!.id, 'settings_update', 'settings', null,
      fields.map((f) => {
        // Token 不记录明文
        if (f.key === MINERU_API_TOKEN_KEY) return `${f.key}=${f.raw ? '(已更新)' : '(已清除)'}`;
        return `${f.key}=${f.raw || '(默认)'}`;
      }).join(', ') || '(无变更)');

    const mineruTokenRaw = getSetting(MINERU_API_TOKEN_KEY);
    return {
      ok: true,
      settings: {
        cases_root: isAdmin ? getSetting(CASES_ROOT_KEY) : null,
        templates_root: isAdmin ? getSetting(TEMPLATES_ROOT_KEY) : null,
        ocr_results: getSetting(OCR_RESULTS_KEY),
        ocr_results_default: resolveOcrResultsRoot(),
        ocr_auto: isAdmin ? getSetting(OCR_AUTO_KEY) === '1' : null,
        ocr_retention_days: resolveOcrRetentionDays(),
        mineru_api_base: resolveMineruApiBase(),
        mineru_api_token_configured: !!mineruTokenRaw,
      },
    };
  });
}
