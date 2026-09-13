import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import FilesTab from '../components/case/FilesTab';
import NotesTab from '../components/case/NotesTab';
import TimelineTab from '../components/case/TimelineTab';
import TasksTab from '../components/case/TasksTab';
import CommentsTab from '../components/case/CommentsTab';
import EvidencesTab from '../components/case/EvidencesTab';
import AITab from '../components/case/AITab';

const TABS = ['概览', '案情记录', '资料', '证据清单', '时间轴', '评论', '任务', 'AI助手', '冲突报告'];

export default function CaseDetail() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState(0);
  const [err, setErr] = useState('');

  useEffect(() => { api(`/cases/${id}`).then(setData).catch((e) => setErr(e.message)); }, [id]);

  if (err) return <div className="p-8 text-red-500">{err}</div>;
  if (!data) return <div className="p-8">加载中...</div>;

  const c = data.case;
  return (
    <div className="p-8">
      <div className="flex items-baseline gap-3 mb-1">
        <h1 className="text-2xl font-bold">{c.name}</h1>
        <span className="text-slate-400 text-sm">{c.case_no}</span>
        <a href={`/api/cases/${id}/export`}
          className="ml-auto text-sm px-3 py-1 border border-slate-300 rounded hover:bg-slate-50">
          导出案件
        </a>
      </div>
      <div className="flex gap-2 border-b mt-4">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2 text-sm ${tab === i ? 'border-b-2 border-amber-500 text-amber-600 font-medium' : 'text-slate-500'}`}>
            {t}
          </button>
        ))}
      </div>
      <div className="mt-6">
        {tab === 0 && <Overview data={data} />}
        {tab === 1 && <NotesTab caseId={id!} />}
        {tab === 2 && <FilesTab caseId={id!} />}
        {tab === 3 && <EvidencesTab caseId={id!} />}
        {tab === 4 && <TimelineTab caseId={id!} />}
        {tab === 5 && <CommentsTab caseId={id!} />}
        {tab === 6 && <TasksTab caseId={id!} />}
        {tab === 7 && <AITab caseId={id!} />}
        {tab === 8 && (
          <div className="text-slate-400 p-8 text-center">
            冲突报告请前往「利益冲突检索」页面发起，<a href="/conflicts" className="text-amber-600 underline">点击进入</a>
          </div>
        )}
      </div>
    </div>
  );
}

function Overview({ data }: any) {
  const { case: c, parties, stages, members } = data;
  return (
    <div className="grid grid-cols-3 gap-6">
      <div className="col-span-2 bg-white rounded shadow p-5">
        <h3 className="font-bold mb-3">当事人信息</h3>
        <div className="space-y-2 text-sm">
          {parties.map((p: any) => (
            <div key={p.id} className="flex gap-3">
              <span className="text-slate-500 w-20">{sideLabel(p.side)}</span>
              <span className="font-medium">{p.name}</span>
              <span className="text-slate-400">({p.party_type === 'natural' ? '自然人' : '法人'})</span>
            </div>
          ))}
        </div>
        <h3 className="font-bold mt-6 mb-3">阶段流程</h3>
        <div className="flex gap-2 flex-wrap">
          {stages.map((s: any) => (
            <span key={s.id} className="px-3 py-1 bg-slate-100 rounded text-sm">{s.name}</span>
          ))}
        </div>
      </div>
      <div className="bg-white rounded shadow p-5">
        <h3 className="font-bold mb-3">案件成员</h3>
        {members.map((m: any) => (
          <div key={m.id} className="text-sm py-1">{m.name} <span className="text-slate-400 text-xs">({roleLabel(m.role)})</span></div>
        ))}
      </div>
    </div>
  );
}
function sideLabel(s: string) { return { our: '我方', opponent: '对方', third: '第三人' }[s] || s; }
function roleLabel(r: string) { return { admin: '管理员', lead: '主办', co: '协办', assistant: '助理' }[r] || r; }
