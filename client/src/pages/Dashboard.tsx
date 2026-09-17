import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Pin, PinOff, Plus, Search, CalendarDays, List, ChevronLeft, ChevronRight,
  Check, MessageSquare, Briefcase, Clock, Scale, ChevronRight as Arrow, X, FileDown,
} from 'lucide-react';
import { api } from '../api';
import { typeLabel, statusLabel } from '../constants';
import NewCaseModal from '../components/NewCaseModal';

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [me, setMe] = useState<any>(null);
  const [kw, setKw] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showTodo, setShowTodo] = useState(false);
  const [todoView, setTodoView] = useState<'list' | 'calendar'>('list');
  const [err, setErr] = useState('');
  const navigate = useNavigate();

  const load = () => api('/dashboard').then(setData).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    api('/auth/me').then((r) => setMe(r.user)).catch(() => {});
  }, []);

  if (err) return <div className="p-8 text-red-500">{err}</div>;
  if (!data) return <div className="p-8">加载中...</div>;

  const allCases: any[] = data.myCases || [];
  const keyword = kw.trim().toLowerCase();
  const matched = keyword
    ? allCases.filter((c) => c.name?.toLowerCase().includes(keyword) || c.case_no?.toLowerCase().includes(keyword))
    : allCases;
  const pinned = matched.filter((c: any) => c.pinned);
  const recent = allCases
    .filter((c: any) => c.last_opened_at && !c.pinned)
    .sort((a: any, b: any) => (a.last_opened_at < b.last_opened_at ? 1 : -1))
    .slice(0, 6);

  const togglePin = async (c: any) => {
    try {
      await api(`/cases/${c.id}/pin`, { method: 'POST', body: JSON.stringify({ pinned: !c.pinned }) });
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const searchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(kw.trim() ? `/cases?kw=${encodeURIComponent(kw.trim())}` : '/cases');
  };

  return (
    <div className="p-8">
      {/* 顶部：标题 + 搜索 + 新建 */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <h1 className="text-2xl font-bold">概览看板</h1>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <form onSubmit={searchSubmit} className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜索案件名称 / 编号"
              className="border border-slate-300 rounded pl-8 pr-3 py-2 text-sm w-56 focus:outline-none focus:border-amber-500" />
          </form>
          <button onClick={() => setShowNew(true)}
            className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 rounded text-sm">
            <Plus className="w-4 h-4" /> 新建案件
          </button>
        </div>
      </div>

      {/* 第一行：我的待办 + 最新评论动态 */}
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 bg-white rounded shadow p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-slate-700 flex items-center gap-2">
              我的待办
              <Link to="/todos" className="text-xs font-normal text-amber-600 hover:underline flex items-center gap-0.5">
                查看全部待办 <Arrow className="w-3 h-3" />
              </Link>
            </h3>
            <div className="flex items-center gap-2">
              <div className="flex border border-slate-200 rounded overflow-hidden text-xs">
                <button onClick={() => setTodoView('list')}
                  className={`flex items-center gap-1 px-2 py-1 ${todoView === 'list' ? 'bg-amber-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                  <List className="w-3.5 h-3.5" /> 列表
                </button>
                <button onClick={() => setTodoView('calendar')}
                  className={`flex items-center gap-1 px-2 py-1 ${todoView === 'calendar' ? 'bg-amber-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                  <CalendarDays className="w-3.5 h-3.5" /> 日历
                </button>
              </div>
              <button onClick={() => setShowTodo(true)}
                className="flex items-center gap-1 text-xs text-amber-600 hover:underline">
                <Plus className="w-3.5 h-3.5" /> 新增待办
              </button>
            </div>
          </div>
          {todoView === 'list'
            ? <TodoList tasks={data.myTasks} onChanged={load} />
            : <TodoCalendar tasks={data.myTasks} onChanged={load} />}
        </div>

        <div className="bg-white rounded shadow p-4 flex flex-col min-h-0">
          <h3 className="font-bold mb-3 text-slate-700 flex items-center gap-1">
            <MessageSquare className="w-4 h-4 text-slate-400" /> 最新评论动态
          </h3>
          <div className="space-y-1 overflow-y-auto -mr-2 pr-2" style={{ maxHeight: '460px' }}>
            {data.recentComments.length === 0 && <Empty />}
            {data.recentComments.map((c: any) => (
              <Link key={c.id} to={`/cases/${c.case_id}`}
                className="block py-2 px-2 rounded hover:bg-amber-50 border-b border-slate-50 last:border-0 group">
                <div className="text-sm text-slate-700 line-clamp-2">{c.content}</div>
                <div className="text-xs text-slate-400 mt-0.5 flex items-center justify-between">
                  <span>{c.author_name} · {c.case_name}</span>
                  <Arrow className="w-3 h-3 opacity-0 group-hover:opacity-100 text-amber-500" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* 第二行：置顶案件 */}
      {pinned.length > 0 && (
        <div className="mt-6">
          <p className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-1">
            <Pin className="w-3.5 h-3.5 text-amber-500" /> 置顶案件
          </p>
          <div className="bg-white rounded shadow overflow-hidden">
            {pinned.map((c: any) => (
              <CaseRow key={c.id} c={c} pinned onTogglePin={togglePin} />
            ))}
          </div>
        </div>
      )}

      {/* 第三行：近期打开 + 查看全部案件 */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-bold text-slate-700 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-slate-400" /> 近期打开
          </p>
          <Link to={keyword ? `/cases?kw=${encodeURIComponent(keyword)}` : '/cases'}
            className="flex items-center gap-1 text-sm text-amber-600 hover:underline">
            <Briefcase className="w-3.5 h-3.5" /> 查看全部案件 <Arrow className="w-3.5 h-3.5" />
          </Link>
        </div>
        {recent.length > 0 ? (
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
            {recent.map((c: any) => (
              <Link key={c.id} to={`/cases/${c.id}`}
                className="bg-white rounded shadow px-4 py-3 hover:shadow-md transition-shadow">
                <div className="font-medium truncate" title={c.name}>{c.name}</div>
                <div className="text-xs text-slate-400 mt-0.5">{c.case_no}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {typeLabel(c.type)} · {statusLabel(c.status)} · 打开 {c.last_opened_at.slice(0, 10)}
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded shadow p-6 text-center text-slate-400 text-sm">
            暂无近期打开的案件，<Link to="/cases" className="text-amber-600 hover:underline">前往全部案件</Link>
          </div>
        )}
      </div>

      {showNew && <NewCaseModal onClose={() => { setShowNew(false); load(); }} />}
      {showTodo && me && (
        <NewTodoModal cases={allCases} me={me} onClose={() => setShowTodo(false)} onCreated={() => { setShowTodo(false); load(); }} />
      )}
    </div>
  );
}

function CaseRow({ c, pinned, onTogglePin }: any) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b last:border-0 hover:bg-slate-50 group">
      <Link to={`/cases/${c.id}`} className="flex items-center gap-3 min-w-0 flex-1">
        <Scale className="w-4 h-4 text-slate-300 shrink-0" />
        <span className="font-medium truncate">{c.name}</span>
        <span className="text-xs text-slate-400 shrink-0">{c.case_no}</span>
        <span className="text-xs text-slate-400 shrink-0 ml-auto">{typeLabel(c.type)} · {statusLabel(c.status)}</span>
      </Link>
      <button onClick={() => onTogglePin(c)} title={pinned ? '取消置顶' : '置顶'}
        className={`shrink-0 ${pinned ? 'text-amber-500' : 'text-slate-300 hover:text-amber-500 opacity-0 group-hover:opacity-100'}`}>
        {pinned ? <Pin className="w-4 h-4 fill-amber-500" /> : <PinOff className="w-4 h-4" />}
      </button>
    </div>
  );
}

function TodoList({ tasks, onChanged }: any) {
  const toggleDone = async (t: any) => {
    await api(`/tasks/${t.id}`, { method: 'PUT', body: JSON.stringify({ status: 'done' }) });
    onChanged();
  };
  // 导出 .ics：远程访问时把事件导入当前电脑日历（含到点提醒）
  const exportIcs = (t: any) => {
    if (!t.due_date) { alert('该待办没有截止时间，无法导出日历事件'); return; }
    const a = document.createElement('a');
    a.href = `/api/tasks/${t.id}/export-ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  if (tasks.length === 0) return <Empty />;
  return (
    <div>
      {tasks.map((t: any) => {
        const overdue = t.due_date && t.due_date < nowStr();
        return (
          <div key={t.id} className="py-2 border-b last:border-0 flex items-start gap-2 group">
            <button onClick={() => toggleDone(t)} title="标记完成"
              className="mt-0.5 w-4 h-4 rounded border border-slate-300 hover:border-green-500 hover:bg-green-50 shrink-0 flex items-center justify-center">
              <Check className="w-3 h-3 text-green-500 opacity-0 group-hover:opacity-100" />
            </button>
            <div className="min-w-0 flex-1">
              <div className={`font-medium text-sm flex items-center gap-1.5 ${overdue ? 'text-red-500' : ''}`}>
                {t.kind === 'hearing' && (
                  <span className="text-[10px] px-1 py-px bg-red-100 text-red-600 rounded shrink-0">开庭</span>
                )}
                <span className="truncate">{t.title}</span>
              </div>
              <div className="text-xs text-slate-500">
                {t.case_id && t.case_name
                  ? <Link to={`/cases/${t.case_id}`} className="hover:text-amber-600 hover:underline">{t.case_name}</Link>
                  : <span className="text-slate-400">个人待办</span>}
                <span> · 截止 {fmtDateTime(t.due_date) || '未设'}</span>
                {t.priority === 'high' && <span className="text-red-400 ml-1">· 高优先</span>}
              </div>
            </div>
            {t.kind !== 'hearing' && (
              <button onClick={() => exportIcs(t)} title="导出 .ics：远程访问时双击导入当前电脑日历（含到点提醒）"
                className="mt-0.5 text-slate-300 hover:text-emerald-600 opacity-0 group-hover:opacity-100 shrink-0">
                <FileDown className="w-4 h-4" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TodoCalendar({ tasks, onChanged }: any) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [selDay, setSelDay] = useState(todayStr());

  const byDay = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const t of tasks) {
      if (!t.due_date) continue;
      const key = String(t.due_date).slice(0, 10);
      (map[key] = map[key] || []).push(t);
    }
    return map;
  }, [tasks]);

  const { y, m } = cursor;
  const firstDow = (new Date(y, m, 1).getDay() + 6) % 7; // 周一为第一列
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevDaysInMonth = new Date(y, m, 0).getDate();
  // 构建 6×7 网格：前后月灰色填充（仿 macOS 日历）
  const cells: { day: number; month: 'prev' | 'cur' | 'next' }[] = [];
  for (let i = firstDow - 1; i >= 0; i--) cells.push({ day: prevDaysInMonth - i, month: 'prev' });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, month: 'cur' });
  let nextDay = 1;
  while (cells.length < 42) cells.push({ day: nextDay++, month: 'next' });

  const dateKey = (cell: { day: number; month: string }) => {
    let yy = y, mm = m;
    if (cell.month === 'prev') { mm = m - 1; if (mm < 0) { mm = 11; yy--; } }
    else if (cell.month === 'next') { mm = m + 1; if (mm > 11) { mm = 0; yy++; } }
    return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(cell.day).padStart(2, '0')}`;
  };
  const shift = (delta: number) => {
    const nm = m + delta;
    setCursor({ y: nm < 0 ? y - 1 : nm > 11 ? y + 1 : y, m: (nm + 12) % 12 });
  };
  const goToday = () => {
    setCursor({ y: now.getFullYear(), m: now.getMonth() });
    setSelDay(todayStr());
  };
  const selTasks = byDay[selDay] || [];
  const toggleDone = async (t: any) => {
    await api(`/tasks/${t.id}`, { method: 'PUT', body: JSON.stringify({ status: 'done' }) });
    onChanged();
  };
  const exportIcs = (t: any) => {
    if (!t.due_date) { alert('该待办没有截止时间，无法导出日历事件'); return; }
    const a = document.createElement('a');
    a.href = `/api/tasks/${t.id}/export-ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div>
      {/* 顶部导航：仿 macOS 日历（左右箭头 + 月份 + 今天按钮） */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-0.5">
          <button onClick={() => shift(-1)} className="p-1 text-slate-400 hover:text-red-500 rounded hover:bg-slate-100 transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={() => shift(1)} className="p-1 text-slate-400 hover:text-red-500 rounded hover:bg-slate-100 transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <span className="text-base font-semibold text-slate-800">{y} 年 {m + 1} 月</span>
        <button onClick={goToday}
          className="text-xs px-2.5 py-1 text-red-600 hover:bg-red-50 rounded-full border border-red-200 hover:border-red-300 transition-colors">
          今天
        </button>
      </div>
      {/* 周标签 */}
      <div className="grid grid-cols-7 text-center text-[11px] font-medium mb-1 pb-1.5 border-b border-slate-100">
        {['一', '二', '三', '四', '五', '六', '日'].map((d, i) => (
          <span key={d} className={i >= 5 ? 'text-red-300' : 'text-slate-400'}>{d}</span>
        ))}
      </div>
      {/* 日历网格：仿 macOS 日历月视图 */}
      <div className="grid grid-cols-7 gap-px bg-slate-100 rounded-md overflow-hidden">
        {cells.map((cell, i) => {
          const k = dateKey(cell);
          const items = byDay[k] || [];
          const isToday = k === todayStr();
          const isSel = k === selDay;
          const isOther = cell.month !== 'cur';
          const isWeekend = i % 7 >= 5;
          return (
            <button key={i} onClick={() => setSelDay(k)}
              className={`min-h-[46px] bg-white p-1 flex flex-col items-center gap-0.5 hover:bg-slate-50 transition-colors
                ${isOther ? 'bg-slate-50/70' : ''} ${isSel && !isToday ? 'bg-red-50' : ''}`}>
              {/* 日期数字：今天=红实心圆白字，选中=红圈，其他=普通 */}
              <span className={`flex items-center justify-center w-6 h-6 rounded-full text-[11px] transition-colors
                ${isToday ? 'bg-red-500 text-white font-bold' : ''}
                ${!isToday && isSel ? 'bg-red-100 text-red-600 font-semibold ring-1 ring-red-200' : ''}
                ${!isToday && !isSel ? (isOther ? 'text-slate-300' : isWeekend ? 'text-red-400' : 'text-slate-700') : ''}`}>
                {cell.day}
              </span>
              {/* 事件色块：圆点 + 截断标题，仿 mac 日历事件条 */}
              <div className="flex flex-col gap-0.5 w-full overflow-hidden">
                {items.slice(0, 2).map((t: any) => {
                  const overdue = String(t.due_date).slice(0, 10) < todayStr();
                  const dot = t.kind === 'hearing' ? 'bg-red-500' : overdue ? 'bg-red-400' : 'bg-amber-400';
                  return (
                    <div key={t.id} className="flex items-center gap-1 min-w-0">
                      <span className={`w-1 h-1 rounded-full shrink-0 ${dot}`} />
                      <span className="text-[9px] leading-tight truncate text-slate-500">{t.title}</span>
                    </div>
                  );
                })}
                {items.length > 2 && (
                  <span className="text-[9px] text-slate-400 pl-2">+{items.length - 2} 项</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      {/* 选中日期的待办详情 */}
      <div className="mt-3 border-t border-slate-100 pt-2 max-h-48 overflow-y-auto">
        <p className="text-xs text-slate-500 mb-1">
          {selDay.slice(5).replace('-', '/')} {selTasks.length > 0 ? `的待办（${selTasks.length}）` : '暂无待办'}
        </p>
        {selTasks.length === 0 && <p className="text-xs text-slate-300 py-2 text-center">当天暂无待办</p>}
        {selTasks.map((t: any) => (
          <div key={t.id} className="flex items-center gap-2 py-1 text-sm">
            <button onClick={() => toggleDone(t)} title="标记完成"
              className="w-3.5 h-3.5 rounded border border-slate-300 hover:border-green-500 shrink-0" />
            {t.kind === 'hearing' && <span className="text-[10px] px-1 py-px bg-red-100 text-red-600 rounded shrink-0">开庭</span>}
            <span className="truncate">{t.title}</span>
            {t.kind !== 'hearing' && (
              <button onClick={() => exportIcs(t)} title="导出 .ics 到当前电脑日历"
                className="text-slate-300 hover:text-emerald-600 shrink-0">
                <FileDown className="w-3.5 h-3.5" />
              </button>
            )}
            {t.case_id && t.case_name
              ? <Link to={`/cases/${t.case_id}`} className="text-xs text-slate-400 hover:text-amber-600 truncate ml-auto">{t.case_name}</Link>
              : <span className="text-xs text-slate-300 ml-auto">个人待办</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function NewTodoModal({ cases, me, onClose, onCreated }: any) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('medium');
  const [caseId, setCaseId] = useState('');
  // 关联案件输入框文本：显示「案件名（案件编号）」，支持输入名称/ID/编号查找
  const [caseQuery, setCaseQuery] = useState('');
  const [showCaseList, setShowCaseList] = useState(false);
  const [err, setErr] = useState('');

  // 输入过滤：支持按 名称/编号/ID 模糊匹配
  const filteredCases = caseQuery.trim()
    ? cases.filter((c: any) =>
        c.name?.toLowerCase().includes(caseQuery.toLowerCase()) ||
        c.case_no?.toLowerCase().includes(caseQuery.toLowerCase()) ||
        String(c.id) === caseQuery.trim())
    : cases;

  const pickCase = (c: any) => {
    setCaseId(String(c.id));
    setCaseQuery(`${c.name}（${c.case_no}）`);
    setShowCaseList(false);
  };
  const clearCase = () => {
    setCaseId('');
    setCaseQuery('');
  };

  const submit = async () => {
    if (!title.trim()) { setErr('待办标题必填'); return; }
    try {
      if (caseId) {
        // 关联案件：创建为该案件任务并分配给自己（案件详情"任务"Tab 同步可见）
        await api(`/cases/${caseId}/tasks`, {
          method: 'POST',
          body: JSON.stringify({ title: title.trim(), due_date: dueDate || null, priority, assignee_id: me.id }),
        });
      } else {
        await api('/tasks', {
          method: 'POST',
          body: JSON.stringify({ title: title.trim(), due_date: dueDate || null, priority }),
        });
      }
      onCreated();
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg p-6 w-[460px]" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold mb-4 flex items-center gap-2"><Check className="w-5 h-5 text-amber-500" /> 新增待办</h3>
        <div className="space-y-3">
          <Field label="标题 *">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="截止时间">
              <input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
            </Field>
            <Field label="优先级">
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputCls}>
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </Field>
          </div>
          <Field label="关联案件（可输入名称 / 编号 / ID 查找）">
            <div className="relative">
              <input value={caseQuery} onChange={(e) => {
                  setCaseQuery(e.target.value);
                  setShowCaseList(true);
                  setCaseId(''); // 编辑时清空已选 id，需重新选择
                }}
                onFocus={() => setShowCaseList(true)}
                placeholder="留空表示个人待办"
                className={inputCls} />
              {caseId && (
                <button onClick={clearCase} title="清除"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-500">
                  <X className="w-4 h-4" />
                </button>
              )}
              {showCaseList && filteredCases.length > 0 && (
                <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-slate-200 rounded shadow">
                  {filteredCases.slice(0, 50).map((c: any) => (
                    <button key={c.id} type="button"
                      onClick={() => pickCase(c)}
                      className="w-full text-left px-3 py-2 hover:bg-amber-50 text-sm border-b last:border-0">
                      <div className="font-medium truncate">{c.name}</div>
                      <div className="text-xs text-slate-400">#{c.id} · {c.case_no}</div>
                    </button>
                  ))}
                  {filteredCases.length > 50 && (
                    <div className="px-3 py-2 text-xs text-slate-400 text-center">仅显示前 50 个匹配，请继续输入</div>
                  )}
                </div>
              )}
            </div>
          </Field>
          <p className="text-xs text-slate-400">关联案件后，该待办会同时出现在案件详情的"任务"列表中。创建后可在任务列表里勾选下载 .ics 文件，双击导入当前电脑日历。</p>
        </div>
        {err && <div className="text-red-500 text-sm mt-3">{err}</div>}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 border rounded text-sm">取消</button>
          <button onClick={submit} className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded text-sm">创建</button>
        </div>
      </div>
    </div>
  );
}

function Empty() { return <div className="text-slate-400 text-sm py-4 text-center">暂无</div>; }
function Field({ label, children }: any) {
  return <div><label className="block text-sm text-slate-600 mb-1">{label}</label>{children}</div>;
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// 当前完整时间字符串：YYYY-MM-DDTHH:MM，用于判断待办是否已过期
function nowStr() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDateTime(v: string | null) {
  if (!v) return '';
  return v.includes('T') ? v.replace('T', ' ').slice(0, 16) : v;
}
const inputCls = 'w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-400';
