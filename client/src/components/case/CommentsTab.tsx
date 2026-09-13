import { useEffect, useRef, useState } from 'react';
import { Send, Trash2, MessageSquare } from 'lucide-react';

export default function CommentsTab({ caseId }: { caseId: string }) {
  const [comments, setComments] = useState<any[]>([]);
  const [content, setContent] = useState('');
  const [members, setMembers] = useState<any[]>([]);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = () => {
    fetch(`/api/cases/${caseId}/comments`, { credentials: 'include' }).then((r) => r.json()).then((d) => setComments(d.comments || []));
    fetch(`/api/cases/${caseId}`, { credentials: 'include' }).then((r) => r.json()).then((d) => setMembers(d.members || []));
  };
  useEffect(() => { load(); }, [caseId]);

  // 评论按时间正序（最新在底部），每次更新后滚动到底部
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [comments]);

  const submit = async () => {
    if (!content.trim() || sending) return;
    setSending(true);
    try {
      await fetch(`/api/cases/${caseId}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ content }),
      });
      setContent('');
      load();
    } finally { setSending(false); }
  };

  const insertMention = (name: string) => {
    setContent((c) => c + `@${name} `);
  };

  const del = async (id: number) => {
    if (!confirm('确认删除该评论？')) return;
    await fetch(`/api/comments/${id}`, { method: 'DELETE', credentials: 'include' });
    load();
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {/* 消息区：最新在底部 */}
      <div ref={listRef} className="flex-1 overflow-auto p-4 space-y-3">
        {comments.length === 0 && (
          <div className="text-center text-slate-400 py-10">
            <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-50" />
            暂无评论，在下方发起讨论
          </div>
        )}
        {comments.map((c) => (
          <div key={c.id} className="group">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-full bg-amber-500 text-white flex items-center justify-center text-xs shrink-0">{c.author_name?.[0]}</div>
              <span className="font-medium text-sm">{c.author_name}</span>
              <span className="text-xs text-slate-400">{c.created_at}</span>
              <button onClick={() => del(c.id)}
                className="ml-auto opacity-0 group-hover:opacity-100 transition text-slate-300 hover:text-red-500">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div className="text-sm whitespace-pre-wrap bg-slate-100 rounded-lg px-3 py-2 ml-9 text-slate-700">{c.content}</div>
          </div>
        ))}
      </div>

      {/* 输入区：置底 */}
      <div className="border-t border-slate-200 p-3">
        <div className="flex gap-1 mb-2 flex-wrap">
          {members.map((m) => (
            <button key={m.id} onClick={() => insertMention(m.name)}
              className="text-xs px-2 py-0.5 bg-slate-100 rounded hover:bg-amber-100">@{m.name}</button>
          ))}
        </div>
        <textarea value={content} onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
          placeholder="写下你的讨论，可 @同事（Ctrl+Enter 发送）"
          className="w-full border border-slate-300 rounded px-3 py-2 text-sm min-h-[64px] resize-none focus:outline-none focus:border-amber-400" />
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
