import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api('/dashboard').then(setData); }, []);
  if (!data) return <div className="p-8">加载中...</div>;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">概览看板</h1>
      <div className="grid grid-cols-3 gap-6">
        <Card title="我的待办">
          {data.myTasks.length === 0 && <Empty />}
          {data.myTasks.map((t: any) => (
            <div key={t.id} className="py-2 border-b last:border-0">
              <div className="font-medium">{t.title}</div>
              <div className="text-xs text-slate-500">{t.case_name} · 截止 {t.due_date || '未设'}</div>
            </div>
          ))}
        </Card>
        <Card title="即将到期（3天内）">
          {data.upcoming.length === 0 && <Empty />}
          {data.upcoming.map((d: any) => (
            <div key={d.id} className="py-2 border-b last:border-0">
              <div className="font-medium">{d.type}</div>
              <div className="text-xs text-slate-500">{d.case_name} · {d.due_at}</div>
            </div>
          ))}
        </Card>
        <Card title="最新评论动态">
          {data.recentComments.length === 0 && <Empty />}
          {data.recentComments.map((c: any) => (
            <div key={c.id} className="py-2 border-b last:border-0">
              <div className="text-sm">{c.content}</div>
              <div className="text-xs text-slate-500">{c.author_name} · {c.case_name}</div>
            </div>
          ))}
        </Card>
      </div>
      <div className="mt-8">
        <h2 className="text-lg font-bold mb-3">我的案件</h2>
        <div className="bg-white rounded shadow">
          {data.myCases.map((c: any) => (
            <Link key={c.id} to={`/cases/${c.id}`}
              className="flex items-center justify-between px-4 py-3 border-b last:border-0 hover:bg-slate-50">
              <div>
                <span className="font-medium">{c.name}</span>
                <span className="ml-2 text-xs text-slate-400">{c.case_no}</span>
              </div>
              <span className="text-xs text-slate-500">{c.type} · {statusLabel(c.status)}</span>
            </Link>
          ))}
          {data.myCases.length === 0 && <div className="p-6 text-center text-slate-400">暂无案件</div>}
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: any) {
  return (
    <div className="bg-white rounded shadow p-4">
      <h3 className="font-bold mb-3 text-slate-700">{title}</h3>
      {children}
    </div>
  );
}
function Empty() { return <div className="text-slate-400 text-sm py-4 text-center">暂无</div>; }
function statusLabel(s: string) { return { active: '办理中', closed: '已结案', archived: '已归档' }[s] || s; }
