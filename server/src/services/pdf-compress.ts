/**
 * PDF 预压缩工具 — 基于 ghostscript
 *
 * 三档 preset（实测 OCR 质量对比）:
 *   /printer  — 保守，几乎不压，适合只需要去噪+规整 PDF 的场景
 *   /ebook    — 中档，压 50-70%，PaddleOCR 95% / RapidOCR 100% 识别率（无损）
 *   /screen   — 激进，压 80-90%，需加保护参数，PaddleOCR 93-104% / RapidOCR 90-93%
 *
 * 重要保护参数（screen 档必须，否则页面内容会丢失）:
 *   -dPreserveAnnots=true     保留注释
 *   -dPreserveMarkedContent=true 保留标记内容
 *   -dPreserveOpi=true        保留可选内容组
 */

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export type CompressPreset = 'printer' | 'ebook' | 'screen';

const PRESET_MAP: Record<CompressPreset, string> = {
  printer: '/printer',
  ebook: '/ebook',
  screen: '/screen',
};

/** ghostscript 查找路径（与 findPython 同理，brew 优先） */
function findGs(): string | null {
  for (const cand of ['/opt/homebrew/bin/gs', 'gs']) {
    try {
      execFileSync(cand, ['--version'], { stdio: 'ignore' });
      return cand;
    } catch {}
  }
  return null;
}

export function isCompressAvailable(): boolean {
  return findGs() !== null;
}

export interface CompressResult {
  ok: boolean;
  inputSize: number;
  outputSize: number;
  ratio: number;       // 压缩比，原始/压缩后
  outputPath?: string; // 压缩后文件路径（临时文件，调用方负责清理）
  preset: CompressPreset;
  gsVersion?: string;
  error?: string;
}

/**
 * 压缩一个 PDF 文件（同步，适合预估场景）
 * 返回压缩结果；如果压缩后反而更大，ok=false 并返回原始文件信息
 */
export function compressPdf(
  inputPath: string,
  preset: CompressPreset,
  outputPath?: string,
): CompressResult {
  const gs = findGs();
  if (!gs) {
    return {
      ok: false,
      inputSize: fs.statSync(inputPath).size,
      outputSize: 0,
      ratio: 0,
      preset,
      error: 'ghostscript 未安装（brew install ghostscript）',
    };
  }

  const inputSize = fs.statSync(inputPath).size;

  // 非 PDF 直接跳过
  if (!inputPath.toLowerCase().endsWith('.pdf')) {
    return {
      ok: false,
      inputSize,
      outputSize: inputSize,
      ratio: 1,
      preset,
      error: '非 PDF 文件',
    };
  }

  const outPath = outputPath || path.join(
    os.tmpdir(),
    `anli_compress_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`,
  );

  const gsVersion = execFileSync(gs, ['--version'], { encoding: 'utf-8' }).trim();

  // ghostscript 参数：
  // - 保护参数必须加（实测不加会导致 screen 档页面内容丢失）
  // - 用 pdfwrite 设备（最通用）
  const args = [
    '-sDEVICE=pdfwrite',
    `-dPDFSETTINGS=${PRESET_MAP[preset]}`,
    '-dNOPAUSE',
    '-dBATCH',
    '-dQUIET',
    '-dPreserveAnnots=true',
    '-dPreserveMarkedContent=true',
    '-dPreserveOPI=true',
    '-sOutputFile=' + outPath,
    inputPath,
  ];

  try {
    execFileSync(gs, args, { timeout: 600_000 }); // 10 分钟超时（大文件）
  } catch (e: any) {
    return {
      ok: false,
      inputSize,
      outputSize: 0,
      ratio: 0,
      preset,
      gsVersion,
      error: `ghostscript 执行失败: ${e?.message || e}`,
    };
  }

  if (!fs.existsSync(outPath)) {
    return {
      ok: false,
      inputSize,
      outputSize: 0,
      ratio: 0,
      preset,
      gsVersion,
      error: 'ghostscript 未生成输出文件',
    };
  }

  const outputSize = fs.statSync(outPath).size;

  // 安全检查：压缩后空文件或几乎空
  if (outputSize < 1024) {
    try { fs.rmSync(outPath); } catch {}
    return {
      ok: false,
      inputSize,
      outputSize,
      ratio: 0,
      preset,
      gsVersion,
      error: '压缩后文件异常过小（可能内容丢失），已清理临时文件',
    };
  }

  // 如果压缩后反而更大，放弃（ghostscript 对已压缩 PDF 可能 overhead 更大）
  if (outputSize >= inputSize * 0.95) {
    try { fs.rmSync(outPath); } catch {}
    return {
      ok: false,
      inputSize,
      outputSize,
      ratio: inputSize / outputSize,
      preset,
      gsVersion,
      error: `压缩后体积无明显下降（${(outputSize / 1024 / 1024).toFixed(1)}MB ≈ 原始），已放弃优化`,
    };
  }

  return {
    ok: true,
    inputSize,
    outputSize,
    ratio: inputSize / outputSize,
    outputPath: outPath,
    preset,
    gsVersion,
  };
}

