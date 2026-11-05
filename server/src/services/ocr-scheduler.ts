import { spawn, execSync, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { db, DATA_DIR } from '../db/schema.js';
import { config } from '../config.js';
import { resolveMineruApiBase, resolveMineruApiToken } from './settings.js';
import { compressPdfAsync, isCompressAvailable, type CompressPreset } from './pdf-compress.js';

// 可靠的 __dirname 替代品（ESM 环境）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/src/services → server/scripts
const ENGINE_SCRIPT = path.resolve(__dirname, '../../scripts/ocr_engine.py');
const OCR_RESULTS_DIR = path.join(DATA_DIR, 'ocr_results');
if (!fs.existsSync(OCR_RESULTS_DIR)) fs.mkdirSync(OCR_RESULTS_DIR, { recursive: true });

console.log(`[OCR Scheduler] ENGINE_SCRIPT = ${ENGINE_SCRIPT} (exists: ${fs.existsSync(ENGINE_SCRIPT)})`);

// ======== 并发控制 ========
// 同时最多跑多少个 Python OCR 子进程。
// 按内存估算：PaddleOCR / Docling 每个实例吃 2-3GB，RapidOCR/Vision 约 500MB。
// 取 os.totalmem() / 4GB，最少 1 最多 4（避免极端配置拉爆内存）。
const MEM_GB = os.totalmem() / 1024 / 1024 / 1024;
const MAX_CONCURRENT = Math.max(1, Math.min(4, Math.floor(MEM_GB / 4)));
console.log(`[OCR Scheduler] MAX_CONCURRENT = ${MAX_CONCURRENT} (system memory = ${MEM_GB.toFixed(1)} GB, 每 OCR 约 4GB)`);

const activeCount = new Set<number>();       // 正在跑的 jobId 集合
const waitingQueue: number[] = [];            // 等待中的 jobId 队列
const runningFns = new Map<number, () => Promise<void>>(); // 真正的 spawn 函数（jobId → 内部 run 函数）

// ======== 活跃子进程注册表（用于暂停/取消） ========
const activeProcesses = new Map<number, ChildProcess>();

// ======== 工具 ========

function runSync(sql: string, params: any[] = []) {
  db.prepare(sql).run(...params);
}

function getJob(id: number) {
  return db.prepare('SELECT * FROM ocr_jobs WHERE id = ?').get(id) as any;
}

function updateJob(id: number, patch: Record<string, any>) {
  const keys = Object.keys(patch);
  const set = keys.map((k) => `${k} = ?`).join(', ');
  runSync(`UPDATE ocr_jobs SET ${set} WHERE id = ?`, [...Object.values(patch), id]);
}

function resultDirName(jobId: number): string {
  const d = path.join(OCR_RESULTS_DIR, `job_${jobId}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** 当前活跃 / 等待数量（供监控 / 前端展示） */
export function getQueueStatus() {
  return {
    active: activeCount.size,
    waiting: waitingQueue.length,
    max: MAX_CONCURRENT,
    activeJobs: Array.from(activeCount),
    waitingJobs: [...waitingQueue],
  };
}

/** 调度：有空闲槽位就从等待队列取下一个启动 */
function tryDispatch() {
  while (activeCount.size < MAX_CONCURRENT && waitingQueue.length > 0) {
    const jobId = waitingQueue.shift()!;
    // 可能在排队期间被取消了 → 跳过
    const j = getJob(jobId);
    if (!j || j.status === 'canceled' || j.status === 'done') continue;
    const fn = runningFns.get(jobId);
    runningFns.delete(jobId);
    if (!fn) continue;
    activeCount.add(jobId);
    console.log(`[OCR Scheduler] ▶ 启动 job=${jobId} (active=${activeCount.size}/${MAX_CONCURRENT}, waiting=${waitingQueue.length})`);
    fn().finally(() => {
      activeCount.delete(jobId);
      tryDispatch(); // 释放槽位后立即尝试下一个
    }).catch((e) => {
      console.error(`[OCR Scheduler] ✗ job=${jobId} 异常退出:`, e?.message);
    });
  }
}

// ======== 核心：启动/续跑 OCR ========

/**
 * 启动或续跑一个 OCR 任务（带并发排队）
 * 断点续做逻辑：
 *   1. 查 ocr_pages 表，找出该 job 已 done 的最大 page_num
 *   2. 从 done + 1 页开始跑
 *   3. 已 done 的页被跳过（Python 引擎从 start_page 开始处理）
 */
export function startJob(jobId: number): Promise<void> {
  const job = getJob(jobId);
  if (!job) return Promise.reject(new Error('任务不存在'));
  if (job.status === 'done') return Promise.reject(new Error('任务已完成'));
  if (job.status === 'canceled') return Promise.reject(new Error('任务已取消'));

  // MinerU 暂时下线：在 start 阶段直接标记 fatal，避免浪费 spawn 资源
  if (job.engine === 'mineru') {
    db.prepare("UPDATE ocr_jobs SET status='failed', error_msg='MinerU 引擎暂不可用（开发中），请改用 RapidOCR / PaddleOCR / Docling' WHERE id=?").run(jobId);
    return Promise.reject(new Error('MinerU 引擎暂不可用'));
  }

  console.log(`[OCR Scheduler] startJob job=${jobId} status=${job.status} engine=${job.engine} active=${activeCount.size} waiting=${waitingQueue.length} MAX=${MAX_CONCURRENT}`);

  // 如果已经在跑或排队中，不重复入队
  if (activeCount.has(jobId) || waitingQueue.includes(jobId)) {
    console.log(`[OCR Scheduler] job=${jobId} 已在 ${activeCount.has(jobId) ? '运行' : '等待'} 中，忽略重复 start`);
    return Promise.resolve();
  }

  // 注册真正的 spawn 函数
  runningFns.set(jobId, () => runJob(jobId));

  // 入队
  waitingQueue.push(jobId);
  console.log(`[OCR Scheduler] ⏳ job=${jobId} 进入等待队列 (active=${activeCount.size}/${MAX_CONCURRENT}, waiting=${waitingQueue.length})`);

  // 尝试立即 dispatch（如果有空闲槽位，这个调用会把它从队列取出来直接 run）
  tryDispatch();

  return Promise.resolve();
}

/** 真正的 spawn + 事件处理逻辑（startJob / retryJob / resumeJob 共用） */
async function runJob(jobId: number): Promise<void> {
  const job = getJob(jobId);
  if (!job) throw new Error('任务不存在');

  // 计算断点：找到已 done 的最大页
  const maxDone = db
    .prepare('SELECT COALESCE(MAX(page_num), 0) as m FROM ocr_pages WHERE job_id = ? AND status = ?')
    .get(jobId, 'done') as any;
  const startPage = (maxDone?.m || 0) + 1;

  // 如果所有页都 done，直接标记完成
  if (startPage > job.total_pages) {
    finalizeJob(jobId);
    return;
  }

  // ========== PDF 预压缩 ==========
  // 如果任务指定了 compress_preset 且文件是 PDF 且有 ghostscript，先压缩再 OCR
  let effectiveFilePath = job.file_path;
  const preset = (job.compress_preset as CompressPreset | null) || null;

  // ⚠️ 关键：在压缩之前就把状态设为 processing！
  // 否则 compressPdfAsync 期间状态一直卡 pending → tryDispatch/定时巡检会误判
  updateJob(jobId, {
    status: 'processing',
    started_at: job.started_at || new Date().toISOString(),
    error_msg: null,
  });

  if (
    preset
    && job.file_path.toLowerCase().endsWith('.pdf')
    && isCompressAvailable()
    // 大文件保护：> 500MB 跳过（ghostscript 太慢，可能 10 分钟以上）
    && job.file_size < 500 * 1024 * 1024
  ) {
    const outDir = job.output_dir || resultDirName(jobId);
    const compressedStamp = path.join(outDir, '.compressed.stamp');
    const compressedFile = path.join(outDir, 'compressed.pdf');

    if (fs.existsSync(compressedStamp) && fs.existsSync(compressedFile)) {
      // 断点续做：复用之前压缩好的文件
      effectiveFilePath = compressedFile;
      console.log(`[OCR] job=${jobId} 断点续做：复用已压缩 PDF (${compressedFile})`);
      updateJob(jobId, { current_hint: `复用已压缩 PDF，开始 OCR...` });
    } else {
      // 首次跑：压缩 → 替换 file_path
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const r = await compressPdfAsync(
        job.file_path, preset, compressedFile,
        (hint) => { updateJob(jobId, { current_hint: hint }); },
        5 * 60_000, // 5 分钟超时（200MB 文件约 2 分钟）
      );
      if (r.ok && r.outputPath && fs.existsSync(r.outputPath)) {
        fs.writeFileSync(compressedStamp, JSON.stringify({
          preset,
          original: job.file_path,
          originalSize: r.inputSize,
          compressedSize: r.outputSize,
          ratio: r.ratio,
          at: new Date().toISOString(),
        }, null, 2));
        effectiveFilePath = r.outputPath;
        const savedPct = (1 - r.outputSize / r.inputSize) * 100;
        console.log(`[OCR] job=${jobId} 压缩完成: ${preset} ${(r.inputSize/1024/1024).toFixed(1)}MB → ${(r.outputSize/1024/1024).toFixed(1)}MB (-${savedPct.toFixed(0)}%)`);
        updateJob(jobId, { current_hint: `PDF 压缩完成 (-${savedPct.toFixed(0)}%)，开始 OCR...` });
      } else {
        console.warn(`[OCR] job=${jobId} 压缩失败，回退原始 PDF: ${r.error}`);
        updateJob(jobId, { current_hint: `压缩失败，继续用原始文件 OCR` });
      }
    }
  } else if (preset && job.file_size >= 500 * 1024 * 1024) {
    updateJob(jobId, { current_hint: `文件超过 500MB，跳过压缩（ghostscript 太慢）` });
  } else {
    // 正常 OCR
    updateJob(jobId, { current_hint: null });
  }

  const outDir = job.output_dir || resultDirName(jobId);
  // 确保输出目录存在
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const args = [
    ENGINE_SCRIPT,
    effectiveFilePath,
    '--engine', job.engine || 'rapidocr',
    '--start-page', String(startPage),
    '--end-page', String(job.total_pages),
    '--format', job.ocr_format || 'markdown',
    '--output-dir', outDir,
  ];

  return new Promise<void>((resolve, reject) => {

    let proc: ChildProcess;
    try {
      // 优先 python3.11（brew 装的，Docling/PaddleOCR 等装在这里），
      // 退化到系统 python3（仅 RapidOCR/Vision）
      let pythonBin = 'python3';
      for (const cand of ['python3.11', '/opt/homebrew/bin/python3.11', 'python3', 'python']) {
        try {
          execSync(`${cand} --version`, { stdio: 'ignore' });
          pythonBin = cand;
          break;
        } catch {}
      }
      proc = spawn(pythonBin, args, {
        cwd: OCR_RESULTS_DIR,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          // 确保 brew 的 python3.11 优先级
          PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:${process.env.PATH}`,
          // MinerU Cloud API 配置（Python 引擎从 env 读取，避免额外 sqlite 依赖）
          MINERU_API_BASE: resolveMineruApiBase(),
          MINERU_API_TOKEN: resolveMineruApiToken(),
          // 数据目录（MinerU 不需要，但其他引擎可能用到）
          ANLI_DATA_DIR: DATA_DIR,
        },
      });
    } catch (err: any) {
      updateJob(jobId, { status: 'failed', error_msg: `spawn python 失败: ${err.message}` });
      return reject(err);
    }

    if (!proc.pid) {
      updateJob(jobId, { status: 'failed', error_msg: 'python3 启动失败（PID 为空）' });
      activeProcesses.delete(jobId);
      return reject(new Error('python3 启动失败'));
    }

    activeProcesses.set(jobId, proc);
    updateJob(jobId, { progress_pid: proc.pid });

    let stderrBuf = '';

    proc.stderr?.on('data', (chunk) => {
      stderrBuf += chunk.toString();
    });

    proc.stdout?.on('data', (chunk) => {
      try {
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          let evt: any;
          try {
            evt = JSON.parse(line);
          } catch {
            continue; // 跳过非 JSON 行
          }
          try {
            handleEngineEvent(jobId, evt, outDir);
          } catch (e) {
            console.error(`[OCR] handleEngineEvent 错误 job=${jobId}:`, e);
          }
        }
      } catch (e) {
        console.error(`[OCR] stdout handler 错误 job=${jobId}:`, e);
      }
    });

    proc.on('close', (code) => {
      activeProcesses.delete(jobId);
      updateJob(jobId, { progress_pid: null });

      if (code === 0) {
        // 正常退出 → 可能全部完成，也可能暂停后恢复时 kill 了
        const j = getJob(jobId);
        if (j?.status === 'processing') {
          // 检查是否真的全完成
          const maxP = db.prepare('SELECT COALESCE(MAX(page_num), 0) as m FROM ocr_pages WHERE job_id = ?').get(jobId) as any;
          if (maxP.m >= j.total_pages) {
            finalizeJob(jobId);
          } else {
            // 进程被外部终止（比如服务重启），标记为暂停等待续跑
            updateJob(jobId, { status: 'paused', error_msg: '进程意外终止，可恢复' });
          }
        }
      } else if (code === 130) {
        // 收到取消信号
        updateJob(jobId, { status: 'canceled', error_msg: '用户取消' });
      } else {
        // 错误退出
        const err = stderrBuf.trim() || '未知错误';
        updateJob(jobId, { status: 'failed', error_msg: err.slice(-500) });
      }
      resolve();
    });

    proc.on('error', (err) => {
      activeProcesses.delete(jobId);
      updateJob(jobId, { status: 'failed', error_msg: err.message });
      reject(err);
    });
  });
}

