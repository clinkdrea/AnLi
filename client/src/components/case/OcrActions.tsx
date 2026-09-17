import { useState } from 'react';
import { FileScan, X, Copy, Check, RefreshCw } from 'lucide-react';

// 支持 OCR 的图片扩展名（与后端 services/ocr.ts 保持一致）
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif', '.heic', '.webp']);
export function isImageFile(fileName: string): boolean {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  return IMAGE_EXTS.has('.' + ext);
}

// OCR 文本查看弹窗（文书资料 / 证据清单共用）
export function OcrTextModal({ fileName, text, onClose, onReOCR, reRunning }: {
  fileName: string;
  text: string;
  onClose: () => void;
  onReOCR?: () => void;
  reRunning?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时静默
    }
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg p-5 w-[640px] max-w-[90vw] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold flex items-center gap-2 min-w-0">
            <FileScan className="w-5 h-5 text-amber-500 shrink-0" />
            <span className="truncate">OCR 识别结果：{fileName}</span>
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        <pre className="flex-1 overflow-y-auto whitespace-pre-wrap break-words text-sm bg-slate-50 border border-slate-200 rounded p-3 leading-6 font-sans">
{text || '(无识别文本)'}
        </pre>
        <div className="flex justify-end gap-2 mt-3">
          {onReOCR && (
            <button onClick={onReOCR} disabled={reRunning}
              className="flex items-center gap-1 px-3 py-1.5 border border-slate-300 rounded text-sm hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${reRunning ? 'animate-spin' : ''}`} />
              {reRunning ? '识别中…' : '重新识别'}
            </button>
          )}
          <button onClick={copy}
            className="flex items-center gap-1 px-3 py-1.5 border border-slate-300 rounded text-sm hover:bg-slate-50">
            {copied ? <><Check className="w-4 h-4 text-green-600" /> 已复制</> : <><Copy className="w-4 h-4" /> 复制文本</>}
          </button>
          <button onClick={onClose}
            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded text-sm">
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

interface OcrFile {
  id: number;
  file_name: string;
  ocr_status?: string;
  ocr_text?: string | null;
}

// OCR 状态 + 操作（识别 / 重新识别 / 查看文本），文书资料与证据清单共用
// size='cell' 用于表格单元格（带状态文字），'inline' 用于紧凑文件行（图标为主）
export default function OcrActions({ file, onChanged, size = 'inline' }: {
  file: OcrFile;
  onChanged?: () => void;
  size?: 'cell' | 'inline';
}) {
  const [busy, setBusy] = useState(false);
  const [showText, setShowText] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  const runOCR = async (force = false) => {
    if (busy) return;
    setBusy(true); setErrMsg('');
    try {
      const res = await fetch(`/api/files/${file.id}/ocr${force ? '?force=1' : ''}`, {
        method: 'POST',
        credentials: 'include',
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'OCR 失败');
      onChanged?.();
      // 识别成功后直接弹出结果
      setShowText(true);
    } catch (e: any) {
      setErrMsg(e.message);
      setTimeout(() => setErrMsg(''), 4000);
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  // 非图片：后端不支持识别，给出静态提示
  if (!isImageFile(file.file_name)) {
    return size === 'cell'
      ? <span className="text-xs text-slate-300" title="仅图片支持 OCR">—</span>
      : null;
  }

  const status = file.ocr_status || 'pending';

  if (size === 'cell') {
    return (
      <>
        {status === 'done' ? (
          <span className="inline-flex items-center gap-2">
            <span className="text-xs text-green-600">已识别</span>
            <button onClick={() => setShowText(true)} className="text-xs text-blue-600 hover:underline">查看文本</button>
            <button onClick={() => runOCR(true)} disabled={busy} title="重新识别"
              className="text-slate-400 hover:text-amber-600 disabled:opacity-40">
              <RefreshCw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} />
            </button>
          </span>
        ) : status === 'processing' ? (
          <span className="text-xs text-amber-500">识别中…</span>
        ) : status === 'failed' ? (
          <span className="inline-flex items-center gap-2">
            <span className="text-xs text-red-500">失败</span>
            <button onClick={() => runOCR(false)} disabled={busy}
              className="text-xs text-blue-600 hover:underline disabled:opacity-40">
              {busy ? '识别中…' : '重试'}
            </button>
          </span>
        ) : (
          <button onClick={() => runOCR(false)} disabled={busy}
            className="text-xs text-blue-600 hover:underline disabled:opacity-50 inline-flex items-center gap-1">
            <FileScan className="w-3.5 h-3.5" /> {busy ? '识别中…' : '识别'}
          </button>
        )}
        {errMsg && <span className="ml-2 text-xs text-red-500">{errMsg}</span>}
        {showText && (
          <OcrTextModal fileName={file.file_name}
            text={file.ocr_text || ''}
            onClose={() => setShowText(false)}
            onReOCR={() => runOCR(true)}
            reRunning={busy} />
        )}
      </>
    );
  }

  // inline 紧凑模式：图标按钮 + tooltip
  const titleMap: Record<string, string> = {
    pending: 'OCR 识别', processing: '识别中…', done: '查看 OCR 识别文本（弹窗内可重新识别）', failed: '识别失败，点击重试',
  };
  return (
    <>
      <button
        onClick={() => { if (status === 'done') setShowText(true); else void runOCR(false); }}
        disabled={busy || status === 'processing'}
        title={titleMap[status] || 'OCR 识别'}
        className={`shrink-0 disabled:opacity-40 ${
          status === 'done' ? 'text-green-500 hover:text-green-700'
          : status === 'failed' ? 'text-red-400 hover:text-red-600'
          : 'text-slate-300 hover:text-amber-600'
        }`}>
        <FileScan className={`w-3.5 h-3.5 ${busy ? 'animate-pulse' : ''}`} />
      </button>
      {errMsg && <span className="text-[10px] text-red-500" title={errMsg}>!</span>}
      {showText && (
        <OcrTextModal fileName={file.file_name}
          text={file.ocr_text || ''}
          onClose={() => setShowText(false)}
          onReOCR={() => runOCR(true)}
          reRunning={busy} />
      )}
    </>
  );
}
