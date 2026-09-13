import { useEffect, useState } from 'react';
import { Plus, Trash2, Check } from 'lucide-react';

export default function TasksTab({ caseId }: { caseId: string }) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('medium');

  const load = () => fetch(`/api/cases/${caseId}/tasks`, { credentials: 'include' }).then((r) => r.json()).then((d) => setTasks(d.tasks || []));
  useEffect(() => { load(); }, [caseId]);

  const create = async () => {
    if (!title.trim()) return;
    await fetch(`/api/cases/${caseId}/tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ title, due_date: dueDate || null, priority }),
    });
    setTitle(''); setDueDate(''); setPriority('medium'); setShowForm(false);
    load();
  };

  const updateStatus = async (id: number, status: string) => {
    await fetch(`/api/tasks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ status }) });
    load();
  };

  const del = async (id: number) => {
    if (!confirm('确认删除？')) return;
    await fetch(`/api/tasks/${id}`, { method: 'DELETE', credentials: 'include' });
    load();
  };

  const pColor = (p: string) => ({ high: 'text-red-600', medium: 'text-amber-600', low: 'text-slate-500' }[p] || '');

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold">任务列表</h3>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 bg-amber-500 text-white px-3 py-1.5 rounded text-sm">
          <Plus className="w-4 h-4" /> 新建任务
        </button>
      </div>
      {showForm && (
        <div className="bg-white rounded shadow p-4 mb-4 space-y-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="任务标题"
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="border border-slate-300 rounded px-3 py-2 text-sm" />
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className="border border-slate-300 rounded px-3 py-2 text-sm">
              <option value="high">高</option><option value="medium">中</option><option value="low">低</option>
            </select>
            <button onClick={create} className="bg-amber-500 text-white px-4 py-2 rounded text-sm">创建</button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {tasks.map((t) => (
          <div key={t.id} className="bg-white rounded shadow p-3 flex items-center gap-3">
            <button onClick={() => updateStatus(t.id, t.status === 'done' ? 'todo' : 'done')}
              className={`w-5 h-5 rounded border flex items-center justify-center ${t.status === 'done' ? 'bg-green-500 border-green-500' : 'border-slate-300'}`}>
              {t.status === 'done' && <Check className="w-3 h-3 text-white" />}
            </button>
            <div className="flex-1">
              <span className={t.status === 'done' ? 'line-through text-slate-400' : ''}>{t.title}</span>
              <span className={`ml-2 text-xs ${pColor(t.priority)}`}>{t.priority === 'high' ? '高' : t.priority === 'medium' ? '中' : '低'}</span>
              {t.due_date && <span className="ml-2 text-xs text-slate-400">截止 {t.due_date}</span>}
            </div>
            <button onClick={() => del(t.id)} className="text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        {tasks.length === 0 && <div className="text-center text-slate-400 py-8">暂无任务</div>}
      </div>
    </div>
  );
}
