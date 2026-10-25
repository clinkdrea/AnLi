import { useEffect, useRef, useState } from 'react';
import { X, ChevronDown, Search, Check } from 'lucide-react';

export interface UserOption {
  id: number;
  name: string;
  role?: string;
}

const POPUP_HEIGHT = 264; // 搜索行 + 列表最大高（估算，用于向上翻转）

// Ant Select（tags 模式）风格的用户多选：
// input 样式容器内展示已选 option（带删除 icon），点击展开下拉 popup 多选
export default function AssigneeSelect({
  users, value, onChange, placeholder = '请选择处理人', disabled,
}: {
  users: UserOption[];
  value: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [kw, setKw] = useState('');
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const updatePos = () => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const up = r.bottom + POPUP_HEIGHT > window.innerHeight && r.top > window.innerHeight - r.bottom;
    setPos({
      left: r.left,
      width: r.width,
      top: up ? r.top - POPUP_HEIGHT - 4 : r.bottom + 4,
      up,
    });
  };

  // 打开时定位；滚动/缩放时跟随（fixed 定位以穿透 overflow 裁剪容器）
  useEffect(() => {
    if (!open) return;
    updatePos();
    const onRepos = () => updatePos();
    window.addEventListener('scroll', onRepos, true);
    window.addEventListener('resize', onRepos);
    return () => {
      window.removeEventListener('scroll', onRepos, true);
      window.removeEventListener('resize', onRepos);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 点击外部关闭 popup
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = value
    .map((id) => users.find((u) => u.id === id))
    .filter(Boolean) as UserOption[];
  const filtered = users.filter((u) => u.name.includes(kw.trim()));

  const toggle = (id: number) => {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };
  const remove = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    onChange(value.filter((x) => x !== id));
  };

  return (
    <div ref={rootRef} className="relative">
      {/* input 样式容器 */}
      <div
        onClick={() => { if (!disabled) setOpen((o) => !o); }}
        className={`min-h-[34px] w-full border rounded px-1.5 py-1 flex items-center flex-wrap gap-1 text-sm transition-colors
          ${disabled ? 'bg-slate-50 text-slate-400 cursor-not-allowed border-slate-200'
            : open ? 'border-amber-500 ring-1 ring-amber-300 cursor-pointer'
                   : 'border-slate-300 hover:border-amber-400 cursor-pointer bg-white'}`}>
        {selected.length === 0 && <span className="text-slate-400 px-1 select-none">{placeholder}</span>}
        {selected.map((u) => (
          <span key={u.id}
            className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 text-xs rounded bg-amber-100 text-amber-800 max-w-[160px]">
            <span className="truncate">{u.name}</span>
            {!disabled && (
              <button type="button" onClick={(e) => remove(u.id, e)}
                className="shrink-0 rounded-full hover:bg-amber-200 p-0.5">
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        ))}
        <ChevronDown className={`w-4 h-4 ml-auto text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>

      {/* 下拉 popup（fixed 定位，穿透看板列等 overflow 容器） */}
      {open && !disabled && pos && (
        <div style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width, zIndex: 60 }}
          className="bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-slate-100 flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input value={kw} onChange={(e) => setKw(e.target.value)}
              placeholder="搜索成员" autoFocus
              className="w-full text-xs outline-none placeholder:text-slate-400" />
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 && <p className="text-xs text-slate-400 px-3 py-2">无匹配成员</p>}
            {filtered.map((u) => {
              const checked = value.includes(u.id);
              return (
                <button type="button" key={u.id} onClick={() => toggle(u.id)}
                  className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2
                    ${checked ? 'bg-amber-50 text-amber-800' : 'hover:bg-slate-50 text-slate-700'}`}>
                  <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0
                    ${checked ? 'bg-amber-500 border-amber-500 text-white' : 'border-slate-300'}`}>
                    {checked && <Check className="w-3 h-3" />}
                  </span>
                  <span className="truncate">{u.name}</span>
                  {u.role && <span className="text-[11px] text-slate-400 ml-auto">{u.role}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// 截止时间已过且未完成（含后端懒标记的 expired、以及 doing 态超时）
export function isTaskOverdue(status: string, dueDate?: string | null): boolean {
  if (!dueDate) return false;
  if (status === 'done') return false;
  if (status === 'expired') return true;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  if (dueDate.length === 10) {
    // 仅日期：过了当天才算过期
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    return dueDate < today;
  }
  const nowStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return dueDate.slice(0, 16) < nowStr;
}
