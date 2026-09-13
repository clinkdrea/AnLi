import { useEffect, useState } from 'react';
import { Plus, BookOpen, Trash2, Search } from 'lucide-react';

export default function KnowledgePage() {
  const [docs, setDocs] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [q, setQ] = useState('');
  const [form, setForm] = useState({ title: '', category_id: '', content: '', visibility: 'shared' });

  const load = () => {
    fetch('/api/knowledge/docs' + (q ? `?q=${encodeURIComponent(q)}` : ''), { credentials: 'include' })
      .then((r) => r.json()).then((d) => setDocs(d.docs || []));
    fetch('/api/knowledge/categories', { credentials: 'include' }).then((r) => r.json()).then((d) => setCategories(d.categories || []));
  };
  useEffect(() => { load(); }, [q]);

  const create = async () => {
    if (!form.title.trim()) return;
    await fetch('/api/knowledge/docs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ ...form, category_id: form.category_id || null }),
    });
    setForm({ title: '', category_id: '', content: '', visibility: 'shared' });
    setShowForm(false);
    load();
  };

  const del = async (id: number) => {
    if (!confirm('确认删除？')) return;
    await fetch(`/api/knowledge/docs/${id}`, { method: 'DELETE', credentials: 'include' });
    load();
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">本地知识库</h1>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 bg-amber-500 text-white px-4 py-2 rounded text-sm">
          <Plus className="w-4 h-4" /> 新建文档
        </button>
      </div>
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索知识库..."
            className="w-full border border-slate-300 rounded pl-10 pr-4 py-2 text-sm" />
        </div>
      </div>
      {showForm && (
        <div className="bg-white rounded shadow p-4 mb-4 space-y-3">
          <input placeholder="标题" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="border rounded px-3 py-2 text-sm">
              <option value="">无分类</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })} className="border rounded px-3 py-2 text-sm">
              <option value="shared">共享</option><option value="private">仅自己</option>
            </select>
          </div>
          <textarea placeholder="文档内容" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })}
            className="w-full border rounded px-3 py-2 text-sm min-h-[200px]" />
          <div className="flex gap-2">
            <button onClick={create} className="bg-amber-500 text-white px-4 py-2 rounded text-sm">保存</button>
            <button onClick={() => setShowForm(false)} className="border px-4 py-2 rounded text-sm">取消</button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        {docs.map((d) => (
          <div key={d.id} className="bg-white rounded shadow p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-blue-500" />
                <span className="font-medium">{d.title}</span>
              </div>
              <button onClick={() => del(d.id)} className="text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
            </div>
            <div className="text-xs text-slate-400 mb-2">{d.category_name || '未分类'} · {d.creator_name} · {d.visibility === 'private' ? '私有' : '共享'}</div>
            <div className="text-sm text-slate-600 line-clamp-3 whitespace-pre-wrap">{d.content}</div>
          </div>
        ))}
        {docs.length === 0 && <div className="col-span-2 text-center text-slate-400 py-12">暂无文档</div>}
      </div>
    </div>
  );
}
