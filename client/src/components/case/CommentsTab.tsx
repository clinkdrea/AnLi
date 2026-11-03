import { useEffect, useRef, useState } from 'react';
import {
  Send, Trash2, MessageSquare, Users, Globe, Flag, CheckSquare,
  ChevronDown, Filter, X
} from 'lucide-react';
import { api } from '../../api';

const ALL_CODE = '所有人';

type FixedTarget = { type: 'task'; id: number };

// 级联选择器：扁平的「全局 / 阶段 / 任务」菜单，一级二级都可直接单选
type CascaderValue = { type: 'global' } | { type: 'stage'; id: number; name: string } | { type: 'task'; id: number; name: string };

function cascaderLabel(v: CascaderValue | null): string {
  if (!v) return '选择目标…';
  if (v.type === 'global') return '全局消息（不指定）';
  if (v.type === 'stage') return `阶段：${v.name}`;
  return `任务：${v.name}`;
}

export default function CommentsTab({ caseId, fixedTarget }: { caseId: string; fixedTarget?: FixedTarget }) {
  const [comments, setComments] = useState<any[]>([]);
  const [content, setContent] = useState('');
  const [members, setMembers] = useState<any[]>([]);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [hi, setHi] = useState(0);

  // 级联选择器
  const [target, setTarget] = useState<CascaderValue>({ type: 'global' });
  const [cascaderOpen, setCascaderOpen] = useState(false);
  const [cascaderHover, setCascaderHover] = useState<'global' | 'stage' | 'task' | null>(null);
  const cascaderRef = useRef<HTMLDivElement>(null);

  // 筛选器（隐藏式）
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState<{ target_type?: string; target_id?: number | ''; author_id?: number | '' }>({});

  const [stages, setStages] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);

  const load = () => {
    const params = new URLSearchParams();
    if (fixedTarget) {
      params.set('target_type', 'task');
      params.set('target_id', String(fixedTarget.id));
    } else {
      if (filter.target_type) params.set('target_type', filter.target_type);
      if (filter.target_id) params.set('target_id', String(filter.target_id));
      if (filter.author_id) params.set('author_id', String(filter.author_id));
    }
    const qs = params.toString();
    fetch(`/api/cases/${caseId}/comments${qs ? '?' + qs : ''}`, { credentials: 'include' })
      .then((r) => r.json()).then((d) => setComments(d.comments || []));
    fetch(`/api/cases/${caseId}`, { credentials: 'include' }).then((r) => r.json()).then((d) => setMembers(d.members || []));
    if (!fixedTarget) {
      api(`/cases/${caseId}/stages`).then((d) => setStages(d.stages || [])).catch(() => {});
      api(`/cases/${caseId}/tasks?board=1&include_expired=1`).then((d) => setTasks(d.tasks || [])).catch(() => {});
    }
  };
  useEffect(() => { load(); }, [caseId, fixedTarget?.id, filter]);

  // 点击外部关闭级联菜单
  useEffect(() => {
    if (!cascaderOpen) return;
    const h = (e: MouseEvent) => {
      if (cascaderRef.current && !cascaderRef.current.contains(e.target as Node)) {
        setCascaderOpen(false);
        setCascaderHover(null);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [cascaderOpen]);

  // 评论按时间正序（最新在底部），每次更新后滚动到底部
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [comments]);

  // 候选项：所有人 + 案件成员，按已输入片段过滤
  const options = mention
    ? [{ id: 0, name: ALL_CODE }, ...members]
        .filter((m) => m.name.includes(mention.query))
        .slice(0, 8)
    : [];

  const setCaret = (pos: number) => {
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) { ta.focus(); ta.setSelectionRange(pos, pos); }
    });
  };

  // 在光标处插入文本（未聚焦时追加到末尾）
  const insertAtCursor = (text: string) => {
    const ta = taRef.current;
    const focused = !!ta && document.activeElement === ta;
    const start = focused ? (ta!.selectionStart ?? content.length) : content.length;
    const end = focused ? (ta!.selectionEnd ?? start) : content.length;
    const next = content.slice(0, start) + text + content.slice(end);
    setContent(next);
    setCaret(start + text.length);
  };

  // 点击成员 chips / 候选项：用选中项替换 "@query" 片段
  const pickMention = (name: string) => {
    const ta = taRef.current;
    if (!mention || !ta) { insertAtCursor(`@${name} `); setMention(null); return; }
    const caret = ta.selectionStart ?? content.length;
    const next = content.slice(0, mention.start) + `@${name} ` + content.slice(caret);
    setContent(next);
    setMention(null);
    setCaret(mention.start + name.length + 2);
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setContent(v);
    setHi(0);
    const caret = e.target.selectionStart ?? 0;
    const m = v.slice(0, caret).match(/@([^\s@]*)$/);
    if (m) setMention({ start: caret - m[0].length, query: m[1] });
    else setMention(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 候选浮层键盘导航
    if (mention && options.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => (h + 1) % options.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => (h - 1 + options.length) % options.length); return; }
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); pickMention(options[hi]?.name || options[0].name); return; }
      if (e.key === 'Escape') { setMention(null); return; }
    }
    // Ctrl/Cmd+Enter 发送
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); return; }
    // Backspace 整块删除提及（光标紧跟 "@名字 " 或 "@名字" 时）
    if (e.key === 'Backspace') {
      const ta = e.currentTarget;
      const s = ta.selectionStart, en = ta.selectionEnd;
      if (s !== null && s === en && s > 0) {
        const before = content.slice(0, s);
        const m = before.match(/@([^\s@]+)( ?)$/);
        if (m) {
          const name = m[1];
          const isMention = name === ALL_CODE || members.some((mm) => mm.name === name);
          if (isMention) {
            e.preventDefault();
            const removeLen = m[0].length;
            setContent(content.slice(0, s - removeLen) + content.slice(s));
            setCaret(s - removeLen);
          }
        }
      }
    }
  };

  const submit = async () => {
    if (!content.trim() || sending) return;
    setSending(true);
    setMention(null);
    try {
      const body: any = { content };
      if (fixedTarget) {
        body.target_type = 'task';
        body.target_id = fixedTarget.id;
      } else if (target.type === 'stage') {
        body.target_type = 'stage';
        body.target_id = target.id;
      } else if (target.type === 'task') {
        body.target_type = 'task';
        body.target_id = target.id;
      }
      await fetch(`/api/cases/${caseId}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(body),
      });
      setContent('');
      load();
    } finally { setSending(false); }
  };

  const del = async (id: number) => {
    if (!confirm('确认删除该评论？')) return;
    await fetch(`/api/comments/${id}`, { method: 'DELETE', credentials: 'include' });
    load();
  };

  // 渲染评论正文：高亮 @提及
  const renderContent = (text: string) => {
    const parts = text.split(/(@[^\s@]+)/g);
    return parts.map((p, i) =>
      p.startsWith('@') && p.length > 1
        ? <span key={i} className="text-amber-700 bg-amber-100 rounded px-0.5 font-medium">{p}</span>
        : <span key={i}>{p}</span>
    );
  };

  // 归属徽标：全局 / 阶段 / 任务
  const renderBadge = (c: any) => {
    if (c.target_type === 'stage') {
      return (
        <span className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
          <Flag className="w-3 h-3" /> 阶段：{c.stage_name || '已删除'}
        </span>
      );
    }
    if (c.target_type === 'task') {
      return (
        <span className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">
          <CheckSquare className="w-3 h-3" /> 任务：{c.task_title || '已删除'}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
        <Globe className="w-3 h-3" /> 全局
      </span>
    );
  };

  // ============ 级联选择器浮层 ============
  const CascaderMenu = () => (
    <div className="absolute bottom-full left-0 mb-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[200px]">
      {/* 一级项：全局（直接可选） */}
      <button
        onClick={() => { setTarget({ type: 'global' }); setCascaderOpen(false); setCascaderHover(null); }}
        className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-amber-50 ${
          target.type === 'global' ? 'bg-amber-50 text-amber-800' : 'text-slate-700'}`}>
        <Globe className="w-3.5 h-3.5 text-slate-400" /> 全局消息（不指定）
      </button>

      {/* 一级项：阶段（hover/点击展开子列表） */}
      <div
        className="relative"
        onMouseEnter={() => setCascaderHover('stage')}
        onMouseLeave={() => setCascaderHover((h) => h === 'stage' ? null : h)}
      >
        <button
          onClick={() => setCascaderHover((h) => h === 'stage' ? null : 'stage')}
          className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-amber-50 text-slate-700">
          <Flag className="w-3.5 h-3.5 text-amber-500" /> 指定阶段
          <ChevronDown className="w-3.5 h-3.5 ml-auto rotate-[-90deg]" />
        </button>
        {cascaderHover === 'stage' && (
          <div className="absolute left-full top-0 ml-0.5 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[200px] max-h-60 overflow-auto">
            {stages.length === 0 ? (
              <div className="px-3 py-1.5 text-xs text-slate-400">暂无阶段</div>
            ) : stages.map((s) => (
              <button
                key={s.id}
                onClick={() => { setTarget({ type: 'stage', id: s.id, name: s.name }); setCascaderOpen(false); setCascaderHover(null); }}
                className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-amber-50 text-slate-700 truncate max-w-[280px]">
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 一级项：任务（hover/点击展开子列表） */}
      <div
        className="relative"
        onMouseEnter={() => setCascaderHover('task')}
        onMouseLeave={() => setCascaderHover((h) => h === 'task' ? null : h)}
      >
        <button
          onClick={() => setCascaderHover((h) => h === 'task' ? null : 'task')}
          className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-amber-50 text-slate-700">
          <CheckSquare className="w-3.5 h-3.5 text-violet-500" /> 指定任务
          <ChevronDown className="w-3.5 h-3.5 ml-auto rotate-[-90deg]" />
        </button>
        {cascaderHover === 'task' && (
          <div className="absolute left-full top-0 ml-0.5 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[220px] max-h-60 overflow-auto">
            {tasks.length === 0 ? (
              <div className="px-3 py-1.5 text-xs text-slate-400">暂无任务</div>
            ) : tasks.map((t) => (
              <button
                key={t.id}
                onClick={() => { setTarget({ type: 'task', id: t.id, name: t.title }); setCascaderOpen(false); setCascaderHover(null); }}
                className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-amber-50 text-slate-700 truncate max-w-[300px]">
                {t.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // ============ Filter 面板 ============
  const hasFilter = !!(filter.target_type || filter.author_id);

  // 当前筛选条件的人类可读描述（用于汇总行）
  const filterSummary: string[] = [];
  if (filter.target_type === 'global') filterSummary.push('归属：全局');
  if (filter.target_type === 'stage') {
    const s = filter.target_id ? stages.find((x) => x.id === filter.target_id) : null;
    filterSummary.push(s ? `归属：阶段 · ${s.name}` : '归属：全部阶段');
  }
  if (filter.target_type === 'task') {
    const t = filter.target_id ? tasks.find((x) => x.id === filter.target_id) : null;
    filterSummary.push(t ? `归属：任务 · ${t.title}` : '归属：全部任务');
  }
  if (filter.author_id) {
    const m = members.find((x) => x.id === filter.author_id);
    if (m) filterSummary.push(`成员：${m.name}`);
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* 顶部工具栏：评论数 + 筛选按钮 */}
      {!fixedTarget && (
        <div className="px-4 pt-3 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-slate-700">
              共 {comments.length} 条评论
              {hasFilter && <span className="ml-2 text-xs text-amber-600">· 已筛选</span>}
            </div>
            <button
              onClick={() => setFilterOpen((v) => !v)}
              className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-md transition-colors ${
                filterOpen || hasFilter ? 'bg-amber-100 text-amber-700' : 'text-slate-500 hover:bg-slate-100'
              }`}>
              <Filter className="w-3.5 h-3.5" />
              {filterOpen ? '收起筛选' : hasFilter ? '筛选中' : '筛选'}
            </button>
          </div>

          {/* 隐藏式 Filter 面板 —— 卡片化 */}
          {filterOpen && (
            <div className="mt-3 mb-3 bg-slate-50 rounded-lg border border-slate-200 p-4 space-y-3 text-xs">
              {/* 第一行：按归属 Pill 标签组 */}
              <div>
                <div className="text-slate-500 mb-1.5">按归属</div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setFilter((f) => ({ ...f, target_type: undefined, target_id: undefined }))}
                    className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                      !filter.target_type ? 'bg-amber-500 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:border-amber-300 hover:text-amber-600'}`}>
                    全部
                  </button>
                  <button
                    onClick={() => setFilter((f) => ({ ...f, target_type: 'global', target_id: undefined }))}
                    className={`px-2.5 py-1 rounded-full text-xs inline-flex items-center gap-1 transition-colors ${
                      filter.target_type === 'global' ? 'bg-amber-500 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:border-amber-300 hover:text-amber-600'}`}>
                    <Globe className="w-3 h-3" /> 全局
                  </button>
                  <button
                    onClick={() => setFilter((f) => ({ ...f, target_type: 'stage', target_id: undefined }))}
                    className={`px-2.5 py-1 rounded-full text-xs inline-flex items-center gap-1 transition-colors ${
                      filter.target_type === 'stage' ? 'bg-amber-500 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:border-amber-300 hover:text-amber-600'}`}>
                    <Flag className="w-3 h-3" /> 阶段
                  </button>
                  <button
                    onClick={() => setFilter((f) => ({ ...f, target_type: 'task', target_id: undefined }))}
                    className={`px-2.5 py-1 rounded-full text-xs inline-flex items-center gap-1 transition-colors ${
                      filter.target_type === 'task' ? 'bg-amber-500 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:border-amber-300 hover:text-amber-600'}`}>
                    <CheckSquare className="w-3 h-3" /> 任务
                  </button>
                </div>

                {/* 二级下拉：选中阶段/任务时出现，独立成行 */}
                {filter.target_type === 'stage' && (
                  <div className="mt-2">
                    <select
                      value={filter.target_id || ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setFilter((f) => ({ ...f, target_id: v ? Number(v) : undefined }));
                      }}
                      className="w-full max-w-[260px] border border-slate-200 bg-white rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-200">
                      <option value="">全部阶段（仅按类型）</option>
                      {stages.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {filter.target_type === 'task' && (
                  <div className="mt-2">
                    <select
                      value={filter.target_id || ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setFilter((f) => ({ ...f, target_id: v ? Number(v) : undefined }));
                      }}
                      className="w-full max-w-[260px] border border-slate-200 bg-white rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-200">
                      <option value="">全部任务（仅按类型）</option>
                      {tasks.map((t) => (
                        <option key={t.id} value={t.id}>{t.title}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* 分隔线 */}
              <div className="border-t border-slate-200/70" />

              {/* 第二行：按成员 */}
              <div>
                <div className="text-slate-500 mb-1.5">按成员</div>
                <select
                  value={filter.author_id || ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFilter((f) => ({ ...f, author_id: v ? Number(v) : undefined }));
                  }}
                  className="w-full max-w-[260px] border border-slate-200 bg-white rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-200">
                  <option value="">全部成员</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>

              {/* 激活条件汇总行 */}
              {hasFilter && (
                <div className="pt-2 border-t border-slate-200/70 flex items-center justify-between">
                  <div className="text-slate-500 flex flex-wrap items-center gap-1.5">
                    {filterSummary.map((s, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-[11px]">
                        {s}
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={() => setFilter({})}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] text-red-500 hover:bg-red-50 rounded">
                    <X className="w-3 h-3" /> 清除筛选
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 消息区：最新在底部 */}
      <div ref={listRef} className="flex-1 overflow-auto p-4 space-y-3">
        {comments.length === 0 && (
          <div className="text-center text-slate-400 py-10">
            <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-50" />
            {fixedTarget ? '该任务暂无讨论，在下方发起评论' : hasFilter ? '当前筛选条件下暂无评论' : '暂无评论，在下方发起讨论'}
          </div>
        )}
        {comments.map((c) => (
          <div key={c.id} className="group">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <div className="w-7 h-7 rounded-full bg-amber-500 text-white flex items-center justify-center text-xs shrink-0">{c.author_name?.[0]}</div>
              <span className="font-medium text-sm">{c.author_name}</span>
              <span className="text-xs text-slate-400">{c.created_at}</span>
              {renderBadge(c)}
              <button onClick={() => del(c.id)}
                className="ml-auto opacity-0 group-hover:opacity-100 transition text-slate-300 hover:text-red-500">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div className="text-sm whitespace-pre-wrap bg-slate-100 rounded-lg px-3 py-2 ml-9 text-slate-700">{renderContent(c.content)}</div>
          </div>
        ))}
      </div>

      {/* 输入区：置底 */}
      <div className="border-t border-slate-200 p-3">
        {/* 目标选择 —— 级联按钮（任务页固定归属本任务，不显示选择器） */}
        {!fixedTarget && (
          <div className="mb-2 flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-slate-400">发送到：</span>
            <div ref={cascaderRef} className="relative">
              <button
                onClick={() => setCascaderOpen((v) => !v)}
                className={`text-xs border rounded px-2 py-1 inline-flex items-center gap-1 max-w-[280px] truncate focus:outline-none focus:border-amber-400 ${
                  cascaderOpen ? 'border-amber-400 bg-amber-50' : 'border-slate-300 hover:border-slate-400'}`}>
                {target.type === 'global' && <Globe className="w-3 h-3 text-slate-400" />}
                {target.type === 'stage' && <Flag className="w-3 h-3 text-amber-500" />}
                {target.type === 'task' && <CheckSquare className="w-3 h-3 text-violet-500" />}
                <span className="truncate">{cascaderLabel(target)}</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${cascaderOpen ? 'rotate-180' : ''}`} />
              </button>
              {cascaderOpen && <CascaderMenu />}
            </div>
          </div>
        )}
        <div className="flex gap-1 mb-2 flex-wrap items-center">
          <button onClick={() => insertAtCursor(`@${ALL_CODE} `)}
            title="提及该案件全部成员"
            className="flex items-center gap-1 text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded hover:bg-amber-200">
            <Users className="w-3 h-3" />@{ALL_CODE}
          </button>
          {members.map((m) => (
            <button key={m.id} onClick={() => insertAtCursor(`@${m.name} `)}
              className="text-xs px-2 py-0.5 bg-slate-100 rounded hover:bg-amber-100">@{m.name}</button>
          ))}
        </div>
        <div className="relative">
          {/* 提及候选浮层 */}
          {mention && options.length > 0 && (
            <div className="absolute bottom-full left-2 mb-1 z-10 bg-white border border-slate-200 rounded-lg shadow-lg py-1 w-56 max-h-44 overflow-auto">
              {options.map((o, i) => (
                <button key={o.id} onMouseDown={(e) => { e.preventDefault(); pickMention(o.name); }}
                  onMouseEnter={() => setHi(i)}
                  className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 ${
                    i === hi ? 'bg-amber-50 text-amber-800' : 'hover:bg-slate-50'}`}>
                  {o.name === ALL_CODE
                    ? <><Users className="w-3.5 h-3.5 text-amber-600" /> @{ALL_CODE}<span className="text-xs text-slate-400 ml-auto">全部成员</span></>
                    : <><span className="w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center text-[10px]">{o.name?.[0]}</span> @{o.name}</>}
                </button>
              ))}
            </div>
          )}
          <textarea ref={taRef} value={content} onChange={onChange} onKeyDown={onKeyDown}
            onBlur={() => { setTimeout(() => setMention(null), 150); }}
            placeholder={fixedTarget
              ? '评论将发送到当前任务，任务处理人均可见'
              : '写下你的讨论，输入 @ 提及成员（Ctrl+Enter 发送）'}
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm min-h-[64px] resize-none focus:outline-none focus:border-amber-400" />
        </div>
        <div className="flex justify-end mt-2">
          <button onClick={submit} disabled={sending || !content.trim()}
            className="flex items-center gap-1 bg-amber-500 text-white px-4 py-1.5 rounded text-sm disabled:opacity-50">
            <Send className="w-4 h-4" /> 发送
          </button>
        </div>
      </div>
    </div>
  );
}
