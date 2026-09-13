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
import evidenceRoutes from './routes/evidences.js';
import templateRoutes from './routes/templates.js';
import importRoutes from './routes/import.js';
import aiRoutes from './routes/ai.js';
import knowledgeRoutes from './routes/knowledge.js';
import auditRoutes from './routes/audit.js';
import notificationRoutes from './routes/notifications.js';
import exportRoutes from './routes/export.js';
import { startOCRWorker } from './services/ocr.js';
import { scanTemplates } from './services/templates-scan.js';
import { config } from './config.js';

const app = Fastify({ logger: true, bodyLimit: 524288000 });

await app.register(cors, { origin: true, credentials: true });
await app.register(cookie);
await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } });

initDb();
seed();
// 启动时扫描文书模板目录（增量，已存在则跳过）
try { scanTemplates(); } catch (e) { app.log.error(e, '模板扫描失败'); }

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
await app.register(evidenceRoutes);
await app.register(templateRoutes);
await app.register(importRoutes);
await app.register(aiRoutes);
await app.register(knowledgeRoutes);
await app.register(auditRoutes);
await app.register(notificationRoutes);
await app.register(exportRoutes);

// 启动 OCR 后台队列
startOCRWorker();

const PORT = config.PORT;
app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) { app.log.error(err); process.exit(1); }
  app.log.info(`案理后端运行于 ${address}`);
});
