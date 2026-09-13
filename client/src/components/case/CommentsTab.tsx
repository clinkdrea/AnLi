import { useEffect, useState } from 'react';
import { Send, Trash2, MessageSquare } from 'lucide-react';

export default function CommentsTab({ caseId }: { caseId: string }) {
  const [comments, setComments] = useState<any[]>([]);
  const [content, setContent] = useState('');
  const [members, setMembers] = useState<any[]>([]);

  const load = () => {
    fetch(`/api/cases/${caseId}/comments`, { credentials: 'include' }).then((r) => r.json()).then((d) => setComments(d.comments || []));
    fetch(`/api/cases/${caseId}`, { credentials: 'include' }).then((r) => r.json()).then((d) => setMembers(d.members || []));
  };
  useEffect(() => { load(); }, [caseId]);

  const submit = async () => {
    if (!content.trim()) return;
    await fetch(`/api/cases/${caseId}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ content }),
    });
    setContent('');
    load();
  };

  const insertMention = (name: string) => {
    setContent((c) => c + `@${name} `);
  };

  const del = async (id: number) => {
    if (!confirm('确认删除？')) return;
    await fetch(`/api/comments/${id}`, { method: 'DELETE', credentials: 'include' });
    load();
  };

  return (
    <div>
      <div className="bg-white rounded shadow p-4 mb-4">
        <div className="flex gap-1 mb-2 flex-wrap">
          {members.map((m) => (
            <button key={m.id} onClick={() => insertMention(m.name)}
              className="text-xs px-2 py-0.5 bg-slate-100 rounded hover:bg-amber-100">@{m.name}</button>
          ))}
        </div>
        <textarea value={content} onChange={(e) => setContent(e.target.value)}
          placeholder="写下你的讨论，可 @同事" className="w-full border border-slate-300 rounded px-3 py-2 text-sm min-h-[80px]" />
        <div className="flex justify-end mt-2">
          <button onClick={submit} className="flex items-center gap-1 bg-amber-500 text-white px-4 py-2 rounded text-sm">
            <Send className="w-4 h-4" /> 发送
          </button>
        </div>
      </div>
      <div className="space-y-3">
        {comments.map((c) => (
          <div key={c.id} className="bg-white rounded shadow p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-amber-500 text-white flex items-center justify-center text-xs">{c.author_name?.[0]}</div>
                <span className="font-medium text-sm">{c.author_name}</span>
                <span className="text-xs text-slate-400">{c.created_at}</span>
              </div>
              <button onClick={() => del(c.id)} className="text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
            </div>
            <div className="text-sm whitespace-pre-wrap ml-9">{c.content}</div>
          </div>
        ))}
        {comments.length === 0 && (
          <div className="text-center text-slate-400 py-8">
            <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-50" />
            暂无评论
          </div>
        )}
      </div>
    </div>
  );
}