// ======== 引擎事件处理 ========

function handleEngineEvent(jobId: number, evt: any, outDir: string) {
  switch (evt.type) {
    case 'progress': {
      runSync(
        `INSERT OR IGNORE INTO ocr_pages (job_id, page_num, status) VALUES (?, ?, 'processing')`,
        [jobId, evt.page]
      );
      runSync(
        `UPDATE ocr_pages SET status = 'processing', updated_at = datetime('now') WHERE job_id = ? AND page_num = ?`,
        [jobId, evt.page]
      );
      break;
    }
    case 'page_text': {
      runSync(
        `INSERT OR IGNORE INTO ocr_pages (job_id, page_num, status, text, result_path) VALUES (?, ?, 'done', ?, ?)`,
        [jobId, evt.page, evt.text || '', evt.path || null]
      );
      runSync(
        `UPDATE ocr_pages SET status = 'done', text = ?, result_path = ?, updated_at = datetime('now') WHERE job_id = ? AND page_num = ?`,
        [evt.text || '', evt.path || null, jobId, evt.page]
      );
      // 更新 done_pages 计数
      const j = getJob(jobId);
      if (j) {
        const done = (j.done_pages || 0) + 1;
        updateJob(jobId, { done_pages: Math.min(done, j.total_pages) });
      }
      break;
    }
    case 'page_error': {
      runSync(
        `INSERT OR IGNORE INTO ocr_pages (job_id, page_num, status) VALUES (?, ?, 'failed')`,
        [jobId, evt.page]
      );
      runSync(
        `UPDATE ocr_pages SET status = 'failed', error_msg = ?, updated_at = datetime('now') WHERE job_id = ? AND page_num = ?`,
        [evt.error || '', jobId, evt.page]
      );
      const j = getJob(jobId);
      if (j) {
        updateJob(jobId, {
          done_pages: Math.min((j.done_pages || 0) + 1, j.total_pages),
          failed_pages: (j.failed_pages || 0) + 1,
        });
      }
      break;
    }
    case 'postprocess_done': {
      // 后处理完成（docx/md/json/txt 输出文件生成）
      const j = getJob(jobId);
      if (j && evt.output_path) {
        updateJob(jobId, { result_dir: path.dirname(evt.output_path) });
      }
      break;
    }
    case 'info':
      // 更新 current_hint 让前端显示实时提示
      if (evt.msg) updateJob(jobId, { current_hint: evt.msg });
      break;
    case 'fatal': {
      updateJob(jobId, { status: 'failed', error_msg: (evt.error || '').slice(-500) });
      break;
    }
    case 'done':
      // 引擎层面完成（所有传入的 start-end 页都处理了）
      break;
  }
}

