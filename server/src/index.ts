// ======== 进程级异常保护 ========
// 避免 uncaughtException / unhandledRejection 静默杀进程（之前后端子进程崩了没人知道原因）
process.on('uncaughtException', (err, origin) => {
  console.error('\n========== UNCAUGHT EXCEPTION ==========');
  console.error(err);
  console.error('Origin:', origin);
  console.error('========================================\n');
  // 不退出进程，让服务继续跑
});
process.on('unhandledRejection', (reason: any, promise) => {
  console.error('\n========== UNHANDLED PROMISE REJECTION ==========');
  console.error('Reason:', reason);
  console.error('Stack:', reason?.stack || 'no stack');
  console.error('===============================================\n');
});

import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { initDb } from './db/schema.js';
import { seed } from './db/seed.js';
import { authPlugin } from './plugins/auth.js';
import authRoutes from './routes/auth.js';
import caseRoutes from './routes/cases.js';
import userRoutes from './routes/users.js';
import dashboardRoutes from './routes/dashboard.js';
import fileRoutes from './routes/files.js';
import noteRoutes from './routes/notes.js';
import searchRoutes from './routes/search.js';
import conflictRoutes from './routes/conflicts.js';
import stageRoutes from './routes/stages.js';
import taskRoutes from './routes/tasks.js';
import commentRoutes from './routes/comments.js';
import templateRoutes from './routes/templates.js';
import boardTemplateRoutes from './routes/board-templates.js';
import settingsRoutes from './routes/settings.js';
import importRoutes from './routes/import.js';
import aiRoutes from './routes/ai.js';
import knowledgeRoutes from './routes/knowledge.js';
import auditRoutes from './routes/audit.js';
import notificationRoutes from './routes/notifications.js';
import exportRoutes from './routes/export.js';
import aiAgentRoutes from './routes/ai-agent.js';
import ocrRoutes, { initOcrRecovery, runOcrRetentionCleanup } from './routes/ocr.js';
import { startOCRWorker } from './services/ocr.js';
import { scanTemplates } from './services/templates-scan.js';
import { runStartupCleanup } from './services/cleanup.js';
import { config } from './config.js';

// 高频心跳路径不打请求日志，避免控制台噪声（通知轮询、健康检查等）
const SILENT_PATHS = new Set(['/api/notifications', '/api/health']);
const app = Fastify({
  // 关闭 Fastify 默认的 incoming request / request completed 日志
  // 在 onResponse hook 里按需手动记录，心跳路径直接跳过
  disableRequestLogging: true,
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
  bodyLimit: 524288000,
});

// 自定义请求日志：仅非静默路径记录一行（包含 method + url + statusCode + 耗时）
app.addHook('onResponse', async (req, reply) => {
  if (SILENT_PATHS.has(req.url)) return; // 跳过心跳路径
  const ms = reply.elapsedTime ? reply.elapsedTime.toFixed(2) : '?';
  req.log.info(
    { method: req.method, url: req.url, statusCode: reply.statusCode, responseTime: ms },
    `${req.method} ${req.url} ${reply.statusCode} ${ms}ms`,
  );
});

await app.register(cors, { origin: true, credentials: true });
await app.register(cookie);
// OCR 大文件上传：放宽到 10GB，超大文件用本地路径直指定接口
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 * 1024, files: 10 } });

initDb();
seed();
// 启动时扫描文书模板目录（增量，已存在则跳过）
try { scanTemplates(); } catch (e) { app.log.error(e, '模板扫描失败'); }
// 启动时执行历史数据清理（审计日志 90 天、已读通知 30 天）
try {
  const r = runStartupCleanup();
  if (r.auditDeleted || r.notifDeleted) {
    app.log.info(`启动清理：审计日志删除 ${r.auditDeleted} 条，通知删除 ${r.notifDeleted} 条`);
  }
} catch (e) { app.log.error(e, '启动清理失败'); }

authPlugin(app);

app.get('/api/health', () => ({ ok: true, time: new Date().toISOString() }));

await app.register(authRoutes);
await app.register(caseRoutes);
await app.register(userRoutes);
await app.register(dashboardRoutes);
await app.register(fileRoutes);
await app.register(noteRoutes);
await app.register(searchRoutes);
await app.register(conflictRoutes);
await app.register(stageRoutes);
await app.register(taskRoutes);
await app.register(commentRoutes);
await app.register(templateRoutes);
await app.register(boardTemplateRoutes);
await app.register(settingsRoutes);
await app.register(importRoutes);
await app.register(aiRoutes);
await app.register(knowledgeRoutes);
await app.register(auditRoutes);
await app.register(notificationRoutes);
await app.register(exportRoutes);
await app.register(aiAgentRoutes);
await app.register(ocrRoutes);

// 启动 OCR 后台队列
try {
  startOCRWorker();
} catch (e: any) {
  console.error('[OCR] 启动后台队列失败（不影响主服务）:', e?.message);
}

// OCR 断点续做：恢复上次服务关闭时未完成的任务
try {
  initOcrRecovery();
} catch (e: any) {
  console.error('[OCR] 恢复未完成任务失败（不影响主服务）:', e?.message);
}

// OCR 任务自动过期清理（默认 14 天）
try {
  const { deleted, dirs } = runOcrRetentionCleanup(true);
  if (deleted > 0) console.log(`[OCR Retention] 启动清理: 删除 ${deleted} 条任务 + ${dirs.length} 个目录`);
} catch (e: any) {
  console.error('[OCR Retention] 启动清理失败（不影响主服务）:', e?.message);
}
setInterval(() => {
  try { runOcrRetentionCleanup(); } catch (e: any) { /* 后台定时任务出错不应该影响服务 */ }
}, 60 * 60 * 1000);

const PORT = config.PORT;
app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) { app.log.error(err); process.exit(1); }
  app.log.info(`案理后端运行于 ${address}`);
});
