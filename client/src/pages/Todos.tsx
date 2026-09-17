import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FileDown, Search, Check, Clock, X, Filter } from 'lucide-react';
import { api } from '../api';
import Pagination from '../components/Pagination';

const PAGE_SIZE = 20;

const STATUS_OPTS = [
  { v: 'all', l: '全部状态' },
  { v: 'todo', l: '待办' },
  { v: 'expired', l: '已过期' },
  { v: 'done', l: '已完成' },
];

const STATUS_LABEL: Record<string, string> = {
  todo: '待办', expired: '已过期', done: '已完成',
};
const STATUS_CLS: Record<string, string> = {
  todo: 'bg-amber-100 text-amber-700',
  expired: 'bg-red-100 text-red-700',
  done: 'bg-green-100 text-green-700',
};

function fmtDateTime(v?: string) {
  if (!v) return '未设';
  if (v.includes('T')) return v.replace('T', ' ').slice(0, 16);
  return v;
}

export default function Todos() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [cases, setCases] = useState<any[]>([]);
  const [status, setStatus] = useState('all');
  const [caseId, setCaseId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [sortBy, setSortBy] = useState<'due' | 'created'>('due');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [tip, setTip] = useState('');

  useEffect(() => {
    api('/cases/select').then((d) => setCases(d.cases || [])).catch(() => {});
  }, []);

  const load = (p = page) => {
    const params = new URLSearchParams();
    if (status !== 'all') params.set('status', status);
    if (caseId) params.set('case_id', caseId);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (q.trim()) params.set('q', q.trim());
    params.set('sort', sortBy);
    params.set('order', order);
    params.set('page', String(p));
    params.set('pageSize', String(PAGE_SIZE));
    api(`/todos?${params.toString()}`).then((d) => {
      setTasks(d.tasks || []);
      setTotal(d.total || 0);
    });
  };
  // 筛选条件变化时回到第一页
  useEffect(() => { setPage(1); load(1); }, [status, caseId, from, to, q, sortBy, order]);
  // 翻页
  const goPage = (p: number) => { setPage(p); load(p); };

  // 搜索框回车或按钮触发查询
  const search = (e?: any) => { e?.preventDefault?.(); load(); };

  const toggleSelect = (id: number) => {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const allSelected = tasks.length > 0 && tasks.every((t) => selected.has(t.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(tasks.map((t) => t.id)));

  const exportSelected = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) { setTip('请先勾选要导出的任务'); setTimeout(() => setTip(''), 3000); return; }
    const a = document.createElement('a');
    a.href = `/api/tasks/export-ics?ids=${ids.join(',')}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTip(`已下载 ${ids.length} 个任务的 .ics 文件，双击即可导入本机日历`);
    setTimeout(() => setTip(''), 5000);
  };

  const exportOne = (t: any) => {
    if (!t.due_date) { setTip('该任务没有截止时间，无法导出'); setTimeout(() => setTip(''), 3000); return; }
    const a = document.createElement('a');
    a.href = `/api/tasks/${t.id}/export-ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTip(`已下载「${t.title}」的 .ics 文件`);
    setTimeout(() => setTip(''), 5000);
  };

  const toggleDone = async (t: any) => {
    const next = t.status === 'done' ? 'todo' : 'done';
    await api(`/tasks/${t.id}`, { method: 'PUT', body: JSON.stringify({ status: next }) });
    load();
  };

  const resetFilters = () => {
    setStatus('all'); setCaseId(''); setFrom(''); setTo(''); setQ(''); setSortBy('due'); setOrder('asc');
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Link to="/" className="text-slate-400 hover:text-amber-600"><ArrowLeft className="w-5 h-5" /></Link>
        <h1 className="text-2xl font-bold">待办中心</h1>
        <span className="text-slate-400 text-sm">查看所有待办（含已过期、已完成），支持筛选与排序</span>
      </div>

      {/* 筛选栏 */}
      <form onSubmit={search} className="bg-white rounded shadow p-4 mt-4 mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Filter className="w-4 h-4 text-slate-400" />
            <select value={status} onChange={(e) => setStatus(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1.5 text-sm">
              {STATUS_OPTS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
            </select>
          </div>
          <select value={caseId} onChange={(e) => setCaseId(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1.5 text-sm min-w-[180px]">
            <option value="">全部案件</option>
            {cases.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="flex items-center gap-1 text-sm">
            <span className="text-slate-400">截止时间</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
            <span className="text-slate-400">至</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索任务标题"
              className="w-full border border-slate-300 rounded pl-10 pr-3 py-1.5 text-sm" />
          </div>
          <button type="submit" className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded text-sm">查询</button>
          <button type="button" onClick={resetFilters}
            className="text-xs text-slate-500 hover:text-amber-600 flex items-center gap-1">
            <X className="w-3.5 h-3.5" /> 重置
          </button>
        </div>
        {/* 排序 + 导出 */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-1 text-xs">
            <span className="text-slate-400">排序：</span>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}
              className="border border-slate-300 rounded px-2 py-1.5">
              <option value="due">按截止时间</option>
              <option value="created">按创建时间</option>
            </select>
            <button onClick={() => setOrder(order === 'asc' ? 'desc' : 'asc')}
              className="border border-slate-300 rounded px-2 py-1.5 hover:bg-slate-50">
              {order === 'asc' ? '升序' : '降序'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            {tasks.length > 0 && (
              <button onClick={toggleAll} className="text-xs text-slate-500 hover:text-amber-600">
                {allSelected ? '取消全选' : '全选'} ({selected.size}/{tasks.length})
              </button>
            )}
            <button onClick={exportSelected} disabled={selected.size === 0}
              className="flex items-center gap-1 border border-emerald-500 text-emerald-600 hover:bg-emerald-50 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded text-sm">
              <FileDown className="w-4 h-4" /> 导出选中{selected.size > 0 ? `（${selected.size}）` : ''}
            </button>
          </div>
        </div>
      </form>

      {tip && <div className="mb-3 text-sm text-green-600 bg-green-50 border border-green-200 rounded px-3 py-2">{tip}</div>}

      {/* 列表 */}
      <div className="bg-white rounded shadow overflow-hidden">
        {tasks.length === 0 && <div className="p-10 text-center text-slate-400 text-sm">没有符合条件的任务</div>}
        {tasks.map((t) => {
          const isSel = selected.has(t.id);
          const overdue = t.status === 'expired';
          return (
            <div key={t.id} className={`px-4 py-3 border-b last:border-0 flex items-center gap-3 ${isSel ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}>
              {/* 完成标记 */}
              <button onClick={() => toggleDone(t)} title="切换完成状态"
                className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${t.status === 'done' ? 'bg-green-500 border-green-500' : overdue ? 'border-red-400' : 'border-slate-300'}`}>
                {t.status === 'done' && <Check className="w-3 h-3 text-white" />}
              </button>
              {/* 内容 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${t.status === 'done' ? 'line-through text-slate-400' : overdue ? 'text-red-500' : ''}`}>
                    {t.title}
                  </span>
                  {t.kind === 'hearing' && <span className="text-[10px] px-1 py-px bg-red-100 text-red-600 rounded">开庭</span>}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_CLS[t.status] || 'bg-slate-100'}`}>
                    {STATUS_LABEL[t.status] || t.status}
                  </span>
                  <span className={`text-[10px] ${t.priority === 'high' ? 'text-red-500' : 'text-slate-400'}`}>
                    {t.priority === 'high' ? '高' : t.priority === 'medium' ? '中' : '低'}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                  {t.case_id && t.case_name
                    ? <Link to={`/cases/${t.case_id}`} className="hover:text-amber-600 hover:underline truncate">{t.case_name}</Link>
                    : <span className="text-slate-400">个人待办</span>}
                  <span className="flex items-center gap-0.5">
                    <Clock className="w-3 h-3" /> 截止 {fmtDateTime(t.due_date)}
                    {overdue && <span className="text-red-500">（已过期）</span>}
                  </span>
                  <span className="text-slate-400">创建 {fmtDateTime(t.created_at)}</span>
                </div>
              </div>
              {/* 导出勾选 + 单条下载 */}
              <button onClick={() => toggleSelect(t.id)}
                className={`shrink-0 ${isSel ? 'text-emerald-500' : 'text-slate-300 hover:text-emerald-500'}`}>
                {isSel ? <Check className="w-4 h-4" /> : <span className="block w-4 h-4 border border-slate-300 rounded" />}
              </button>
              <button onClick={() => exportOne(t)} title="导出该任务为 .ics"
                className="text-slate-400 hover:text-emerald-600 shrink-0">
                <FileDown className="w-4 h-4" />
              </button>
            </div>
          );
        })}
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={goPage} />
      </div>
      <p className="text-xs text-slate-400 mt-3">
        过期任务会自动从概览看板的"我的待办"中移除，但可在此页面查看与导出。点击左侧圆点可重新激活已完成的任务。
      </p>
    </div>
  );
}
