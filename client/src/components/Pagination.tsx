import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}

// 通用分页控件：显示「上一页 页码… 下一页」与总数
export default function Pagination({ page, pageSize, total, onChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= 0) return null;

  // 生成页码按钮：当前页前后各 2 页，超出用省略号
  const pages: (number | '...')[] = [];
  const push = (v: number | '...') => pages.push(v);
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) push(i);
  } else {
    push(1);
    if (page > 4) push('...');
    const start = Math.max(2, page - 2);
    const end = Math.min(totalPages - 1, page + 2);
    for (let i = start; i <= end; i++) push(i);
    if (page < totalPages - 3) push('...');
    push(totalPages);
  }

  const btnCls = 'min-w-[32px] h-8 px-2 rounded border text-sm flex items-center justify-center';
  return (
    <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-3 border-t bg-slate-50">
      <div className="text-xs text-slate-500">
        共 <span className="font-medium text-slate-700">{total}</span> 条，第 {page}/{totalPages} 页
      </div>
      <div className="flex items-center gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className={`${btnCls} ${page <= 1 ? 'text-slate-300 cursor-not-allowed' : 'hover:bg-white text-slate-600'}`}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`e${i}`} className="px-1 text-slate-400 text-sm">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onChange(p)}
              className={`${btnCls} ${p === page
                ? 'bg-amber-500 text-white border-amber-500'
                : 'hover:bg-white text-slate-600'}`}
            >
              {p}
            </button>
          )
        )}
        <button
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          className={`${btnCls} ${page >= totalPages ? 'text-slate-300 cursor-not-allowed' : 'hover:bg-white text-slate-600'}`}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
