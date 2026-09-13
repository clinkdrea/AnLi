import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, AlertCircle } from 'lucide-react';

const TYPE_LABELS: Record<string, string> = {
  case: '案件', note: '案情记录', comment: '评论', file: '文件',
};

export default function SearchPage() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searched, setSearched] = useState(false);

  const doSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    const r = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { credentials: 'include' })
      .then((res) => res.json());
    setResults(r.results || []);
    setSearched(true);
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">全文搜索</h1>
      <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-6 flex gap-2 text-sm text-amber-800">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>搜索范围仅限您参与的案件。接案前如需核查对方当事人是否与本所历史案件存在利益冲突，请使用【利益冲突检索】功能。</span>
      </div>
      <form onSubmit={doSearch} className="flex gap-2 mb-6">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索案件名称、案情记录、评论、文件名..."
            className="w-full border border-slate-300 rounded pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-amber-500" />
        </div>
        <button type="submit" className="bg-amber-500 hover:bg-amber-600 text-white px-6 py-2 rounded text-sm">搜索</button>
      </form>
      {searched && (
        <div className="mb-3 text-sm text-slate-500">共找到 {results.length} 条结果</div>
      )}
      <div className="space-y-2">
        {results.map((r, i) => (
          <Link key={i} to={`/cases/${r.case_id}`}
            className="block bg-white rounded shadow px-4 py-3 hover:bg-slate-50">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs px-2 py-0.5 bg-slate-100 rounded text-slate-600">{TYPE_LABELS[r.type]}</span>
              <span className="text-xs text-slate-400">{r.sub}</span>
            </div>
            <div className="text-sm">{r.title}</div>
          </Link>
        ))}
        {searched && results.length === 0 && (
          <div className="text-center text-slate-400 py-8">未找到匹配结果</div>
        )}
      </div>
    </div>
  );
}
