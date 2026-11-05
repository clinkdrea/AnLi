import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { db, DATA_DIR } from '../db/schema.js';
import { isCaseMember } from '../plugins/auth.js';
import { caseDir, resolveOcrRetentionDays } from '../services/settings.js';
import { logAudit } from '../services/audit.js';
import { resolveOcrResultsRoot } from '../services/settings.js';
import {
  startJob, pauseJob, resumeJob, cancelJob, retryJob, recoverJobsOnStartup, resetScheduler,
} from '../services/ocr-scheduler.js';
import { compressPdf, isCompressAvailable, type CompressPreset } from '../services/pdf-compress.js';

const OCR_RESULTS_DIR = path.join(DATA_DIR, 'ocr_results');

// ======== 公用工具 ========

let _pyCache: string | null = null;
/** 找到能用的 Python 解释器：优先 brew python3.11（有 PyMuPDF/Docling/PaddleOCR），退化到系统 python3 */
function findPython(): string {
  if (_pyCache) return _pyCache;
  for (const cand of ['/opt/homebrew/bin/python3.11', 'python3.11', 'python3', 'python']) {
    try {
      execFileSync(cand, ['--version'], { stdio: 'ignore' });
      _pyCache = cand;
      return cand;
    } catch {}
  }
  _pyCache = 'python3'; // 最后兜底
  return _pyCache;
}

