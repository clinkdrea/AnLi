import { useEffect, useState } from 'react';
import { Send, Trash2 } from 'lucide-react';

export default function NotesTab({ caseId }: { caseId: string }) {
  const [notes, setNotes] = useState<any[]>([]);
  const [content, setContent] = useState('');
  const [stageId, setStageId] = useState('');
  const [stages, setStages] = useState<any[]>([]);

  const load = () => {
    fetch(`/api/cases/${caseId}/notes`, { credentials: 'include' })
      .then((r) => r.json()).then((d) => setNotes(d.notes || []));
    fetch(`/api/cases/${caseId}`, { credentials: 'include' })
      .then((r) => r.json()).then((d) => setStages(d.stages || []));
  };
  useEffect(() => { load(); }, [caseId]);

  const submit = async () => {
    if (!content.trim()) return;
    await fetch(`/api/cases/${caseId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ content, stage_id: stageId || null }),
    });
    setContent('');
    setStageId('');
    load();
  };

  const del = async (id: number) => {
    if (!confirm('确认删除该案情记录？')) return;
    await fetch(`/api/notes/${id}`, { method: 'DELETE', credentials: 'include' });
    load();
  };

  return (
    <div>
      <div className="bg-white rounded shadow p-4 mb-4">
        <div className="flex gap-2 mb-2">
          <select value={stageId} onChange={(e) => setStageId(e.target.value)}
            className="border border-slate-300 rounded px-3 py-2 text-sm">
            <option value="">不关联阶段</option>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <textarea value={content} onChange={(e) => setContent(e.target.value)}
          placeholder="记录案情进展、关键事实、与当事人沟通内容..."
          className="w-full border border-slate-300 rounded px-3 py-2 text-sm min-h-[100px]" />
        <div className="flex justify-end mt-2">
          <button onClick={submit}
            className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded text-sm">
            <Send className="w-4 h-4" /> 保存记录
          </button>
        </div>
      </div>
      <div className="space-y-3">
        {notes.map((n) => (
          <div key={n.id} className="bg-white rounded shadow p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-slate-500">
                {n.author_name} · {n.created_at}
                {n.stage_name && <span className="ml-2 px-2 py-0.5 bg-slate-100 rounded">{n.stage_name}</span>}
              </div>
              <button onClick={() => del(n.id)} className="text-red-400 hover:text-red-600">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div className="text-sm whitespace-pre-wrap">{n.content}</div>
          </div>
        ))}
        {notes.length === 0 && <div className="text-center text-slate-400 py-8">暂无案情记录</div>}
      </div>
    </div>
  );
}
