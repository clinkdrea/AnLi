import { useEffect, useRef, useState } from 'react';
import { Send, Trash2, MessageSquare, Users, Globe, Flag, CheckSquare } from 'lucide-react';
import { api } from '../../api';

const ALL_CODE = '所有人';

type FixedTarget = { type: 'task'; id: number };

export default function CommentsTab({ caseId, fixedTarget }: { caseId: string; fixedTarget?: FixedTarget }) {
  const [comments, setComments] = useState<any[]>([]);
  const [content, setContent] = useState('');
  const [members, setMembers] = useState<any[]>([]);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // 提及自动补全状态：mention.start 是内容中 '@' 的下标，query 是 @ 后已输入的片段
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [hi, setHi] = useState(0); // 候选高亮下标

  // 评论归属目标（非固定模式下可由用户选择）
  const [targetType, setTargetType] = useState<'global' | 'stage' | 'task'>('global');
  const [targetId, setTargetId] = useState<number | ''>('');
  const [stages, setStages] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);

  const load = () => {
    const qs = fixedTarget ? `?target_type=task&target_id=${fixedTarget.id}` : '';
    fetch(`/api/cases/${caseId}/comments${qs}`, { credentials: 'include' })
      .then((r) => r.json()).then((d) => setComments(d.comments || []));
    fetch(`/api/cases/${caseId}`, { credentials: 'include' }).then((r) => r.json()).then((d) => setMembers(d.members || []));
    if (!fixedTarget) {
      api(`/cases/${caseId}/stages`).then((d) => setStages(d.stages || [])).catch(() => {});
      api(`/cases/${caseId}/tasks?board=1&include_expired=1`).then((d) => setTasks(d.tasks || [])).catch(() => {});
    }
  };
  useEffect(() => { load(); }, [caseId, fixedTarget?.id]);

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
      } else if (targetType !== 'global' && targetId !== '') {
        body.target_type = targetType;
        body.target_id = Number(targetId);
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

  return (
    <div className="h-full flex flex-col bg-white">
      {/* 消息区：最新在底部 */}
      <div ref={listRef} className="flex-1 overflow-auto p-4 space-y-3">
        {comments.length === 0 && (
          <div className="text-center text-slate-400 py-10">
            <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-50" />
            {fixedTarget ? '该任务暂无讨论，在下方发起评论' : '暂无评论，在下方发起讨论'}
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
        {/* 目标选择（任务页固定归属本任务，不显示选择器，提示语置于输入框 placeholder） */}
        {!fixedTarget && (
          <div className="mb-2 flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-slate-400">发送到：</span>
            <select value={targetType}
              onChange={(e) => { setTargetType(e.target.value as any); setTargetId(''); }}
              className="text-xs border border-slate-300 rounded px-1.5 py-1 focus:outline-none focus:border-amber-400">
              <option value="global">全局消息（不指定）</option>
              <option value="stage">指定阶段</option>
              <option value="task">指定任务</option>
            </select>
            {targetType === 'stage' && (
              <select value={targetId} onChange={(e) => setTargetId(e.target.value ? Number(e.target.value) : '')}
                className="text-xs border border-slate-300 rounded px-1.5 py-1 max-w-[170px] focus:outline-none focus:border-amber-400">
                <option value="">选择阶段…</option>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            {targetType === 'task' && (
              <select value={targetId} onChange={(e) => setTargetId(e.target.value ? Number(e.target.value) : '')}
                className="text-xs border border-slate-300 rounded px-1.5 py-1 max-w-[170px] focus:outline-none focus:border-amber-400">
                <option value="">选择任务…</option>
                {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            )}
            {targetType !== 'global' && targetId === '' && (
              <span className="text-xs text-amber-600">未选择具体{targetType === 'stage' ? '阶段' : '任务'}时将作为全局消息发送</span>
            )}
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