// ======== 任务完成 ========

function finalizeJob(jobId: number) {
  const job = getJob(jobId);
  if (!job) return;

  // 汇总所有 done 页的文本
  const pages = db
    .prepare('SELECT page_num, text FROM ocr_pages WHERE job_id = ? AND status = ? ORDER BY page_num')
    .all(jobId, 'done') as { page_num: number; text: string }[];

  const merged = pages.map((p) => p.text).join('\n\n');

  updateJob(jobId, {
    status: 'done',
    merged_text: merged,
    finished_at: new Date().toISOString(),
  });

  // 如果关联了 file_id，同步写入 file_ocr_text（供 AI 助手使用）
  if (job.file_id) {
    const exists = db.prepare('SELECT 1 FROM file_ocr_text WHERE file_id = ?').get(job.file_id);
    if (exists) {
      runSync('UPDATE file_ocr_text SET ocr_status = ?, ocr_text = ?, updated_at = datetime("now") WHERE file_id = ?',
        ['done', merged, job.file_id]);
    } else {
      runSync('INSERT INTO file_ocr_text (file_id, ocr_status, ocr_text) VALUES (?, ?, ?)',
        [job.file_id, 'done', merged]);
    }
  }
}

// ======== 暂停 / 取消 ========

export function pauseJob(jobId: number): boolean {
  // 如果还在等待队列里，直接从队列移除并标记 paused
  const queueIdx = waitingQueue.indexOf(jobId);
  if (queueIdx !== -1) {
    waitingQueue.splice(queueIdx, 1);
    runningFns.delete(jobId);
    updateJob(jobId, { status: 'paused' });
    console.log(`[OCR Scheduler] job=${jobId} 从等待队列移除并标记 paused`);
    return true;
  }
  const proc = activeProcesses.get(jobId);
  if (!proc) return false;
  try {
    proc.kill('SIGUSR1');
    updateJob(jobId, { status: 'paused' });
    return true;
  } catch {
    return false;
  }
}

