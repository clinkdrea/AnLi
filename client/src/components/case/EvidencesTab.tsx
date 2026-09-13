import { useEffect, useState } from 'react';
import { Plus, Trash2, Edit3, X } from 'lucide-react';

export default function EvidencesTab({ caseId }: { caseId: string }) {
  const [evidences, setEvidences] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', source: '', purpose: '', group_name: '', remark: '' });

  const load = () => fetch(`/api/cases/${caseId}/evidences`, { credentials: 'include' }).then((r) => r.json()).then((d) => setEvidences(d.evidences || []));
  useEffect(() => { load(); }, [caseId]);

  const create = async () => {
    if (!form.name.trim()) return;
    await fetch(`/api/cases/${caseId}/evidences`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify(form),
    });
    setForm({ name: '', source: '', purpose: '', group_name: '', remark: '' });
    setShowForm(false);
    load();
  };

  const del = async (id: number) => {
    if (!confirm('确认删除？')) return;
    await fetch(`/api/evidences/${id}`, { method: 'DELETE', credentials: 'include' });
    load();
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold">证据清单</h3>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 bg-amber-500 text-white px-3 py-1.5 rounded text-sm">
          <Plus className="w-4 h-4" /> 添加证据
        </button>
      </div>
      {showForm && (
        <div className="bg-white rounded shadow p-4 mb-4 grid grid-cols-2 gap-3">
          <input placeholder="证据名称 *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border rounded px-3 py-2 text-sm" />
          <input placeholder="分组" value={form.group_name} onChange={(e) => setForm({ ...form, group_name: e.target.value })} className="border rounded px-3 py-2 text-sm" />
          <input placeholder="证据来源" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="border rounded px-3 py-2 text-sm" />
          <input placeholder="证明目的" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} className="border rounded px-3 py-2 text-sm" />
          <input placeholder="备注" value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} className="border rounded px-3 py-2 text-sm col-span-2" />
          <div className="col-span-2 flex gap-2">
            <button onClick={create} className="bg-amber-500 text-white px-4 py-2 rounded text-sm">保存</button>
            <button onClick={() => setShowForm(false)} className="border px-4 py-2 rounded text-sm">取消</button>
          </div>
        </div>
      )}
      <div className="bg-white rounded shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3">分组</th>
              <th className="text-left px-4 py-3">证据名称</th>
              <th className="text-left px-4 py-3">来源</th>
              <th className="text-left px-4 py-3">证明目的</th>
              <th className="text-left px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {evidences.map((e) => (
              <tr key={e.id} className="border-t">
                <td className="px-4 py-3 text-slate-500">{e.group_name || '-'}</td>
                <td className="px-4 py-3">{e.name}</td>
                <td className="px-4 py-3 text-slate-500">{e.source || '-'}</td>
                <td className="px-4 py-3 text-slate-500">{e.purpose || '-'}</td>
                <td className="px-4 py-3"><button onClick={() => del(e.id)} className="text-red-400"><Trash2 className="w-4 h-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {evidences.length === 0 && <div className="p-8 text-center text-slate-400">暂无证据</div>}
      </div>
    </div>
  );
}
