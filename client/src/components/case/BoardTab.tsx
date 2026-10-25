import { useEffect, useState, useRef } from 'react';
import { Plus, Trash2, Pencil, X, Check, GripVertical, ChevronLeft, ChevronRight, Circle, CircleCheck, Clock, AlertTriangle, HelpCircle, Search } from 'lucide-react';
import { api } from '../../api';
import AssigneeSelect, { isTaskOverdue } from './AssigneeSelect';

const INPUT = 'border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400';

const STATUS_BADGE: Record<string, { text: string; cls: string }> = {
  todo: { text: '待处理', cls: 'bg-slate-100 text-slate-500' },
  doing: { text: '进行中', cls: 'bg-blue-100 text-blue-700' },
  done: { text: '已完成', cls: 'bg-green-100 text-green-700' },
  expired: { text: '已过期', cls: 'bg-red-100 text-red-600' },
};
const PRIORITY_BAR: Record<string, string> = { high: 'bg-red-400', medium: 'bg-amber-400', low: 'bg-slate-300' };

function fmtDue(v?: string) {
  if (!v) return '';
  return v.includes('T') ? v.replace('T', ' ').slice(0, 16) : v;
}

export default function BoardTab({ caseId, onOpenTask }: { caseId: string; onOpenTask?: (taskId: number) => void }) {
  const [stages, setStages] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // 表单/编辑状态
  const [editingStage, setEditingStage] = useState<number | null>(null);
  const [stageName, setStageName] = useState('');
  const [newStageName, setNewStageName] = useState('');
  const [showAddStage, setShowAddStage] = useState(false);
  const [addingTask, setAddingTask] = useState<number | null | 'unassigned'>(null);
  // 新建任务内联表单（仅标题、优先级、处理人；其余字段在任务详情中补充）
  const [fTitle, setFTitle] = useState('');
  const [fPriority, setFPriority] = useState('medium');
  const [fAssignees, setFAssignees] = useState<number[]>([]);
  // 任务内容搜索（标题 / 描述）
  const [kw, setKw] = useState('');
  // 筛选：负责人 / 状态 / 是否过期 / 截止时间范围
  const [filterAssignee, setFilterAssignee] = useState<number | ''>('');
  const [filterStatus, setFilterStatus] = useState<'' | 'todo' | 'doing' | 'done' | 'expired'>('');
  const [filterOverdue, setFilterOverdue] = useState<'' | 'overdue' | 'not_overdue'>('');
  const [filterTime, setFilterTime] = useState<'' | 'today' | '3d' | 'week' | 'month' | 'none'>('');

  // 拖拽状态：拖什么、悬停在哪、落点在哪
  const [dragTaskId, setDragTaskId] = useState<number | null>(null);
  const [dragStageId, setDragStageId] = useState<number | null>(null);
  const [overStage, setOverStage] = useState<number | 'unassigned' | null>(null);
  const [overIndex, setOverIndex] = useState(0);
  const [overBeforeStage, setOverBeforeStage] = useState<number | 'end' | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 横向滚动按钮可用状态
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateArrows = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };
  const scrollBoard = (dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });
  };

  // 悬停阶段标题时滚轮横向滚动，离开标题恢复纵向滚动
  // （React 的 onWheel 是 passive 监听，无法 preventDefault，故用原生监听）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.target as HTMLElement).closest('[data-stage-header]')) return;
      const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (d === 0) return;
      e.preventDefault();
      el.scrollLeft += d;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateArrows, { passive: true });
    window.addEventListener('resize', updateArrows);
    updateArrows();
    return () => {
      el.removeEventListener('scroll', updateArrows);
      window.removeEventListener('resize', updateArrows);
    };
  }, [stages, tasks]);

  const load = async () => {
    setLoading(true);
    try {
      const [sd, td, ud] = await Promise.all([
        api(`/cases/${caseId}/stages`),
        api(`/cases/${caseId}/tasks?board=1&include_expired=1`),
        api('/users/assignable').catch(() => ({ users: [] })),
      ]);
      setStages(sd.stages || []);
      setTasks(td.tasks || []);
      setUsers(ud.users || []);
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [caseId]);

  const draggingAny = dragTaskId != null || dragStageId != null;

  // 搜索 + 筛选只影响展示，不影响拖拽排序所用的完整 tasks 数据
  const kwTrim = kw.trim();
  const hasFilter = filterAssignee !== '' || filterStatus !== '' || filterOverdue !== '' || filterTime !== '';
  // 时间范围：返回 [下限, 上限]（含当天零点），'none' 单独处理
  const timeRange = (() => {
    if (!filterTime || filterTime === 'none') return null;
    const d = new Date();
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end = new Date(dayStart);
    if (filterTime === 'today') end.setDate(end.getDate() + 1);
    else if (filterTime === '3d') end.setDate(end.getDate() + 3);
    else if (filterTime === 'week') end.setDate(end.getDate() + (7 - ((d.getDay() + 6) % 7)) + 1); // 至下周一
    else end.setMonth(end.getMonth() + 1, 1); // 至下月一号
    return [dayStart, end] as const;
  })();
  const visibleTasks = tasks.filter((t) => {
    if (kwTrim && !t.title.includes(kwTrim) && !(t.description || '').includes(kwTrim)) return false;
    if (filterAssignee !== '' && !(t.assignees || []).some((a: any) => a.id === filterAssignee)) return false;
    if (filterStatus !== '' && t.status !== filterStatus) return false;
    if (filterOverdue === 'overdue' && !isTaskOverdue(t.status, t.due_date)) return false;
    if (filterOverdue === 'not_overdue' && isTaskOverdue(t.status, t.due_date)) return false;
    if (filterTime === 'none' && t.due_date) return false;
    if (timeRange) {
      if (!t.due_date) return false;
      const due = new Date(t.due_date.replace(' ', 'T'));
      if (isNaN(due.getTime())) return false;
      if (due < timeRange[0] || due >= timeRange[1]) return false;
    }
    return true;
  });
  const clearFilters = () => { setFilterAssignee(''); setFilterStatus(''); setFilterOverdue(''); setFilterTime(''); };

  // 标题中高亮第一处搜索匹配
  const highlight = (text: string) => {
    if (!kwTrim) return text;
    const idx = text.indexOf(kwTrim);
    if (idx < 0) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-amber-200 text-amber-900 rounded px-0">{text.slice(idx, idx + kwTrim.length)}</mark>
        {text.slice(idx + kwTrim.length)}
      </>
    );
  };

  // ---------- 阶段 CRUD ----------
  const addStage = async () => {
    if (!newStageName.trim()) return;
    await api(`/cases/${caseId}/stages`, { method: 'POST', body: JSON.stringify({ name: newStageName }) });
    setNewStageName(''); setShowAddStage(false); load();
  };
  const renameStage = async (sid: number) => {
    if (!stageName.trim()) return;
    await api(`/stages/${sid}`, { method: 'PUT', body: JSON.stringify({ name: stageName }) });
    setEditingStage(null); load();
  };
  const delStage = async (sid: number, name: string) => {
    if (!confirm(`确认删除阶段「${name}」？该阶段下的任务将变为未分配。`)) return;
    await api(`/stages/${sid}`, { method: 'DELETE' }); load();
  };

  // ---------- 任务 CRUD ----------
  const openAddForm = (sid: number | null) => {
    setAddingTask(sid == null ? 'unassigned' : sid);
    setFTitle(''); setFPriority('medium'); setFAssignees([]);
  };
  const addTask = async (sid: number | null) => {
    if (!fTitle.trim()) return;
    const assigneeIds = fAssignees.length ? fAssignees : undefined;
    const d = await api(`/cases/${caseId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({
        title: fTitle.trim(), priority: fPriority,
        stage_id: sid, assignee_ids: assigneeIds,
      }),
    });
    setAddingTask(null);
    await load();
    // 新建后直接打开任务二级页，便于补充详情
    if (d?.id) onOpenTask?.(d.id);
  };
  const toggleDone = async (e: React.MouseEvent, t: any) => {
    e.stopPropagation();
    await api(`/tasks/${t.id}`, { method: 'PUT', body: JSON.stringify({ status: t.status === 'done' ? 'todo' : 'done' }) });
    load();
  };
  const delTask = async (e: React.MouseEvent, t: any) => {
    e.stopPropagation();
    if (!confirm(`确认删除任务「${t.title}」？`)) return;
    await api(`/tasks/${t.id}`, { method: 'DELETE' }); load();
  };

  // ---------- 卡片拖拽 ----------
  const globalOrder = (a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0);

  const doTaskDrop = (targetStage: number | null, targetIdx: number) => {
    const tid = dragTaskId;
    if (tid == null) return;
    const dragged = tasks.find(n => n.id === tid);
    if (!dragged) return;

    // 按容器顺序重建全局排序：各阶段列（含未分配），目标容器在 targetIdx 插入被拖卡片
    const others = tasks.filter(n => n.id !== tid).sort(globalOrder);
    const containers: { sid: number | null; list: any[] }[] = [
      ...stages.map(s => ({ sid: s.id as number | null, list: others.filter(n => n.stage_id === s.id) })),
      { sid: null, list: others.filter(n => !n.stage_id) },
    ];
    const items: { id: number; stage_id: number | null }[] = [];
    for (const c of containers) {
      const list = [...c.list];
      if ((c.sid ?? 'unassigned') === (targetStage ?? 'unassigned')) {
        const orig = tasks.find(n => n.id === tid);
        const moving = orig && orig.stage_id !== targetStage; // 跨列移动才允许任意落点
        const idx = moving ? targetIdx : Math.min(targetIdx, list.length);
        list.splice(idx, 0, dragged);
      }
      for (const n of list) items.push({ id: n.id, stage_id: c.sid });
    }

    // 乐观更新
    const orderMap = new Map(items.map((it, i) => [it.id, i]));
    const stageMap = new Map(items.map(it => [it.id, it.stage_id]));
    setTasks(prev => prev.map(n => ({ ...n, sort_order: orderMap.get(n.id) ?? n.sort_order, stage_id: stageMap.get(n.id) ?? n.stage_id })));
    api(`/cases/${caseId}/tasks/reorder`, { method: 'PUT', body: JSON.stringify({ items }) })
      .catch(() => load());
    setDragTaskId(null); setOverStage(null); setOverIndex(0);
  };

  const computeInsertIndex = (e: React.DragEvent, colTasks: any[]) => {
    let idx = 0;
    for (const n of colTasks) {
      const el = document.getElementById(`task-${n.id}`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (e.clientY > r.top + r.height / 2) idx++;
    }
    return idx;
  };

  const onTaskDragStart = (e: React.DragEvent, tid: number) => {
    setDragTaskId(tid);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(tid));
  };
  const onColumnDragOver = (e: React.DragEvent, sid: number | null, colTasks: any[]) => {
    if (dragTaskId == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOverStage(sid ?? 'unassigned');
    setOverIndex(computeInsertIndex(e, colTasks.filter(n => n.id !== dragTaskId)));
  };
  const onColumnDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setOverStage(prev => prev);
    }
  };
  const onDragEnd = () => {
    setDragTaskId(null); setDragStageId(null); setOverStage(null); setOverIndex(0); setOverBeforeStage(null);
  };

  // ---------- 阶段列拖拽（手柄触发） ----------
  const stageHeaderRef = useRef<Record<number, HTMLDivElement | null>>({});
  const onStageHandleDown = (sid: number) => {
    const el = stageHeaderRef.current[sid];
    if (el) { el.draggable = true; }
  };
  const onStageDragStart = (e: React.DragEvent, sid: number) => {
    setDragStageId(sid);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `stage:${sid}`);
  };
  const onStageAreaDragOver = (e: React.DragEvent, sid: number) => {
    if (dragStageId == null) return;
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const before = e.clientX < r.left + r.width / 2;
    // 确定插入位置：本列之前 / 下一列之前 / 末尾
    const idx = stages.findIndex(s => s.id === sid);
    const next = stages[idx + 1];
    setOverBeforeStage(before ? sid : (next ? next.id : 'end'));
  };
  const doStageDrop = () => {
    if (dragStageId == null || overBeforeStage == null) return;
    const ids = stages.map(s => s.id);
    const fromIdx = ids.indexOf(dragStageId);
    ids.splice(fromIdx, 1);
    if (overBeforeStage === 'end') {
      ids.push(dragStageId);
    } else {
      const toIdx = ids.indexOf(overBeforeStage);
      ids.splice(toIdx, 0, dragStageId);
    }
    const same = ids.every((id, i) => id === stages[i].id);
    if (!same) {
      setStages(ids.map(id => stages.find(s => s.id === id)!).filter(Boolean));
      api(`/cases/${caseId}/stages/reorder`, { method: 'PUT', body: JSON.stringify({ order: ids }) })
        .catch(() => load());
    }
    onDragEnd();
  };

  // 拖拽时横向自动滚动
  const onBoardDragOver = (e: React.DragEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (e.clientX < r.left + 70) el.scrollLeft -= 14;
    else if (e.clientX > r.right - 70) el.scrollLeft += 14;
  };

  const renderPlaceholder = () => (
    <div className="h-16 rounded border-2 border-dashed border-amber-400 bg-amber-50/70 animate-pulse flex items-center justify-center text-xs text-amber-500">
      松开移动到此处
    </div>
  );

  const assigneeText = (t: any) => {
    const list: any[] = t.assignees || [];
    if (list.length === 0) return '未指派';
    if (list.length === 1) return list[0].name;
    return `${list[0].name} 等${list.length}人`;
  };

  const renderTaskCard = (t: any) => {
    const isDragging = dragTaskId === t.id;
    const done = t.status === 'done';
    const overdue = isTaskOverdue(t.status, t.due_date);
    const badge = STATUS_BADGE[t.status] || STATUS_BADGE.todo;
    return (
      <div key={t.id} id={`task-${t.id}`}
        draggable
        onDragStart={(e) => onTaskDragStart(e, t.id)}
        onDragEnd={onDragEnd}
        onClick={() => onOpenTask?.(t.id)}
        className={`relative bg-white rounded shadow-sm pl-3 pr-2.5 py-2 text-sm cursor-pointer hover:shadow-md group transition-all overflow-hidden
          ${isDragging ? 'opacity-30 scale-95 rotate-1' : 'hover:-translate-y-0.5'}`}>
        <span className={`absolute left-0 top-0 bottom-0 w-1 ${PRIORITY_BAR[t.priority] || PRIORITY_BAR.medium}`} />
        <div className={`break-words pr-1 ${done ? 'line-through text-slate-400' : ''}`}>{highlight(t.title)}</div>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          {overdue && t.status !== 'expired' ? (
            <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-px rounded-full bg-red-100 text-red-600 font-medium">
              <AlertTriangle className="w-2.5 h-2.5" />已过期
            </span>
          ) : (
            <span className={`text-[10px] px-1.5 py-px rounded-full ${badge.cls}`}>{badge.text}</span>
          )}
          {t.due_date && (
            <span className={`flex items-center gap-0.5 text-[11px] ${overdue ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
              <Clock className="w-3 h-3" />{fmtDue(t.due_date)}
            </span>
          )}
        </div>
        <div className={`flex justify-between items-center mt-1 pt-1 border-t border-slate-100 transition ${isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          <span className="text-[11px] text-slate-400 truncate">{assigneeText(t)}</span>
          <span className="flex items-center gap-1 shrink-0">
            <button onClick={(e) => toggleDone(e, t)} title={done ? '标记为未完成' : '标记完成'}
              className={done ? 'text-green-500 hover:text-green-600' : 'text-slate-300 hover:text-green-500'}>
              {done ? <CircleCheck className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
            </button>
            <button onClick={(e) => delTask(e, t)} className="text-slate-400 hover:text-red-600">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </span>
        </div>
      </div>
    );
  };

  const renderColumnBody = (sid: number | null) => {
    const key = sid == null ? 'unassigned' : sid;
    const colTasks = visibleTasks.filter(n => (sid == null ? !n.stage_id : n.stage_id === sid)).sort(globalOrder);
    const isOver = overStage === key && dragTaskId != null;
    const display: any[] = [];
    const insertAt = isOver ? Math.min(overIndex, colTasks.length) : -1;
    colTasks.forEach((n, i) => {
      if (i === insertAt) display.push({ ph: true, key: `ph-${key}` });
      display.push(n);
    });
    if (isOver && (insertAt >= colTasks.length || colTasks.length === 0)) display.push({ ph: true, key: `ph-${key}` });

    return (
      <div
        onDragOver={(e) => onColumnDragOver(e, sid, colTasks)}
        onDragLeave={onColumnDragLeave}
        onDrop={(e) => { e.preventDefault(); doTaskDrop(sid, overIndex); }}
        className={`p-2 space-y-2 flex-1 overflow-y-auto min-h-[70px] transition-colors rounded-b
          ${isOver ? 'bg-amber-50/60 ring-1 ring-inset ring-amber-200' : ''}`}>
        {display.map((it: any) =>
          it.ph ? <div key={it.key}>{renderPlaceholder()}</div> : renderTaskCard(it)
        )}
        {(kwTrim || hasFilter) && colTasks.length === 0 && addingTask !== key && (
          <p className="text-center text-[11px] text-slate-300 py-3 select-none">无匹配任务</p>
        )}
        {addingTask === key ? (
          <div className="bg-white rounded shadow-sm p-2.5 ring-1 ring-amber-300" onClick={(e) => e.stopPropagation()}>
            <input value={fTitle} onChange={(e) => setFTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addTask(sid); }}
              placeholder="任务标题" className={`${INPUT} w-full mb-2`} autoFocus />
            <div className="flex gap-2 mb-2">
              <select value={fPriority} onChange={(e) => setFPriority(e.target.value)}
                className={`${INPUT} flex-1 text-xs`}>
                <option value="high">优先级：高</option>
                <option value="medium">优先级：中</option>
                <option value="low">优先级：低</option>
              </select>
            </div>
            <AssigneeSelect users={users} value={fAssignees} onChange={setFAssignees}
              placeholder="处理人（不选默认自己）" />
            <div className="flex gap-1 justify-end items-center mt-2">
              <span className="text-[11px] text-slate-400 mr-auto">Enter 创建 · 时间等详情可在创建后补充</span>
              <button onClick={() => addTask(sid)} className="bg-amber-500 text-white px-2 py-1 rounded text-xs">添加</button>
              <button onClick={() => setAddingTask(null)} className="text-slate-400 px-2 py-1"><X className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ) : (
          <button onClick={(e) => { e.stopPropagation(); openAddForm(sid); }}
            className="w-full text-xs text-slate-400 hover:text-amber-600 hover:bg-white rounded py-1.5 flex items-center justify-center gap-1 transition">
            <Plus className="w-3.5 h-3.5" /> 添加任务
          </button>
        )}
      </div>
    );
  };

  if (loading) return <div className="p-8 text-slate-400">加载中...</div>;

  return (
    <div className="flex flex-col h-[calc(100vh_-_14rem)]">
      <div className="flex items-center gap-2.5 mb-3">
        {/* 操作帮助：hover / 聚焦显示分点说明 */}
        <div className="relative group shrink-0">
          <HelpCircle tabIndex={0}
            className="w-[18px] h-[18px] text-slate-400 hover:text-amber-600 cursor-help outline-none" />
          <div className="absolute left-0 top-6 z-40 w-72 hidden group-hover:block group-focus-within:block bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-xs text-slate-600">
            <p className="font-medium text-slate-800 mb-2">看板操作说明</p>
            <ul className="space-y-2">
              <li className="flex items-start gap-2">
                <GripVertical className="w-3.5 h-3.5 mt-0.5 text-amber-500 shrink-0" />
                拖动阶段标题栏的手柄，可左右调整阶段顺序
              </li>
              <li className="flex items-start gap-2">
                <span className="w-3.5 h-3.5 mt-0.5 shrink-0 rounded-sm border border-slate-300" />
                直接拖拽任务卡片，可在各阶段之间移动任务
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-3.5 h-3.5 mt-0.5 text-emerald-500 shrink-0" />
                点击任务卡片，可查看与编辑任务详情
              </li>
            </ul>
          </div>
        </div>

        {/* 任务内容搜索 */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input value={kw} onChange={(e) => setKw(e.target.value)}
            placeholder="搜索任务标题或描述"
            className="w-60 border border-slate-300 rounded py-1.5 pl-8 pr-7 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400" />
          {kwTrim && (
            <button onClick={() => setKw('')} title="清除搜索"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {/* 筛选：负责人 / 状态 / 是否过期 */}
        <div className="flex items-center gap-1.5 shrink-0">
          <select value={filterAssignee}
            onChange={(e) => setFilterAssignee(e.target.value ? Number(e.target.value) : '')}
            title="按负责人筛选"
            className={`border rounded px-1.5 py-1.5 text-xs focus:outline-none focus:border-amber-400 ${filterAssignee !== '' ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-slate-300 text-slate-600'}`}>
            <option value="">全部负责人</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            title="按状态筛选"
            className={`border rounded px-1.5 py-1.5 text-xs focus:outline-none focus:border-amber-400 ${filterStatus !== '' ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-slate-300 text-slate-600'}`}>
            <option value="">全部状态</option>
            <option value="todo">待处理</option>
            <option value="doing">进行中</option>
            <option value="done">已完成</option>
            <option value="expired">已过期</option>
          </select>
          <select value={filterOverdue}
            onChange={(e) => setFilterOverdue(e.target.value as any)}
            title="按是否过期筛选"
            className={`border rounded px-1.5 py-1.5 text-xs focus:outline-none focus:border-amber-400 ${filterOverdue !== '' ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-slate-300 text-slate-600'}`}>
            <option value="">全部期限</option>
            <option value="overdue">已过期</option>
            <option value="not_overdue">未过期</option>
          </select>
          <select value={filterTime}
            onChange={(e) => setFilterTime(e.target.value as any)}
            title="按截止时间筛选"
            className={`border rounded px-1.5 py-1.5 text-xs focus:outline-none focus:border-amber-400 ${filterTime !== '' ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-slate-300 text-slate-600'}`}>
            <option value="">全部时间</option>
            <option value="today">今天到期</option>
            <option value="3d">3 天内到期</option>
            <option value="week">本周到期</option>
            <option value="month">本月到期</option>
            <option value="none">无截止时间</option>
          </select>
          {hasFilter && (
            <button onClick={clearFilters} title="清除全部筛选"
              className="text-slate-400 hover:text-slate-600 p-1">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {(kwTrim || hasFilter) && (
          <span className="text-xs text-slate-400 shrink-0">{visibleTasks.length} 个匹配任务</span>
        )}

        <button onClick={() => setShowAddStage(s => !s)}
          className="ml-auto flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded text-sm shrink-0">
          <Plus className="w-4 h-4" /> 新增阶段
        </button>
      </div>

      {showAddStage && (
        <div className="flex gap-2 mb-3">
          <input value={newStageName} onChange={(e) => setNewStageName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addStage()}
            placeholder="阶段名称，如：一审审理" className={`${INPUT} flex-1 max-w-xs`} autoFocus />
          <button onClick={addStage} className="bg-slate-700 text-white px-3 py-1 rounded text-sm">添加</button>
          <button onClick={() => { setShowAddStage(false); setNewStageName(''); }} className="text-slate-400 px-2"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="relative flex-1 min-h-0">
        {canLeft && (
          <button onClick={() => scrollBoard(-1)} title="向左滚动"
            className="absolute left-1.5 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/95 shadow-md border border-slate-200 flex items-center justify-center text-slate-500 hover:text-amber-600 hover:shadow-lg transition">
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        {canRight && (
          <button onClick={() => scrollBoard(1)} title="向右滚动"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/95 shadow-md border border-slate-200 flex items-center justify-center text-slate-500 hover:text-amber-600 hover:shadow-lg transition">
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
        <div ref={scrollRef} onDragOver={onBoardDragOver} onDrop={(e) => { if (dragStageId != null) { e.preventDefault(); doStageDrop(); } }}
          className={`flex gap-2.5 overflow-x-auto pb-3 h-full ${draggingAny ? 'select-none' : ''}`}>

        {stages.map((s) => {
          const isDragged = dragStageId === s.id;
          const showBar = dragStageId != null && overBeforeStage === s.id;
          const sTasks = visibleTasks.filter(n => n.stage_id === s.id);
          return (
            <div key={s.id} className="flex items-stretch shrink-0">
              {showBar && <div className="w-1 rounded-full bg-amber-400 mr-1 animate-pulse" />}
              <div
                onDragOver={(e) => onStageAreaDragOver(e, s.id)}
                onDrop={(e) => { if (dragStageId != null) { e.preventDefault(); doStageDrop(); } }}
                className={`bg-slate-100 rounded w-72 flex flex-col transition-opacity
                  ${isDragged ? 'opacity-40 scale-[0.98]' : ''}`}>
                <div data-stage-header ref={(el) => { stageHeaderRef.current[s.id] = el; }}
                  draggable={dragStageId === s.id}
                  onDragStart={(e) => onStageDragStart(e, s.id)}
                  onDragEnd={onDragEnd}
                  className="p-2.5 pl-2 border-b border-slate-200 flex items-center gap-1.5">
                  <span onMouseDown={() => onStageHandleDown(s.id)} onMouseUp={(e) => { (e.currentTarget.parentElement as HTMLDivElement).draggable = false; }}
                    title="拖动调整阶段顺序"
                    className="text-slate-300 hover:text-amber-500 cursor-grab active:cursor-grabbing p-0.5">
                    <GripVertical className="w-4 h-4" />
                  </span>
                  {editingStage === s.id ? (
                    <>
                      <input value={stageName} onChange={(e) => setStageName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && renameStage(s.id)}
                        className={`${INPUT} flex-1`} autoFocus />
                      <button onClick={() => renameStage(s.id)} className="text-green-600"><Check className="w-4 h-4" /></button>
                      <button onClick={() => setEditingStage(null)} className="text-slate-400"><X className="w-4 h-4" /></button>
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-sm flex-1 truncate select-none">{s.name}</span>
                      <span className={`text-xs rounded-full px-2 py-0.5 transition ${overStage === s.id && dragTaskId != null ? 'bg-amber-200 text-amber-700' : 'text-slate-400 bg-slate-200'}`}>{sTasks.length}</span>
                      <button onClick={(e) => { e.stopPropagation(); setEditingStage(s.id); setStageName(s.name); }} className="text-slate-400 hover:text-amber-600"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={(e) => { e.stopPropagation(); delStage(s.id, s.name); }} className="text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                    </>
                  )}
                </div>
                {renderColumnBody(s.id)}
              </div>
            </div>
          );
        })}

        {dragStageId != null && overBeforeStage === 'end' && <div className="w-1 rounded-full bg-amber-400 animate-pulse" />}

        {/* 未分配列 */}
        <div onDragOver={(e) => { if (dragTaskId != null) { e.preventDefault(); setOverStage('unassigned'); } }}
          onDrop={(e) => { if (dragTaskId != null) { e.preventDefault(); doTaskDrop(null, overStage === 'unassigned' ? overIndex : 0); } }}
          className={`bg-slate-50 border-2 border-dashed rounded w-72 shrink-0 flex flex-col transition-colors
            ${overStage === 'unassigned' && dragTaskId != null ? 'border-amber-400 bg-amber-50/60' : 'border-slate-300'}`}>
          <div data-stage-header className="p-2.5 border-b border-slate-200 text-sm text-slate-500 select-none">未分配</div>
          {renderColumnBody(null)}
        </div>
        </div>
      </div>
    </div>
  );
}
