import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api } from '../api';
import NewCaseModal from '../components/NewCaseModal';
import { CASE_TYPE_LABELS, CASE_STATUS_LABELS, typeLabel } from '../constants';

const STATUS = CASE_STATUS_LABELS;

export default function Cases() {
  const [params] = useSearchParams();
  const [cases, setCases] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [keyword, setKeyword] = useState(params.get('kw') || '');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');

  const load = (kw = keyword, t = type, s = status) => {
    const p = new URLSearchParams();
    if (kw.trim()) p.set('keyword', kw.trim());
    if (t) p.set('type', t);
    if (s) p.set('status', s);
    const qs = p.toString();
    api('/cases' + (qs ? `?${qs}` : '')).then((r) => setCases(r.cases));
  };
  useEffect(() => { load(keyword); }, []);

  const statusBadge = (s: string) => ({
    active: 'bg-green-100 text-green-700',
    closed: 'bg-slate-200 text-slate-600',
    archived: 'bg-amber-100 text-amber-700',
  }[s] || 'bg-slate-100');

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">案件管理</h1>
        <button onClick={() => setShowNew(true)}
          className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded text-sm">+ 新建案件</button>
      </div>

      {/* 搜索与筛选 */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            placeholder="搜索案件名称 / 编号 / 法院案号 / 法院 / 当事人姓名..."
            className="w-full border border-slate-300 rounded pl-10 pr-3 py-2 text-sm" />
        </div>
        <select value={type} onChange={(e) => { setType(e.target.value); load(keyword, e.target.value, status); }}
          className="border border-slate-300 rounded px-3 py-2 text-sm">
          <option value="">全部类型</option>
          {Object.entries(CASE_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); load(keyword, type, e.target.value); }}
          className="border border-slate-300 rounded px-3 py-2 text-sm">
          <option value="">全部状态</option>
          {Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button onClick={() => load()}
          className="bg-slate-700 hover:bg-slate-800 text-white px-4 py-2 rounded text-sm">查询</button>
        {(keyword || type || status) && (
          <button onClick={() => { setKeyword(''); setType(''); setStatus(''); load('', '', ''); }}
            className="border px-4 py-2 rounded text-sm text-slate-500 hover:bg-slate-50">重置</button>
        )}
      </div>

      <div className="bg-white rounded shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3">案件编号</th>
              <th className="text-left px-4 py-3">案件名称</th>
              <th className="text-left px-4 py-3">类型</th>
              <th className="text-left px-4 py-3">法院</th>
              <th className="text-left px-4 py-3">开庭时间</th>
              <th className="text-left px-4 py-3">主办</th>
              <th className="text-left px-4 py-3">状态</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id} className="border-t hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-500">{c.case_no}</td>
                <td className="px-4 py-3"><Link to={`/cases/${c.id}`} className="text-amber-600 hover:underline">{c.name}</Link></td>
                <td className="px-4 py-3">{typeLabel(c.type)}</td>
                <td className="px-4 py-3 text-slate-500">{c.court || '—'}</td>
                <td className="px-4 py-3 text-slate-500">{c.hearing_date ? c.hearing_date.replace('T', ' ').slice(0, 16) : '—'}</td>
                <td className="px-4 py-3">{c.lead_name}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadge(c.status)}`}>{STATUS[c.status] || c.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {cases.length === 0 && <div className="p-8 text-center text-slate-400">未找到符合条件的案件</div>}
      </div>
      {showNew && <NewCaseModal onClose={() => { setShowNew(false); load(); }} />}
    </div>
  );
}
