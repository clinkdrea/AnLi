import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import NewCaseModal from '../components/NewCaseModal';

const TYPES: Record<string, string> = {
  civil: '民事', civil_appeal: '民事二审', civil_retrial: '民事再审', criminal: '刑事',
  administrative: '行政', arbitration: '仲裁', enforcement: '执行',
  nonlitigation: '非诉专项', legal_advisor: '常年法律顾问', other: '其他',
};

export default function Cases() {
  const [cases, setCases] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);

  const load = () => api('/cases').then((r) => setCases(r.cases));
  useEffect(() => { load(); }, []);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">案件管理</h1>
        <button onClick={() => setShowNew(true)}
          className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded text-sm">+ 新建案件</button>
      </div>
      <div className="bg-white rounded shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3">案件编号</th>
              <th className="text-left px-4 py-3">案件名称</th>
              <th className="text-left px-4 py-3">类型</th>
              <th className="text-left px-4 py-3">主办</th>
              <th className="text-left px-4 py-3">状态</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id} className="border-t hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-500">{c.case_no}</td>
                <td className="px-4 py-3"><Link to={`/cases/${c.id}`} className="text-amber-600 hover:underline">{c.name}</Link></td>
                <td className="px-4 py-3">{TYPES[c.type] || c.type}</td>
                <td className="px-4 py-3">{c.lead_name}</td>
                <td className="px-4 py-3">{statusLabel(c.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {cases.length === 0 && <div className="p-8 text-center text-slate-400">暂无案件</div>}
      </div>
      {showNew && <NewCaseModal onClose={() => { setShowNew(false); load(); }} />}
    </div>
  );
}
function statusLabel(s: string) { return { active: '办理中', closed: '已结案', archived: '已归档' }[s] || s; }