export function resumeJob(jobId: number): Promise<void> {
  const proc = activeProcesses.get(jobId);
  if (proc) {
    // 暂停状态：发 SIGUSR1 恢复（Python 引擎里 paused 标志置 false）
    try {
      proc.kill('SIGUSR1');
      updateJob(jobId, { status: 'processing' });
    } catch {}
    return Promise.resolve();
  }
  // 重新排队启动（断点续做由 runJob 内部处理）
  return startJob(jobId);
}

export function cancelJob(jobId: number): boolean {
  // 如果还在等待队列里，直接移除标记 canceled，不启动了
  const queueIdx = waitingQueue.indexOf(jobId);
  if (queueIdx !== -1) {
    waitingQueue.splice(queueIdx, 1);
    runningFns.delete(jobId);
    updateJob(jobId, { status: 'canceled', error_msg: '用户取消' });
    console.log(`[OCR Scheduler] job=${jobId} 从等待队列移除并取消`);
    tryDispatch(); // 腾出队列位后尝试下一个
    return true;
  }
  const proc = activeProcesses.get(jobId);
  if (proc) {
    try {
      proc.kill('SIGUSR2'); // 先发取消信号
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
      }, 3000); // 3 秒后强制 kill
    } catch {}
  }
  updateJob(jobId, { status: 'canceled', error_msg: '用户取消', progress_pid: null });
  activeProcesses.delete(jobId);
  return true;
}

