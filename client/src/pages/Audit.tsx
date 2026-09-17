import { useEffect, useState } from 'react';
import { Shield } from 'lucide-react';
import Pagination from '../components/Pagination';

const PAGE_SIZE = 20;

export default function AuditPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = (p = page) => {
    const params = new URLSearchParams();
    if (action) params.set('action', action);
    params.set('page', String(p));
    params.set('pageSize', String(PAGE_SIZE));
    fetch(`/api/audit/logs?${params.toString()}`, { credentials: 'include' })
      .then((r) => r.json()).then((d) => { setLogs(d.logs || []); setTotal(d.total || 0); });
    fetch('/api/audit/stats', { credentials: 'include' }).then((r) => r.json()).then(setStats);
  };
  // 操作筛选变化时回到第一页
  useEffect(() => { setPage(1); load(1); }, [action]);
  const goPage = (p: number) => { setPage(p); load(p); };

  const actionLabels: Record<string, string> = {
    login: '登录', logout: '登出', case_create: '创建案件', case_close: '结案',
    file_upload: '上传文件', file_download: '下载文件', file_delete: '删除文件',
    note_create: '创建案情', conflict_check: '冲突检索', task_create: '创建任务',
    comment_create: '发表评论', user_create: '创建用户', cases_import: '导入案件',
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Shield className="w-6 h-6 text-amber-500" /> 审计日志
      </h1>
      {stats && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded shadow p-4">
            <h3 className="text-sm text-slate-500 mb-2">操作类型分布</h3>
            {stats.byAction.slice(0, 8).map((s: any) => (
              <div key={s.action} className="flex justify-between text-sm py-0.5">
                <span>{actionLabels[s.action] || s.action}</span>
                <span className="text-slate-400">{s.count}</span>
              </div>
            ))}
          </div>
          <div className="bg-white rounded shadow p-4">
            <h3 className="text-sm text-slate-500 mb-2">用户操作 Top</h3>
            {stats.byUser.slice(0, 8).map((s: any) => (
              <div key={s.name} className="flex justify-between text-sm py-0.5">
                <span>{s.name}</span>
                <span className="text-slate-400">{s.count}</span>
              </div>
            ))}
          </div>
          <div className="bg-white rounded shadow p-4">
            <h3 className="text-sm text-slate-500 mb-2">近 7 天操作量</h3>
            {stats.recent7Days.map((d: any) => (
              <div key={d.day} className="flex justify-between text-sm py-0.5">
                <span>{d.day}</span>
                <span className="text-slate-400">{d.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="bg-white rounded shadow overflow-hidden">
        <div className="p-3 border-b flex gap-2">
          <select value={action} onChange={(e) => setAction(e.target.value)} className="border rounded px-3 py-1.5 text-sm">
            <option value="">全部操作</option>
            {Object.entries(actionLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3">时间</th>
              <th className="text-left px-4 py-3">用户</th>
              <th className="text-left px-4 py-3">操作</th>
              <th className="text-left px-4 py-3">对象</th>
              <th className="text-left px-4 py-3">详情</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="px-4 py-2 text-slate-500">{l.created_at}</td>
                <td className="px-4 py-2">{l.user_name || '系统'}</td>
                <td className="px-4 py-2">{actionLabels[l.action] || l.action}</td>
                <td className="px-4 py-2 text-slate-500">{l.object_type}#{l.object_id || '-'}</td>
                <td className="px-4 py-2 text-slate-500">{l.detail || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {logs.length === 0 && <div className="p-8 text-center text-slate-400">暂无日志</div>}
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={goPage} />
      </div>
    </div>
  );
}
