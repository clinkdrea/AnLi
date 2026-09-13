import { useState } from 'react';
import { Plus, Trash2, Pencil, X, Check, Phone, MapPin, Building2, IdCard } from 'lucide-react';
import { api } from '../../api';

const CATEGORIES = [
  { v: 'our', l: '我方当事人' },
  { v: 'opponent', l: '对方当事人' },
  { v: 'third', l: '第三人' },
  { v: 'court', l: '法院人员' },
  { v: 'contact', l: '其他联系人' },
];
const SIDE_CLS: Record<string, string> = {
  our: 'bg-green-100 text-green-700',
  opponent: 'bg-red-100 text-red-700',
  third: 'bg-blue-100 text-blue-700',
  court: 'bg-purple-100 text-purple-700',
  contact: 'bg-slate-100 text-slate-600',
};
const INPUT = 'border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400';

interface Party {
  id: number; side: string; name: string; party_type: string;
  id_number?: string; phone?: string; address?: string;
  organization?: string; role?: string; remark?: string;
}
const empty = (category = 'contact') => ({
  category, name: '', party_type: 'natural', id_number: '', phone: '', address: '', organization: '', role: '', remark: '',
});

export default function ContactsTab({ caseId, parties, onChanged }: {
  caseId: string; parties: Party[]; onChanged: () => void;
}) {
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<any>(empty());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [err, setErr] = useState('');

  const shown = parties.filter((p) => filter === 'all' || p.side === filter);

  const submitAdd = async () => {
    if (!form.name.trim()) { setErr('请填写姓名/名称'); return; }
    await api(`/cases/${caseId}/parties`, { method: 'POST', body: JSON.stringify(form) });
    setAdding(false); setForm(empty()); setErr(''); onChanged();
  };
  const startEdit = (p: Party) => {
    setEditingId(p.id);
    setEditForm({
      name: p.name, party_type: p.party_type, id_number: p.id_number || '', phone: p.phone || '',
      address: p.address || '', organization: p.organization || '', role: p.role || '', remark: p.remark || '',
    });
  };
  const submitEdit = async () => {
    if (!editForm.name.trim()) return;
    await api(`/parties/${editingId}`, { method: 'PUT', body: JSON.stringify(editForm) });
    setEditingId(null); onChanged();
  };
  const del = async (p: Party) => {
    if (!confirm(`确认删除联系人「${p.name}」？`)) return;
    await api(`/parties/${p.id}`, { method: 'DELETE' }); onChanged();
  };

  const FormFields = ({ v, set, isCourt }: any) => (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap">
        <input value={v.name} onChange={(e) => set({ ...v, name: e.target.value })} placeholder="姓名 / 名称 *"
          className={`${INPUT} flex-1 min-w-[120px]`} />
        {!isCourt && (
          <select value={v.party_type} onChange={(e) => set({ ...v, party_type: e.target.value })}
            className="border border-slate-300 rounded px-2 py-1.5 text-sm">
            <option value="natural">自然人</option>
            <option value="legal">法人/组织</option>
          </select>
        )}
        {isCourt && (
          <input value={v.role} onChange={(e) => set({ ...v, role: e.target.value })} placeholder="职务（如审判长）"
            className={`${INPUT} w-44`} />
        )}
      </div>
      <div className="flex gap-2 flex-wrap">
        <input value={v.phone} onChange={(e) => set({ ...v, phone: e.target.value })} placeholder="电话"
          className={`${INPUT} flex-1 min-w-[110px]`} />
        <input value={v.id_number} onChange={(e) => set({ ...v, id_number: e.target.value })}
          placeholder={v.party_type === 'legal' && !isCourt ? '统一社会信用代码' : '身份证号'}
          className={`${INPUT} flex-1 min-w-[150px]`} />
        {!isCourt && (
          <input value={v.organization} onChange={(e) => set({ ...v, organization: e.target.value })} placeholder="工作单位"
            className={`${INPUT} flex-1 min-w-[110px]`} />
        )}
      </div>
      <div className="flex gap-2">
        <input value={v.address} onChange={(e) => set({ ...v, address: e.target.value })} placeholder="地址"
          className={`${INPUT} flex-1`} />
        <input value={v.remark} onChange={(e) => set({ ...v, remark: e.target.value })} placeholder="备注"
          className={`${INPUT} flex-1`} />
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          <button onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded text-sm ${filter === 'all' ? 'bg-amber-500 text-white' : 'bg-white border hover:bg-slate-50'}`}>
            全部 ({parties.length})
          </button>
          {CATEGORIES.map((cat) => {
            const n = parties.filter((p) => p.side === cat.v).length;
            return (
              <button key={cat.v} onClick={() => setFilter(cat.v)}
                className={`px-3 py-1.5 rounded text-sm ${filter === cat.v ? 'bg-amber-500 text-white' : 'bg-white border hover:bg-slate-50'}`}>
                {cat.l} ({n})
              </button>
            );
          })}
        </div>
        <button onClick={() => { setAdding(!adding); setForm(empty(filter === 'all' ? 'contact' : filter)); }}
          className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded text-sm">
          <Plus className="w-4 h-4" /> 添加联系人
        </button>
      </div>

      {adding && (
        <div className="bg-white rounded shadow p-4 mb-4 space-y-2">
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="border border-slate-300 rounded px-2 py-1.5 text-sm mb-1">
            {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
          </select>
          <FormFields v={form} set={setForm} isCourt={form.category === 'court'} />
          {err && <div className="text-red-500 text-xs">{err}</div>}
          <div className="flex gap-2 justify-end">
            <button onClick={submitAdd} className="bg-amber-500 text-white px-3 py-1.5 rounded text-sm flex items-center gap-1"><Check className="w-4 h-4" /> 保存</button>
            <button onClick={() => { setAdding(false); setErr(''); }} className="border px-3 py-1.5 rounded text-sm flex items-center gap-1"><X className="w-4 h-4" /> 取消</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded shadow overflow-hidden">
        {shown.map((p) => (
          <div key={p.id} className="px-4 py-3 border-b last:border-0 hover:bg-slate-50">
            {editingId === p.id ? (
              <div className="space-y-2">
                <FormFields v={editForm} set={setEditForm} isCourt={p.side === 'court'} />
                <div className="flex gap-2 justify-end">
                  <button onClick={submitEdit} className="text-green-600 p-1"><Check className="w-4 h-4" /></button>
                  <button onClick={() => setEditingId(null)} className="text-slate-400 p-1"><X className="w-4 h-4" /></button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${SIDE_CLS[p.side] || 'bg-slate-100'}`}>
                  {CATEGORIES.find((c) => c.v === p.side)?.l || p.side}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{p.name}</span>
                    <span className="text-xs text-slate-400">{p.party_type === 'legal' ? '法人/组织' : '自然人'}</span>
                    {p.role && <span className="text-xs text-purple-600">{p.role}</span>}
                  </div>
                  <div className="flex gap-x-4 gap-y-0.5 flex-wrap mt-1 text-xs text-slate-500">
                    {p.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{p.phone}</span>}
                    {p.id_number && <span className="flex items-center gap-1"><IdCard className="w-3 h-3" />{p.id_number}</span>}
                    {p.organization && <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{p.organization}</span>}
                    {p.address && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{p.address}</span>}
                    {p.remark && <span className="text-slate-400">备注：{p.remark}</span>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => startEdit(p)} className="text-slate-400 hover:text-amber-600 p-1"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => del(p)} className="text-slate-400 hover:text-red-600 p-1"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            )}
          </div>
        ))}
        {shown.length === 0 && (
          <div className="p-10 text-center text-slate-400 text-sm">暂无联系人，点击右上角「添加联系人」</div>
        )}
      </div>
    </div>
  );
}