/** 用 PyMuPDF 算 PDF 页数（失败返回 1） */
function countPdfPages(filePath: string): number {
  try {
    const py = findPython();
    const safePath = filePath.replace(/"/g, '\\"');
    const out = execFileSync(
      py,
      ['-c', `import fitz; d=fitz.open("${safePath}"); print(len(d)); d.close()`],
      { encoding: 'utf-8' },
    );
    return parseInt(out.trim(), 10) || 1;
  } catch {
    return 1;
  }
}

// ======== 初始化（被 index.ts 调用） ========

export function initOcrRecovery() {
  recoverJobsOnStartup();
}

// ======== OCR 任务自动过期清理 ========
// 启动时跑一次 + 之后每小时检查一次；删除过期任务时同步清理 result_dir 目录
let lastCleanupAt = 0;
export function runOcrRetentionCleanup(force = false): { deleted: number; dirs: string[] } {
  const now = Date.now();
  // 限频：非 force 模式每小时最多跑一次
  if (!force && now - lastCleanupAt < 60 * 60 * 1000) {
    return { deleted: 0, dirs: [] };
  }
  lastCleanupAt = now;

  const days = resolveOcrRetentionDays();
  if (days <= 0) return { deleted: 0, dirs: [] };  // 0 = 永久保留

  const cutoffIso = new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

  // 仅清理终态任务（done / failed / canceled），运行中的不动
  const expired = db.prepare(
    `SELECT * FROM ocr_jobs
     WHERE status IN ('done','failed','canceled')
       AND COALESCE(finished_at, created_at) < ?`
  ).all(cutoffIso) as any[];

  const deletedIds: number[] = [];
  const removedDirs: string[] = [];

  for (const job of expired) {
    // 清理文件（复用 delete 接口的清理逻辑）
    const candidateDirs: string[] = [];
    if (job.result_dir) candidateDirs.push(job.result_dir);
    if (job.output_dir && job.output_dir !== job.result_dir) candidateDirs.push(job.output_dir);
    candidateDirs.push(path.join(OCR_RESULTS_DIR, `job_${job.id}`));

    for (const d of candidateDirs) {
      try {
        if (d && fs.existsSync(d)) {
          fs.rmSync(d, { recursive: true, force: true });
          if (!removedDirs.includes(d)) removedDirs.push(d);
        }
      } catch { /* best-effort */ }
    }
    deletedIds.push(job.id);
  }

  if (deletedIds.length > 0) {
    const placeholders = deletedIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM ocr_pages WHERE job_id IN (${placeholders})`).run(...deletedIds);
    db.prepare(`DELETE FROM ocr_jobs WHERE id IN (${placeholders})`).run(...deletedIds);
    console.log(`[OCR Retention] 清理过期任务: ${deletedIds.length} 条, 目录 ${removedDirs.length} 个, 阈值 ${days} 天前`);
  }

  return { deleted: deletedIds.length, dirs: removedDirs };
}

// ======== Routes ========

export default async function ocrRoutes(app: FastifyInstance) {

  // === PDF 压缩能力检测 + 预估 ===
  app.get('/api/ocr/compress-capability', async () => {
    const available = isCompressAvailable();
    return {
      available,
      presets: [
        { preset: 'printer', label: '保守 (printer)', desc: '几乎不压，适合规整 PDF' },
        { preset: 'ebook', label: '推荐 (ebook)', desc: '压 50-70%，OCR 识别无损' },
        { preset: 'screen', label: '激进 (screen)', desc: '压 80-90%，对扫描件可能有轻微损失' },
      ],
    };
  });

  // 预估压缩效果（实际跑一次 ghostscript，返回结果；临时文件会清理）
  app.post('/api/ocr/compress-estimate', async (req, reply) => {
    const body = req.body as any;
    const filePath = body.file_path;
    const preset = (body.preset as CompressPreset) || 'ebook';
    if (!filePath || !fs.existsSync(filePath)) {
      return reply.status(400).send({ error: '文件不存在' });
    }
    if (!isCompressAvailable()) {
      return reply.status(400).send({ error: 'ghostscript 未安装' });
    }
    if (!filePath.toLowerCase().endsWith('.pdf')) {
      return reply.status(400).send({ error: '仅支持 PDF' });
    }
    // 用临时输出路径（调用 compressPdf 时已经会处理"压缩后反而变大"的情况）
    const r = compressPdf(filePath, preset);
    return {
      ok: r.ok,
      preset: r.preset,
      input_size: r.inputSize,
      output_size: r.outputSize,
      saved_pct: r.ok ? Math.round((1 - r.outputSize / r.inputSize) * 100) : 0,
      gs_version: r.gsVersion,
      error: r.error || null,
    };
  });

  // 创建 OCR 任务（支持多文件批量）
  app.post('/api/ocr/jobs', async (req, reply) => {
    const body = req.body as any;
    const caseId = body.case_id ? Number(body.case_id) : null;
    const engine = body.engine || 'rapidocr';
    const format = body.ocr_format || 'markdown';
    const compressPreset: CompressPreset | null = body.compress_preset || null;

    // 权限
    if (caseId && req.user!.role !== 'admin' && !isCaseMember(req.user!.id, caseId)) {
      return reply.status(403).send({ error: '无权操作该案件' });
    }

    const files: { file_path: string; file_name: string; case_id?: number; file_id?: number }[] = body.files || [];
    if (files.length === 0) {
      return reply.status(400).send({ error: '请选择至少一个文件' });
    }

    const created: number[] = [];
    for (const f of files) {
      if (!f.file_path || !fs.existsSync(f.file_path)) continue;

      const totalPages = f.file_name.toLowerCase().endsWith('.pdf')
        ? countPdfPages(f.file_path)
        : 1;

      const caseRow = caseId
        ? db.prepare('SELECT folder_path FROM cases WHERE id = ?').get(caseId) as any
        : null;

      const job = db.prepare(`
        INSERT INTO ocr_jobs (case_id, file_id, file_path, file_name, file_size, total_pages, engine, ocr_format, compress_preset, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        caseId || f.case_id || null,
        f.file_id || null,
        f.file_path,
        f.file_name || path.basename(f.file_path),
        fs.statSync(f.file_path).size,
        totalPages,
        engine,
        format,
        compressPreset,
        req.user!.id,
      );
      created.push(Number(job.lastInsertRowid));
    }

    logAudit(req.user!.id, 'ocr_job_create', undefined, undefined, `jobs=${created.length} engine=${engine}`);
    reply.send({ job_ids: created });
  });

  // 列出任务（可按 case_id 过滤）
  app.get('/api/ocr/jobs', async (req) => {
    const q = (req.query as any) || {};
    let sql = `
      SELECT j.*, u.name AS creator_name,
        (SELECT COUNT(*) FROM ocr_pages p WHERE p.job_id = j.id) as page_count
      FROM ocr_jobs j LEFT JOIN users u ON j.created_by = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (q.case_id) {
      sql += ' AND j.case_id = ?';
      params.push(Number(q.case_id));
    }
    if (q.status) {
      sql += ' AND j.status = ?';
      params.push(q.status);
    }

    sql += ' ORDER BY j.id DESC LIMIT 200';

    const jobs = db.prepare(sql).all(...params);
    return { jobs };
  });

  // 单个任务详情（含分页进度）
  app.get('/api/ocr/jobs/:id', async (req) => {
    const id = Number((req.params as any).id);
    const job = db.prepare('SELECT * FROM ocr_jobs WHERE id = ?').get(id);
    if (!job) return { job: null };

    const pages = db.prepare(`
      SELECT page_num, status, substr(text, 1, 200) as text_preview, error_msg, updated_at
      FROM ocr_pages WHERE job_id = ? ORDER BY page_num
    `).all(id);

    return { job, pages };
  });

  // 任务操作：start / pause / resume / cancel / retry
  app.post('/api/ocr/jobs/:id/:action', async (req, reply) => {
    const id = Number((req.params as any).id);
    const action = (req.params as any).action;
    const job = db.prepare('SELECT * FROM ocr_jobs WHERE id = ?').get(id) as any;
    if (!job) return reply.status(404).send({ error: '任务不存在' });

    switch (action) {
      case 'start':
        try {
          await startJob(id);
          return reply.send({ ok: true, status: 'processing' });
        } catch (e: any) {
          return reply.status(400).send({ error: e?.message || '启动失败' });
        }

      case 'pause':
        pauseJob(id);
        return reply.send({ ok: true, status: 'paused' });

      case 'resume':
        resumeJob(id).catch((e) => reply.status(500).send({ error: e.message }));
        return reply.send({ ok: true, status: 'processing' });

      case 'cancel':
        cancelJob(id);
        return reply.send({ ok: true, status: 'canceled' });

      case 'retry':
        retryJob(id).catch((e) => reply.status(500).send({ error: e.message }));
        return reply.send({ ok: true, status: 'processing' });

      default:
        return reply.status(400).send({ error: `未知操作: ${action}` });
    }
  });

  // === 调度器一键重置 ===
  // 杀掉所有活跃进程 + 清空队列 + 把 processing/paused/failed 任务回退成 pending
  app.post('/api/ocr/reset', async (req, reply) => {
    try {
      const r = resetScheduler();
      // 重置后立即触发一次 dispatch，让 pending 任务自动启动
      // （定时巡检 15s 也会捞，但立即 dispatch 更及时）
      reply.send({
        ok: true,
        message: '调度器已重置',
        killed_python: r.killed_python,
        killed_ghostscript: r.killed_ghostscript,
        reset_jobs: r.reset_jobs,
        reset_pages: r.reset_pages,
        reset_job_ids: r.details.reset_job_ids,
      });
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  // 任务结果（合并文本）
  app.get('/api/ocr/jobs/:id/result', async (req, reply) => {
    const id = Number((req.params as any).id);
    const job = db.prepare('SELECT * FROM ocr_jobs WHERE id = ?').get(id) as any;
    if (!job) return reply.status(404).send({ error: '任务不存在' });

    if (job.merged_text) {
      reply.header('Content-Type', 'text/plain; charset=utf-8');
      return reply.send(job.merged_text);
    }

    // 未合并：从 ocr_pages 重建
    const pages = db
      .prepare('SELECT text FROM ocr_pages WHERE job_id = ? AND status = ? ORDER BY page_num')
      .all(id, 'done') as { text: string }[];
    const merged = pages.map((p) => p.text).join('\n\n');
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    return reply.send(merged);
  });

  // 辅助：定位最终输出文件（返回 { fullPath, ext, base } 或 null）
  function resolveOutputFile(job: any): { fullPath: string; ext: string; base: string } | null {
    const dir = job.result_dir || job.output_dir || path.join(OCR_RESULTS_DIR, `job_${job.id}`);
    const base = path.basename(job.file_name, path.extname(job.file_name));
    const extMap: Record<string, string> = { markdown: 'md', json: 'json', plain: 'txt', docx: 'docx' };
    const ext = extMap[job.ocr_format] || job.ocr_format;
    const expected = path.join(dir, `${base}.${ext}`);
    if (fs.existsSync(expected)) return { fullPath: expected, ext, base };
    return null;
  }

  // 下载 / 打开最终输出文件（docx / md / json / txt）
  // ?mode=open → Content-Disposition: inline（浏览器能预览的类型直接展示）
  // ?mode=download（默认）→ Content-Disposition: attachment
  app.get('/api/ocr/jobs/:id/download', async (req, reply) => {
    const id = Number((req.params as any).id);
    const q = (req.query as any) || {};
    const mode = q.mode === 'open' ? 'inline' : 'attachment';

    const job = db.prepare('SELECT * FROM ocr_jobs WHERE id = ?').get(id) as any;
    if (!job) return reply.status(404).send({ error: '任务不存在' });
    if (job.status !== 'done') return reply.status(400).send({ error: '任务尚未完成' });

    const resolved = resolveOutputFile(job);
    if (!resolved) {
      return reply.status(404).send({ error: '输出文件不存在于磁盘' });
    }

    const mimeMap: Record<string, string> = {
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      md: 'text/markdown; charset=utf-8',
      json: 'application/json; charset=utf-8',
      txt: 'text/plain; charset=utf-8',
    };
    reply.header('Content-Type', mimeMap[resolved.ext] || 'application/octet-stream');
    // filename 必须是 ASCII，否则 Node 会抛 ERR_INVALID_CHAR
    // RFC 5987: filename*=UTF-8'' 支持中文等非 ASCII 文件名
    const asciiBase = resolved.base.replace(/[^\w.\-]/g, '_');
    const fullName = `${resolved.base}.${resolved.ext}`;
    const encodedName = encodeURIComponent(fullName);
    reply.header(
      'Content-Disposition',
      `${mode}; filename="${asciiBase}.${resolved.ext}"; filename*=UTF-8''${encodedName}`,
    );
    // inline 时允许 iframe/object 嵌入预览
    if (mode === 'inline') {
      reply.header('X-Content-Type-Options', 'nosniff');
    }
    return reply.send(fs.createReadStream(resolved.fullPath));
  });

  // 在 Finder 中显示 OCR 结果文件（macOS）
  app.post('/api/ocr/jobs/:id/reveal', async (req, reply) => {
    const id = Number((req.params as any).id);
    const job = db.prepare('SELECT * FROM ocr_jobs WHERE id = ?').get(id) as any;
    if (!job) return reply.status(404).send({ error: '任务不存在' });

    const resolved = resolveOutputFile(job);
    if (!resolved) {
      return reply.status(404).send({ error: '输出文件不存在于磁盘' });
    }

    try {
      const { execFile } = await import('node:child_process');
      await new Promise<void>((resolve, reject) => {
        // open -R 在 Finder 中定位并高亮文件
        execFile('open', ['-R', resolved.fullPath], (err) => {
          if (err) reject(err); else resolve();
        });
      });
      reply.send({ ok: true, path: resolved.fullPath });
    } catch (e: any) {
      // 非 macOS 环境的 fallback：打开所在目录
      try {
        const { execFile } = await import('node:child_process');
        await new Promise<void>((resolve) => {
          execFile('open', [path.dirname(resolved.fullPath)], () => resolve());
        });
        reply.send({ ok: true, path: path.dirname(resolved.fullPath), fallback: true });
      } catch {
        reply.status(500).send({ error: `无法打开 Finder：${e.message}`, path: resolved.fullPath });
      }
    }
  });

  // 独立上传接口（不关联案件的本地文件 → 自动创建 OCR 任务）
  app.post('/api/ocr/upload', async (req, reply) => {
    const body = (req.body as any) || {};
    const engine = body.engine || 'rapidocr';
    const format = body.ocr_format || 'markdown';
    const compressPreset: CompressPreset | null = body.compress_preset || null;

    const parts = req.parts();
    const uploadsDir = path.join(DATA_DIR, 'ocr_uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const created: number[] = [];

    for await (const part of parts) {
      if (part.type !== 'file') continue;

      const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${path.basename(part.filename).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')}`;
      const savePath = path.join(uploadsDir, safeName);
      const dest = fs.createWriteStream(savePath);
      await new Promise<void>((resolve, reject) => {
        (part.file as any).pipe(dest);
        dest.on('finish', resolve);
        dest.on('error', reject);
      });

      const totalPages = part.filename.toLowerCase().endsWith('.pdf')
        ? countPdfPages(savePath)
        : 1;

      const r = db.prepare(`
        INSERT INTO ocr_jobs (file_path, file_name, file_size, total_pages, engine, ocr_format, compress_preset, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(savePath, part.filename, fs.statSync(savePath).size, totalPages, engine, format, compressPreset, req.user!.id);

      const jobId = Number(r.lastInsertRowid);
      startJob(jobId).catch(() => {});
      created.push(jobId);
    }

    if (created.length === 0) return reply.status(400).send({ error: '未上传文件' });

    logAudit(req.user!.id, 'ocr_job_create', undefined, undefined, `upload jobs=${created.length}`);
    reply.send({ job_ids: created });
  });

  // 通过本地路径创建 OCR 任务（零上传开销，适合几 GB 大文件）
  // POST /api/ocr/jobs/from-path  body: { file_path, is_dir?, output_dir?, engine, ocr_format }
  // - is_dir=true 时遍历文件夹内所有可 OCR 文件（不递归子目录）
  // - output_dir 可选：结果输出目录；文件夹批量时若不填，默认在源目录下建同名_output
  app.post('/api/ocr/jobs/from-path', async (req, reply) => {
    const body = req.body as any;
    const file_path = body.file_path;
    const is_dir = !!body.is_dir;
    const output_dir = body.output_dir || '';
    const engine = body.engine || 'rapidocr';
    const format = body.ocr_format || 'markdown';
    const compressPreset: CompressPreset | null = body.compress_preset || null;

    if (!file_path) return reply.status(400).send({ error: '请提供 file_path' });
    if (!fs.existsSync(file_path)) return reply.status(404).send({ error: `路径不存在: ${file_path}` });

    let filesToProcess: string[] = [];

    if (is_dir) {
      // 文件夹模式：遍历第一层
      const stat = fs.statSync(file_path);
      if (!stat.isDirectory()) return reply.status(400).send({ error: '指定的路径不是文件夹' });

      const entries = fs.readdirSync(file_path, { withFileTypes: true });
      filesToProcess = entries
        .filter((e) => e.isFile())
        .map((e) => path.join(file_path, e.name))
        .filter((p) => {
          const lower = p.toLowerCase();
          return /\.(pdf|docx|pptx|xlsx|jpg|jpeg|png|tiff|tif|heic|webp|gif|bmp)$/.test(lower);
        });

      if (filesToProcess.length === 0) {
        return reply.status(400).send({ error: '该文件夹内没有可识别的文件（支持 PDF/Word/PPT/Excel/图片）' });
      }
    } else {
      filesToProcess = [file_path];
    }

    // 确定输出目录：
    // - 用户显式指定 → 直接用
    // - 文件夹模式 → 全局 OCR 结果目录下建 文件夹名 子目录
    // - 单文件模式 → 全局 OCR 结果目录下建 job_N 子目录
    const globalOcrRoot = resolveOcrResultsRoot();
    let resolvedOutputDir = '';
    if (output_dir) {
      resolvedOutputDir = output_dir;
    } else if (is_dir) {
      resolvedOutputDir = path.join(globalOcrRoot, path.basename(file_path));
    } else {
      resolvedOutputDir = path.join(globalOcrRoot, `pending_${Date.now()}`);
    }
    if (!fs.existsSync(resolvedOutputDir)) {
      fs.mkdirSync(resolvedOutputDir, { recursive: true });
    }

    const createdIds: number[] = [];
    for (const fp of filesToProcess) {
      const stat = fs.statSync(fp);
      const totalPages = fp.toLowerCase().endsWith('.pdf')
        ? countPdfPages(fp)
        : 1;

      const r = db.prepare(`
        INSERT INTO ocr_jobs (file_path, file_name, file_size, total_pages, engine, ocr_format, output_dir, compress_preset, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(fp, path.basename(fp), stat.size, totalPages, engine, format, resolvedOutputDir, compressPreset, req.user!.id);

      const jobId = Number(r.lastInsertRowid);
      createdIds.push(jobId);
      startJob(jobId).catch(() => {});
    }

    const auditDesc = is_dir
      ? `from-path dir=${path.basename(file_path)} count=${createdIds.length} output=${resolvedOutputDir}`
      : `from-path size=${fs.statSync(file_path).size} path=${file_path}`;
    logAudit(req.user!.id, 'ocr_job_create', undefined, undefined, auditDesc);
    reply.send({ job_ids: createdIds, count: createdIds.length, output_dir: resolvedOutputDir });
  });

  // 删除任务（同时清理结果文件）
  app.delete('/api/ocr/jobs/:id', async (req, reply) => {
    const id = Number((req.params as any).id);
    const job = db.prepare('SELECT * FROM ocr_jobs WHERE id = ?').get(id) as any;
    if (!job) return reply.status(404).send({ error: '任务不存在' });

    // 先取消运行中进程
    cancelJob(id);

    // 清理结果目录：优先用 job.result_dir / job.output_dir
    const candidateDirs: string[] = [];
    if (job.result_dir) candidateDirs.push(job.result_dir);
    if (job.output_dir && job.output_dir !== job.result_dir) candidateDirs.push(job.output_dir);
    // 兼容老版本硬编码路径
    candidateDirs.push(path.join(OCR_RESULTS_DIR, `job_${id}`));

    for (const d of candidateDirs) {
      try {
        if (d && fs.existsSync(d)) {
          fs.rmSync(d, { recursive: true, force: true });
        }
      } catch (e: any) {
        req.log.warn(e, `清理 OCR 结果目录失败: ${d}`);
      }
    }

    // 同时清理对应的 ocr_uploads 原文件（如果记录了 file_path 且在 uploads 下）
    if (job.file_path) {
      try {
        const uploadsRoot = path.resolve(path.join(OCR_RESULTS_DIR, '..', 'ocr_uploads'));
        if (job.file_path.startsWith(uploadsRoot) && fs.existsSync(job.file_path)) {
          fs.rmSync(job.file_path, { force: true });
        }
      } catch {}
    }

    db.prepare('DELETE FROM ocr_pages WHERE job_id = ?').run(id);
    db.prepare('DELETE FROM ocr_jobs WHERE id = ?').run(id);

    reply.send({ ok: true });
  });

  // 从现有 file_records 创建 OCR 任务（支持单个 file_id 或批量 files:[{file_id}]）
  app.post('/api/ocr/jobs/from-file', async (req, reply) => {
    const body = req.body as any;
    const engine = body.engine || 'rapidocr';
    const format = body.ocr_format || 'markdown';
    const compressPreset: CompressPreset | null = body.compress_preset || null;

    // 归一化：统一成数组
    const fileIds: number[] = [];
    if (Array.isArray(body.files)) {
      for (const item of body.files) {
        const id = Number(typeof item === 'number' ? item : item?.file_id);
        if (id > 0) fileIds.push(id);
      }
    } else {
      const id = Number(body.file_id);
      if (id > 0) fileIds.push(id);
    }

    if (fileIds.length === 0) {
      return reply.status(400).send({ error: '缺少 file_id 或 files 数组' });
    }

    const jobIds: number[] = [];
    const errors: { file_id: number; error: string }[] = [];

    for (const fileId of fileIds) {
      const file = db.prepare(`
        SELECT fr.*, c.folder_path
        FROM file_records fr JOIN cases c ON fr.case_id = c.id WHERE fr.id = ?
      `).get(fileId) as any;
      if (!file) { errors.push({ file_id: fileId, error: '文件不存在' }); continue; }

      if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, file.case_id)) {
        errors.push({ file_id: fileId, error: '无权操作' }); continue;
      }

      const absPath = path.join(caseDir(file.folder_path), file.rel_path);
      if (!fs.existsSync(absPath)) {
        errors.push({ file_id: fileId, error: '文件不存在于磁盘' }); continue;
      }

      const totalPages = file.file_name.toLowerCase().endsWith('.pdf')
        ? countPdfPages(absPath)
        : 1;

      const r = db.prepare(`
        INSERT INTO ocr_jobs (case_id, file_id, file_path, file_name, file_size, total_pages, engine, ocr_format, compress_preset, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        file.case_id, file.id, absPath, file.file_name, file.size, totalPages, engine, format, compressPreset, req.user!.id,
      );

      const jobId = Number(r.lastInsertRowid);
      startJob(jobId).catch(() => {});
      jobIds.push(jobId);
    }

    logAudit(req.user!.id, 'ocr_job_create', undefined, undefined,
      `from file_records batch file_ids=[${fileIds.join(',')}] jobs=[${jobIds.join(',')}] errors=${errors.length}`);

    if (jobIds.length === 0) {
      return reply.status(400).send({ error: errors[0]?.error || '所有文件创建失败', details: errors });
    }
    reply.send({ job_ids: jobIds, created: jobIds.length, total: fileIds.length, errors });
  });
}