/**
 * 异步压缩（带进度回调）— 用于 runJob 里的 OCR 前预处理
 * @param timeoutMs 超时毫秒数，默认 5 分钟
 */
export function compressPdfAsync(
  inputPath: string,
  preset: CompressPreset,
  outputPath: string,
  onProgress?: (hint: string) => void,
  timeoutMs = 5 * 60_000,
): Promise<CompressResult> {
  return new Promise((resolve) => {
    const gs = findGs();
    if (!gs) {
      resolve({
        ok: false,
        inputSize: fs.statSync(inputPath).size,
        outputSize: 0,
        ratio: 0,
        preset,
        error: 'ghostscript 未安装',
      });
      return;
    }

    const inputSize = fs.statSync(inputPath).size;
    const gsVersion = execFileSync(gs, ['--version'], { encoding: 'utf-8' }).trim();

    const sizeMB = (inputSize / 1024 / 1024).toFixed(1);
    onProgress?.(`ghostscript ${PRESET_MAP[preset]} 压缩中（${sizeMB}MB）...`);

    const args = [
      '-sDEVICE=pdfwrite',
      `-dPDFSETTINGS=${PRESET_MAP[preset]}`,
      '-dNOPAUSE', '-dBATCH',
      '-dPreserveAnnots=true',
      '-dPreserveMarkedContent=true',
      '-dPreserveOPI=true',
      '-sOutputFile=' + outputPath,
      inputPath,
    ];

    const proc = spawn(gs, args);
    let stderr = '';
    proc.stderr?.on('data', (c) => { stderr += c.toString(); });

    // 超时 kill
    const timer = setTimeout(() => {
      console.warn(`[pdf-compress] ghostscript 超时 (${timeoutMs}ms)，kill 进程`);
      try { proc.kill('SIGKILL'); } catch {}
      // 清理可能残留的输出文件
      try { fs.rmSync(outputPath); } catch {}
      resolve({
        ok: false, inputSize, outputSize: 0, ratio: 0, preset, gsVersion,
        error: `压缩超时（>${Math.round(timeoutMs/60000)}分钟），已 kill ghostscript 进程`,
      });
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({
          ok: false, inputSize, outputSize: 0, ratio: 0, preset, gsVersion,
          error: `ghostscript exit=${code}: ${stderr.slice(-300)}`,
        });
        return;
      }
      if (!fs.existsSync(outputPath)) {
        resolve({ ok: false, inputSize, outputSize: 0, ratio: 0, preset, gsVersion, error: '输出文件不存在' });
        return;
      }
      const outputSize = fs.statSync(outputPath).size;
      if (outputSize < 1024) {
        try { fs.rmSync(outputPath); } catch {}
        resolve({ ok: false, inputSize, outputSize, ratio: 0, preset, gsVersion, error: '压缩后文件过小' });
        return;
      }
      if (outputSize >= inputSize * 0.95) {
        try { fs.rmSync(outputPath); } catch {}
        resolve({
          ok: false, inputSize, outputSize, ratio: inputSize / outputSize, preset, gsVersion,
          error: `压缩后体积无明显下降（${(outputSize / 1024 / 1024).toFixed(1)}MB），已放弃`,
        });
        return;
      }
      resolve({
        ok: true, inputSize, outputSize, ratio: inputSize / outputSize,
        outputPath, preset, gsVersion,
      });
    });

    proc.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, inputSize, outputSize: 0, ratio: 0, preset, gsVersion, error: e.message });
    });
  });
}
