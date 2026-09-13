import { useState } from 'react';
import { api } from '../api';

const TYPES = [
  { v: 'civil', l: '民事' }, { v: 'criminal', l: '刑事' }, { v: 'administrative', l: '行政' },
  { v: 'arbitration', l: '仲裁' }, { v: 'enforcement', l: '执行' },
  { v: 'nonlitigation', l: '非诉专项' }, { v: 'legal_advisor', l: '常年法律顾问' }, { v: 'other', l: '其他' },
];

export default function NewCaseModal({ onClose }: any) {
  const [name, setName] = useState('');
  const [type, setType] = useState('civil');
  const [ourName, setOurName] = useState('');
  const [oppName, setOppName] = useState('');
  const [cause, setCause] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!name || !ourName || !oppName) { setErr('案件名称、我方/对方当事人为必填'); return; }
    setLoading(true);
    try {
      await api('/cases', {
        method: 'POST',
        body: JSON.stringify({
          name, type,
          parties: { our: { name: ourName, party_type: 'natural' }, opponent: { name: oppName, party_type: 'natural' } },
          legal: { cause },
        }),
      });
      onClose();
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-[600px] max-h-[90vh] overflow-auto">
        <h2 className="text-xl font-bold mb-4">新建案件</h2>
        <div className="space-y-4">
          <Field label="案件名称">
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
          </Field>
          <Field label="案件类型">
            <select value={type} onChange={(e) => setType(e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm">
              {TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="我方当事人（必填）">
              <input value={ourName} onChange={(e) => setOurName(e.target.value)}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
            </Field>
            <Field label="对方当事人（必填）">
              <input value={oppName} onChange={(e) => setOppName(e.target.value)}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
            </Field>
          </div>
          <Field label="案由">
            <input value={cause} onChange={(e) => setCause(e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
          </Field>
        </div>
        {err && <div className="text-red-500 text-sm mt-3">{err}</div>}
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 border rounded text-sm">取消</button>
          <button onClick={submit} disabled={loading}
            className="px-4 py-2 bg-amber-500 text-white rounded text-sm disabled:opacity-50">
            {loading ? '创建中...' : '创建案件'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: any) {
  return <div><label className="block text-sm text-slate-600 mb-1">{label}</label>{children}</div>;
}
