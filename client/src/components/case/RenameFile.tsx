import { useState } from 'react';
import { Pencil, X, Check } from 'lucide-react';

// 从完整文件名取主体（不含扩展名）和扩展名
export function splitName(fileName: string): { base: string; ext: string } {
  const idx = fileName.lastIndexOf('.');
  // 点在开头（如 .gitignore）或无点：整体视为主体
  if (idx <= 0) return { base: fileName, ext: '' };
  return { base: fileName.slice(0, idx), ext: fileName.slice(idx) };
}

// 文件重命名弹窗（文书资料 / 证据清单共用）
// 只编辑文件名主体，扩展名固定展示（与后端保留原扩展名策略一致）
export function RenameFileModal({ file, onClose, onRenamed }: {
  file: { id: number; file_name: string };
  onClose: () => void;
  onRenamed: (newName: string) => void;
}) {
  const { base, ext } = splitName(file.file_name);
  const [value, setValue] = useState(base);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!value.trim()) { setErr('文件名不能为空'); return; }
    setSaving(true); setErr('');
    try {
      const res = await fetch(`/api/files/${file.id}/rename`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: value.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || '重命名失败');
      onRenamed(d.file_name);
    } catch (e: any) {
      setErr(e.message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg p-5 w-[440px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold flex items-center gap-2">
            <Pencil className="w-4 h-4 text-amber-500" /> 重命名文件
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex items-stretch border border-slate-300 rounded focus-within:border-amber-400">
          <input value={value} autoFocus
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') onClose(); }}
            className="flex-1 px-3 py-2 text-sm outline-none rounded-l min-w-0"
            placeholder="输入新的文件名" />
          {ext && (
            <span className="px-2.5 py-2 text-sm text-slate-400 bg-slate-50 border-l border-slate-200 rounded-r select-none whitespace-nowrap">
              {ext}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-1.5">扩展名 {ext || '（无）'} 保持不变；如遇同名文件将自动追加序号。</p>
        {err && <div className="text-red-500 text-sm mt-2">{err}</div>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 border rounded text-sm">取消</button>
          <button onClick={submit} disabled={saving}
            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded text-sm flex items-center gap-1">
            <Check className="w-4 h-4" /> {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

// 重命名图标按钮（点击打开弹窗）；两处文件列表共用
export function RenameFileButton({ file, onRenamed, className }: {
  file: { id: number; file_name: string };
  onRenamed: (newName: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} title="重命名"
        className={className || 'text-slate-400 hover:text-amber-600'}>
        <Pencil className="w-3.5 h-3.5" />
      </button>
      {open && (
        <RenameFileModal file={file} onClose={() => setOpen(false)}
          onRenamed={(n) => { setOpen(false); onRenamed(n); }} />
      )}
    </>
  );
}
