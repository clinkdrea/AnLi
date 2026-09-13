import { execFile, execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { db } from '../db/schema.js';

const OCR_SCRIPT = path.resolve(import.meta.dirname, '../../scripts/ocr.swift');
const OCR_BIN = path.resolve(import.meta.dirname, '../../scripts/ocr');

// 编译 OCR 脚本为二进制（仅首次或脚本更新时）
function ensureCompiled() {
  if (!fs.existsSync(OCR_BIN) || fs.statSync(OCR_SCRIPT).mtime > fs.statSync(OCR_BIN).mtime) {
    execFileSync('swiftc', [OCR_SCRIPT, '-o', OCR_BIN], { stdio: 'pipe' });
  }
}

// 图片扩展名
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif', '.heic', '.webp']);

function isImage(fileName: string): boolean {
  return IMAGE_EXTS.has(path.extname(fileName).toLowerCase());
}

// 调用已编译的 OCR 二进制
function runOCR(imagePath: string): Promise<string> {
  ensureCompiled();
  return new Promise((resolve, reject) => {
    execFile(OCR_BIN, [imagePath], { timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve(stdout.trim());
        }
      });
  });
}

// 处理单个文件的 OCR
async function processFile(fileId: number) {
  const file = db.prepare('SELECT * FROM file_records WHERE id = ?').get(fileId) as any;
  if (!file || !isImage(file.file_name)) return;

  db.prepare("UPDATE file_records SET ocr_status = 'processing' WHERE id = ?").run(fileId);

  const caseRow = db.prepare('SELECT folder_path FROM cases WHERE id = ?').get(file.case_id) as any;
  const fullPath = path.join(caseRow.folder_path, file.rel_path);

  if (!fs.existsSync(fullPath)) {
    db.prepare("UPDATE file_records SET ocr_status = 'failed' WHERE id = ?").run(fileId);
    return;
  }

  try {
    const text = await runOCR(fullPath);
    db.prepare('UPDATE file_records SET ocr_status = ?, ocr_text = ? WHERE id = ?')
      .run('done', text || '(未识别到文字)', fileId);
  } catch (e) {
    db.prepare("UPDATE file_records SET ocr_status = 'failed' WHERE id = ?").run(fileId);
  }
}

// 扫描所有 pending 状态的图片文件并处理
export async function runOCRQueue() {
  const pending = db.prepare(
    "SELECT id FROM file_records WHERE ocr_status = 'pending'"
  ).all() as { id: number }[];
  for (const f of pending) {
    await processFile(f.id);
  }
}

// 对单个文件触发 OCR
export async function triggerOCR(fileId: number) {
  const file = db.prepare('SELECT ocr_status FROM file_records WHERE id = ?').get(fileId) as any;
  if (!file) return;
  if (file.ocr_status === 'pending' || file.ocr_status === 'failed') {
    await processFile(fileId);
  }
}

// 启动定时 OCR 队列（每 30 秒扫描一次）
export function startOCRWorker() {
  setInterval(() => {
    runOCRQueue().catch(() => {});
  }, 30000);
  // 启动时先跑一次
  runOCRQueue().catch(() => {});
}