export function retryJob(jobId: number): Promise<void> {
  // 先清队列（如果之前在排队）
  const queueIdx = waitingQueue.indexOf(jobId);
  if (queueIdx !== -1) {
    waitingQueue.splice(queueIdx, 1);
    runningFns.delete(jobId);
  }
  // 重置所有页，重新跑
  runSync('UPDATE ocr_pages SET status = ? WHERE job_id = ?', ['pending', jobId]);
  updateJob(jobId, {
    status: 'pending',
    done_pages: 0,
    failed_pages: 0,
    error_msg: null,
    merged_text: null,
    started_at: null,
    finished_at: null,
  });
  return startJob(jobId);
}

// ======== 调度器重置（一键恢复初始状态） ========

export interface ResetResult {
  killed_python: number;
  killed_ghostscript: number;
  reset_jobs: number;
  reset_pages: number;
  details: {
    killed_pids: number[];
    reset_job_ids: number[];
  };
}

/**
 * 强制重置 OCR 调度器：
 *   1. 杀掉所有活跃的 Python OCR 子进程
 *   2. 杀掉所有 ghostscript 子进程（压缩用）
 *   3. 清空内存队列（activeCount / waitingQueue / runningFns / activeProcesses）
 *   4. DB 里 processing/paused/failed 任务 → pending（清除 error/hint/progress_pid）
 *      - done / canceled 保持不变
 *      - pending 保持不变
 *   5. ocr_pages 里 processing 状态 → pending
 *
 * 不会丢失已完成页面的 OCR 结果（done 状态保留），断点续做自然生效。
 */
