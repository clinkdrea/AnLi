import { useEffect, useState } from 'react';
import { Plus, Trash2, FileDown, Square, SquareCheck, Circle, CircleCheck } from 'lucide-react';
import { api } from '../../api';

// 格式化截止日期：支持 YYYY-MM-DD / YYYY-MM-DDTHH:MM / 含秒
function fmtTaskDue(v: string): string {
  if (!v) return '';
  if (v.includes('T')) return v.replace('T', ' ').slice(0, 16);
  return v;
}

export default function TasksTab({ caseId }: { caseId: string }) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('medium');
  // 多选：用于批量导出日历 / 批量删除；与"完成标记"独立
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [tip, setTip] = useState('');
  // 排序：due=按截止时间（默认升序），created=按创建时间（默认降序）
  const [sortBy, setSortBy] = useState<'due' | 'created'>('due');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');

  const load = () => {
    api(`/cases/${caseId}/tasks?sort=${sortBy}&order=${order}`)
      .then((d) => setTasks(d.tasks || []));
  };
  useEffect(() => { load(); }, [caseId, sortBy, order]);

  const create = async () => {
    if (!title.trim()) return;
    await api(`/cases/${caseId}/tasks`, {
      method: 'POST', body: JSON.stringify({ title, due_date: dueDate || null, priority }),
    });
    setTitle(''); setDueDate(''); setPriority('medium'); setShowForm(false);
    load();
  };

  // 切换任务完成状态：使用 icon（CircleCheck / Circle），不影响 selected
  const updateStatus = async (id: number, status: string) => {
    await api(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
    load();
  };

  const del = async (id: number) => {
    if (!confirm('确认删除？')) return;
    await api(`/tasks/${id}`, { method: 'DELETE' });
    load();
  };

  // 多选切换：点击行首勾选框
  const toggleSelect = (id: number) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const allSelected = tasks.length > 0 && tasks.every((t) => selected.has(t.id));
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(tasks.map((t) => t.id)));
  };
  // 清空选中（删除/导出后）
  const clearSelected = () => setSelected(new Set());

  // 批量删除
  const batchDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) { setTip('请先勾选要删除的任务'); setTimeout(() => setTip(''), 3000); return; }
    if (!confirm(`确认删除选中的 ${ids.length} 个任务？`)) return;
    try {
      const r = await api('/tasks/batch-delete', { method: 'POST', body: JSON.stringify({ ids }) });
      setTip(`已删除 ${r.deleted} 个任务`);
      clearSelected();
      load();
    } catch (e: any) { setTip(e.message || '删除失败'); }
    setTimeout(() => setTip(''), 4000);
  };

  // 导出选中任务为单个 .ics（合并多 VEVENT）
  const exportSelected = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) { setTip('请先勾选要导出日历的任务'); setTimeout(() => setTip(''), 3000); return; }
    const a = document.createElement('a');
    a.href = `/api/tasks/export-ics?ids=${ids.join(',')}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTip(`已下载 ${ids.length} 个任务的 .ics 文件，双击即可导入本机日历`);
    setTimeout(() => setTip(''), 5000);
  };

  // 导出单个任务为 .ics
  const exportOne = (t: any) => {
    if (!t.due_date) { setTip('该任务没有截止时间，无法导出日历'); setTimeout(() => setTip(''), 3000); return; }
    const a = document.createElement('a');
    a.href = `/api/tasks/${t.id}/export-ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTip(`已下载「${t.title}」的 .ics 文件`);
    setTimeout(() => setTip(''), 5000);
  };

  const pColor = (p: string) => ({ high: 'text-red-600', medium: 'text-amber-600', low: 'text-slate-500' }[p] || '');

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold">任务列表</h3>
        <div className="flex items-center gap-2">
          {/* 排序控件 */}
          <div className="flex items-center gap-1 text-xs">
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}
              className="border border-slate-300 rounded px-2 py-1.5">
              <option value="due">按截止时间</option>
              <option value="created">按创建时间</option>
            </select>
            <button onClick={() => setOrder(order === 'asc' ? 'desc' : 'asc')}
              title={order === 'asc' ? '升序（点击切降序）' : '降序（点击切升序）'}
              className="border border-slate-300 rounded px-2 py-1.5 hover:bg-slate-50">
              {order === 'asc' ? '升序' : '降序'}
            </button>
          </div>
          <button onClick={batchDelete} disabled={selected.size === 0}
            title="删除勾选的任务"
            className="flex items-center gap-1 border border-red-500 text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded text-sm">
            <Trash2 className="w-4 h-4" /> 批量删除{selected.size > 0 ? `（${selected.size}）` : ''}
          </button>
          <button onClick={exportSelected} disabled={selected.size === 0}
            title="导出勾选的任务为一个 .ics 文件（含到点提醒）"
            className="flex items-center gap-1 border border-emerald-500 text-emerald-600 hover:bg-emerald-50 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded text-sm">
            <FileDown className="w-4 h-4" /> 导出日历{selected.size > 0 ? `（${selected.size}）` : ''}
          </button>
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 bg-amber-500 text-white px-3 py-1.5 rounded text-sm">
            <Plus className="w-4 h-4" /> 新建任务
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-400 mb-3">
        行首勾选框用于批量操作（导出日历 / 批量删除），行末图标为完成状态标记，两者互不影响。
        导出日历下载 .ics 文件，双击导入本机日历（含到点提醒）；行末下载图标可导出单个任务。
      </p>
      {tip && <div className="mb-3 text-xs text-green-600 bg-green-50 border border-green-200 rounded px-3 py-2">{tip}</div>}
      {showForm && (
        <div className="bg-white rounded shadow p-4 mb-4 space-y-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="任务标题"
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="border border-slate-300 rounded px-3 py-2 text-sm" />
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className="border border-slate-300 rounded px-3 py-2 text-sm">
              <option value="high">高</option><option value="medium">中</option><option value="low">低</option>
            </select>
            <button onClick={create} className="bg-amber-500 text-white px-4 py-2 rounded text-sm">创建</button>
          </div>
        </div>
      )}
      {tasks.length > 0 && (
        <div className="flex items-center gap-2 mb-2 text-xs text-slate-500">
          <button onClick={toggleAll} className="flex items-center gap-1 hover:text-amber-600">
            {allSelected
              ? <SquareCheck className="w-4 h-4 text-emerald-500" />
              : <Square className="w-4 h-4" />}
            {allSelected ? '取消全选' : '全选'}
          </button>
          <span className="text-slate-400">|</span>
          <span>已选 {selected.size} 个</span>
        </div>
      )}
      <div className="space-y-2">
        {tasks.map((t) => {
          const isSel = selected.has(t.id);
          return (
            <div key={t.id} className={`bg-white rounded shadow p-3 flex items-center gap-3 ${isSel ? 'ring-1 ring-emerald-300' : ''}`}>
              {/* 行首：多选勾选框（导出日历 / 批量删除用） */}
              <button onClick={() => toggleSelect(t.id)}
                title={isSel ? '取消选中' : '选中以批量操作'}
                className={`shrink-0 ${isSel ? 'text-emerald-500' : 'text-slate-300 hover:text-emerald-500'}`}>
                {isSel ? <SquareCheck className="w-4 h-4" /> : <Square className="w-4 h-4" />}
              </button>
              <div className="flex-1 min-w-0">
                <span className={t.status === 'done' ? 'line-through text-slate-400' : ''}>{t.title}</span>
                <span className={`ml-2 text-xs ${pColor(t.priority)}`}>{t.priority === 'high' ? '高' : t.priority === 'medium' ? '中' : '低'}</span>
                {t.due_date && <span className="ml-2 text-xs text-slate-400">截止 {fmtTaskDue(t.due_date)}</span>}
                {!t.due_date && <span className="ml-2 text-xs text-slate-300">未设截止</span>}
              </div>
              {/* 行末：完成状态图标（icon，非 radio） */}
              <button onClick={() => updateStatus(t.id, t.status === 'done' ? 'todo' : 'done')}
                title="切换完成状态"
                className={`shrink-0 ${t.status === 'done' ? 'text-green-500 hover:text-green-600' : 'text-slate-300 hover:text-green-500'}`}>
                {t.status === 'done' ? <CircleCheck className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
              </button>
              {/* 单条下载 */}
              <button onClick={() => exportOne(t)}
                title="导出该任务为 .ics"
                className="text-slate-400 hover:text-emerald-600 shrink-0">
                <FileDown className="w-4 h-4" />
              </button>
              <button onClick={() => del(t.id)} className="text-red-400 hover:text-red-600 shrink-0"><Trash2 className="w-4 h-4" /></button>
            </div>
          );
        })}
        {tasks.length === 0 && <div className="text-center text-slate-400 py-8">暂无任务</div>}
      </div>
    </div>
  );
}
