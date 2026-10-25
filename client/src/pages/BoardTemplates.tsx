import { useEffect, useState } from 'react';
import { api } from '../api';
import { Plus, Trash2, Pencil, X, LayoutGrid, ChevronUp, ChevronDown } from 'lucide-react';

// 看板模板管理（仅管理员）：维护案件看板的阶段列模板，新建案件时可选用
export default function BoardTemplates() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(null); // {id?, name, stages[]}
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => api('/board-templates').then((d: any) => setTemplates(d.templates || [])).catch((e: any) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing({ name: '', stages: ['接案准备', '办理中', '结案'] }); setErr(''); };
  const openEdit = (t: any) => { setEditing({ id: t.id, name: t.name, stages: [...t.stages] }); setErr(''); };

  const save = async () => {
    if (!editing) return;
    setSaving(true); setErr('');
    try {
      if (editing.id) await api(`/board-templates/${editing.id}`, { method: 'PUT', body: JSON.stringify(editing) });
      else await api('/board-templates', { method: 'POST', body: JSON.stringify(editing) });
      setEditing(null);
      setMsg('已保存');
      load();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const del = async (t: any) => {
    if (!confirm(`确认删除模板「${t.name}」？已有案件不受影响。`)) return;
    try { await api(`/board-templates/${t.id}`, { method: 'DELETE' }); setMsg('已删除'); load(); }
    catch (e: any) { setErr(e.message); }
  };

  const updStage = (i: number, v: string) =>
    setEditing((e: any) => ({ ...e, stages: e.stages.map((s: string, j: number) => (j === i ? v : s)) }));
  const addStage = () => setEditing((e: any) => ({ ...e, stages: [...e.stages, ''] }));
  const delStage = (i: number) => setEditing((e: any) => ({ ...e, stages: e.stages.filter((_: string, j: number) => j !== i) }));
  const moveStage = (i: number, dir: -1 | 1) => setEditing((e: any) => {
    const arr = [...e.stages];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return e;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return { ...e, stages: arr };
  });

  const input = 'border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-amber-500';

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><LayoutGrid className="w-5 h-5 text-amber-500" /> 看板管理</h1>
          <p className="text-xs text-slate-400 mt-1">定义案件看板的阶段列；新建案件时可选用。已有案件使用的是复制值，修改模板不影响。</p>
        </div>
        <button onClick={openNew} className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 rounded text-sm">
          <Plus className="w-4 h-4" /> 新建模板
        </button>
      </div>
      {msg && <div className="text-green-600 text-sm mb-3">{msg}</div>}
      {err && !editing && <div className="text-red-500 text-sm mb-3">{err}</div>}

      {/* 编辑/新建表单 */}
      {editing && (
        <div className="bg-white rounded-lg shadow p-5 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold">{editing.id ? '编辑模板' : '新建模板'}</h2>
            <button onClick={() => setEditing(null)} className="text-slate-400"><X className="w-5 h-5" /></button>
          </div>
          <div className="mb-3">
            <label className="text-sm text-slate-600 block mb-1">模板名称<span className="text-red-500 ml-0.5">*</span></label>
            <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="如：民事一审标准流程" className={`${input} w-72`} />
          </div>
          <label className="text-sm text-slate-600 block mb-1">
            阶段列<span className="text-red-500 ml-0.5">*</span>
            <span className="text-slate-400 text-xs ml-2">从左到右排列，2~20 个</span>
          </label>
          <div className="space-y-2">
            {editing.stages.map((s: string, i: number) => (
              <div key={i} className="flex gap-2 items-center">
                <span className="text-xs text-slate-400 w-6 text-right">{i + 1}.</span>
                <input value={s} onChange={(e) => updStage(i, e.target.value)}
                  placeholder={`阶段 ${i + 1} 名称`} className={`${input} flex-1 max-w-xs`} />
                <button onClick={() => moveStage(i, -1)} disabled={i === 0} title="上移"
                  className="p-1 text-slate-400 hover:text-amber-600 disabled:opacity-30"><ChevronUp className="w-4 h-4" /></button>
                <button onClick={() => moveStage(i, 1)} disabled={i === editing.stages.length - 1} title="下移"
                  className="p-1 text-slate-400 hover:text-amber-600 disabled:opacity-30"><ChevronDown className="w-4 h-4" /></button>
                <button onClick={() => delStage(i)} disabled={editing.stages.length <= 2} title="删除阶段"
                  className="p-1 text-slate-400 hover:text-red-500 disabled:opacity-30"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
          <button onClick={addStage} className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 mt-2">
            <Plus className="w-3.5 h-3.5" /> 添加阶段
          </button>
          {err && <div className="text-red-500 text-sm mt-2">{err}</div>}
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setEditing(null)} className="px-4 py-2 border rounded text-sm">取消</button>
            <button onClick={save} disabled={saving || !editing.name.trim()}
              className="px-4 py-2 bg-amber-500 text-white rounded text-sm disabled:opacity-50">{saving ? '保存中...' : '保存'}</button>
          </div>
        </div>
      )}

      {/* 模板列表 */}
      <div className="bg-white rounded shadow overflow-hidden">
        {templates.map((t) => (
          <div key={t.id} className="px-4 py-3 border-b last:border-0 flex items-center gap-3 hover:bg-slate-50">
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm flex items-center gap-2">
                {t.name}
                {t.is_default && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">默认</span>
                )}
              </div>
              <div className="text-xs text-slate-400 mt-0.5 truncate">
                {t.stages.join(' → ')}
                <span className="ml-2 text-slate-300">（{t.stages.length} 列{t.creator_name ? ` · ${t.creator_name} 创建` : ''}）</span>
              </div>
            </div>
            <button onClick={() => openEdit(t)} className="text-slate-400 hover:text-amber-600 p-1" title={t.is_default ? '默认模板仅可修改' : '编辑'}><Pencil className="w-4 h-4" /></button>
            {!t.is_default && (
              <button onClick={() => del(t)} className="text-slate-400 hover:text-red-600 p-1" title="删除"><Trash2 className="w-4 h-4" /></button>
            )}
          </div>
        ))}
        {templates.length === 0 && (
          <div className="p-10 text-center text-slate-400 text-sm">「看板管理」暂无模板，点击右上角「新建模板」创建</div>
        )}
      </div>
    </div>
  );
}