export function resetScheduler(): ResetResult {
  const result: ResetResult = {
    killed_python: 0,
    killed_ghostscript: 0,
    reset_jobs: 0,
    reset_pages: 0,
    details: { killed_pids: [], reset_job_ids: [] },
  };

  // 1. 杀掉所有已注册的 Python 子进程
  for (const [jobId, proc] of activeProcesses) {
    try {
      const pid = proc.pid;
      if (pid) result.details.killed_pids.push(pid);
      proc.kill('SIGKILL');
      result.killed_python++;
      console.log(`[OCR Reset] kill Python PID=${pid} (job=${jobId})`);
    } catch (e: any) {
      console.warn(`[OCR Reset] kill Python 失败 job=${jobId}: ${e.message}`);
    }
  }

  // 2. 杀掉所有 ghostscript pdfwrite 子进程（包括没有在 activeProcesses 里注册的）
  try {
    const out = execSync("pgrep -f '[g]s.*pdfwrite' || true", { encoding: 'utf-8' }).trim();
    if (out) {
      const pids = out.split('\n').map((s: string) => parseInt(s.trim())).filter((n: number) => n > 0);
      for (const pid of pids) {
        try {
          process.kill(pid, 'SIGKILL');
          result.details.killed_pids.push(pid);
          result.killed_ghostscript++;
          console.log(`[OCR Reset] kill ghostscript PID=${pid}`);
        } catch {}
      }
    }
  } catch (e: any) {
    console.warn(`[OCR Reset] ghostscript 清理失败: ${e.message}`);
  }

  // 3. 清空内存状态
  activeProcesses.clear();
  activeCount.clear();
  waitingQueue.length = 0;
  runningFns.clear();

  // 4. DB：processing/paused/failed → pending
  const toReset = db
    .prepare("SELECT id FROM ocr_jobs WHERE status IN ('processing', 'paused', 'failed')")
    .all() as { id: number }[];
  for (const j of toReset) {
    updateJob(j.id, {
      status: 'pending',
      error_msg: null,
      current_hint: null,
      progress_pid: null,
    });
    result.details.reset_job_ids.push(j.id);
    result.reset_jobs++;
  }

  // 5. DB：ocr_pages processing → pending
  const resetPagesResult = db
    .prepare("UPDATE ocr_pages SET status = 'pending' WHERE status = 'processing'")
    .run();
  result.reset_pages = Number(resetPagesResult.changes);

  console.log(`[OCR Reset] 完成: kill_py=${result.killed_python} kill_gs=${result.killed_ghostscript} reset_jobs=${result.reset_jobs} reset_pages=${result.reset_pages}`);

  return result;
}

// ======== 启动时恢复 + 定时巡检 ========

export function recoverJobsOnStartup() {
  const todos = db
    .prepare("SELECT id FROM ocr_jobs WHERE status IN ('paused','processing','pending')")
    .all() as { id: number }[];

  for (const j of todos) {
    startJob(j.id).catch(() => {});
  }
  if (todos.length > 0) {
    console.log(`[OCR] 启动恢复 ${todos.length} 个未完成任务（含 pending）`);
  }

  // 定时巡检：每 15s 捞一下 DB 里 pending 但没在跑的任务
  // 解决 race condition：tsx watch 热重载期间、或 startJob 被吞错时
  const INTERVAL_MS = 15_000;
  setInterval(() => {
    const running = Array.from(activeCount).concat([...waitingQueue]);
    let stuck: { id: number }[];
    if (running.length === 0) {
      stuck = db.prepare("SELECT id FROM ocr_jobs WHERE status = 'pending'").all() as { id: number }[];
    } else {
      const placeholders = running.map(() => '?').join(',');
      stuck = db.prepare(`SELECT id FROM ocr_jobs WHERE status = 'pending' AND id NOT IN (${placeholders})`).all(...running) as { id: number }[];
    }
    for (const j of stuck) {
      console.log(`[OCR] 定时巡检捞起卡住的 pending job=${j.id}`);
      startJob(j.id).catch(() => {});
    }
  }, INTERVAL_MS).unref(); // 不阻止进程退出
}
