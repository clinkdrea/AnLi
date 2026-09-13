import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, PanelRightClose, PanelRightOpen, Pencil, X, Plus } from 'lucide-react';
import { api } from '../api';
import FilesTab from '../components/case/FilesTab';
import BoardTab from '../components/case/BoardTab';
import TimelineTab from '../components/case/TimelineTab';
import TasksTab from '../components/case/TasksTab';
import CommentsTab from '../components/case/CommentsTab';
import EvidencesTab from '../components/case/EvidencesTab';
import ContactsTab from '../components/case/ContactsTab';
import AITab from '../components/case/AITab';

const TABS = ['看板', '资料', '证据清单', '任务', '时间轴', '联系人', '概览'];

export default function CaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState(0);
  const [err, setErr] = useState('');
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<'comments' | 'ai'>('comments');

  const load = () => api(`/cases/${id}`).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]);

  if (err) return <div className="p-8 text-red-500">{err}</div>;
  if (!data) return <div className="p-8">加载中...</div>;

  const c = data.case;
  const legal = data.legal;
  return (
    <div className="flex h-full overflow-hidden">
      {/* 主区 */}
      <div className="flex-1 min-w-0 overflow-y-auto p-8">
        <div className="flex items-baseline gap-3 mb-1">
          <button onClick={() => navigate(-1)}
            title="返回"
            className="self-center text-slate-400 hover:text-amber-600 p-1 -ml-2">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-bold">{c.name}</h1>
          <span className="text-slate-400 text-sm">{c.case_no}</span>
          {legal?.court_case_no && <span className="text-slate-400 text-sm">案号 {legal.court_case_no}</span>}
          <a href={`/api/cases/${id}/export`}
            className="ml-auto self-center text-sm px-3 py-1 border border-slate-300 rounded hover:bg-slate-50">
            导出案件
          </a>
          <button onClick={() => setPanelOpen(!panelOpen)}
            title={panelOpen ? '收起侧栏' : '展开侧栏'}
            className="self-center text-slate-400 hover:text-amber-600 p-1">
            {panelOpen ? <PanelRightClose className="w-5 h-5" /> : <PanelRightOpen className="w-5 h-5" />}
          </button>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500 mb-4">
          {c.court && <span>法院：{c.court}</span>}
          {c.hearing_date && <span>开庭时间：{c.hearing_date.replace('T', ' ').slice(0, 16)}</span>}
          {legal?.cause && <span>案由：{legal.cause}</span>}
          <span>状态：{c.status === 'active' ? '办理中' : c.status === 'closed' ? '已结案' : '已归档'}</span>
        </div>

        <div className="flex gap-2 border-b">
          {TABS.map((t, i) => (
            <button key={t} onClick={() => setTab(i)}
              className={`px-4 py-2 text-sm ${tab === i ? 'border-b-2 border-amber-500 text-amber-600 font-medium' : 'text-slate-500'}`}>
              {t}
            </button>
          ))}
        </div>
        <div className="mt-4">
          {tab === 0 && <BoardTab caseId={id!} />}
          {tab === 1 && <FilesTab caseId={id!} onChanged={load} />}
          {tab === 2 && <EvidencesTab caseId={id!} />}
          {tab === 3 && <TasksTab caseId={id!} />}
          {tab === 4 && <TimelineTab caseId={id!} />}
          {tab === 5 && <ContactsTab caseId={id!} parties={data.parties} onChanged={load} />}
          {tab === 6 && <Overview data={data} onChanged={load} onGoBoard={() => setTab(0)} onGoContacts={() => setTab(5)} />}
        </div>
      </div>

      {/* 右侧面板：评论 / AI 双 Tab，可收起 */}
      {panelOpen && (
        <aside className="w-[380px] shrink-0 border-l border-slate-200 bg-white flex flex-col">
          <div className="flex border-b">
            <button onClick={() => setPanelTab('comments')}
              className={`flex-1 px-4 py-2.5 text-sm ${panelTab === 'comments' ? 'border-b-2 border-amber-500 text-amber-600 font-medium' : 'text-slate-500'}`}>
              评论
            </button>
            <button onClick={() => setPanelTab('ai')}
              className={`flex-1 px-4 py-2.5 text-sm ${panelTab === 'ai' ? 'border-b-2 border-amber-500 text-amber-600 font-medium' : 'text-slate-500'}`}>
              AI 助手
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            {panelTab === 'comments' ? <CommentsTab caseId={id!} /> : <AITab caseId={id!} />}
          </div>
        </aside>
      )}
    </div>
  );
}

function Overview({ data, onChanged, onGoBoard, onGoContacts }: any) {
  const { case: c, parties, stages, members, legal } = data;
  const [me, setMe] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', court: '', hearing_date: '', cause: '', court_case_no: '', summary: '' });
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [pick, setPick] = useState('');
  const [memberMsg, setMemberMsg] = useState('');

  useEffect(() => { api('/auth/me').then((r) => setMe(r.user)).catch(() => {}); }, []);

  const canManageMembers = !!me && (me.role === 'admin' || c.lead_id === me.id);

  const startEdit = () => {
    setFormErr('');
    setForm({
      name: c.name || '',
      court: c.court || '',
      hearing_date: c.hearing_date ? c.hearing_date.slice(0, 16) : '',
      cause: legal?.cause || '',
      court_case_no: legal?.court_case_no || '',
      summary: c.summary || '',
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!form.name.trim()) { setFormErr('案件名称必填'); return; }
    setSaving(true); setFormErr('');
    try {
      await api(`/cases/${c.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...form, name: form.name.trim(), hearing_date: form.hearing_date || null }),
      });
      setEditing(false);
      onChanged?.();
    } catch (e: any) {
      setFormErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const openAdd = async () => {
    setShowAdd(true); setPick(''); setMemberMsg('');
    try {
      const d = await api('/users/assignable');
      setCandidates((d.users || []).filter((u: any) => !members.some((m: any) => m.id === u.id)));
    } catch (e: any) {
      setMemberMsg(e.message);
    }
  };

  const addMember = async () => {
    if (!pick) return;
    try {
      await api(`/cases/${c.id}/members`, { method: 'POST', body: JSON.stringify({ user_id: Number(pick) }) });
      setShowAdd(false);
      onChanged?.();
    } catch (e: any) {
      setMemberMsg(e.message);
    }
  };

  const removeMember = async (uid: number, name: string) => {
    if (!confirm(`确认移除成员「${name}」？`)) return;
    try {
      await api(`/cases/${c.id}/members/${uid}`, { method: 'DELETE' });
      onChanged?.();
    } catch (e: any) {
      setMemberMsg(e.message);
    }
  };

  const inputCls = 'border border-slate-300 rounded px-2 py-1.5 text-sm w-full focus:outline-none focus:border-amber-500';

  return (
    <div className="grid grid-cols-3 gap-6">
      <div className="col-span-2 bg-white rounded shadow p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold">基本信息</h3>
          {!editing ? (
            <button onClick={startEdit}
              className="flex items-center gap-1 text-xs text-amber-600 hover:underline">
              <Pencil className="w-3.5 h-3.5" /> 编辑
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={saveEdit} disabled={saving}
                className="text-xs px-3 py-1 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded">
                {saving ? '保存中...' : '保存'}
              </button>
              <button onClick={() => setEditing(false)}
                className="text-xs px-3 py-1 border border-slate-300 rounded hover:bg-slate-50">
                取消
              </button>
            </div>
          )}
        </div>
        {!editing ? (
          <>
            <div className="grid grid-cols-2 gap-y-2 text-sm">
              <Info label="案件名称" value={c.name} />
              <Info label="内部编号" value={c.case_no} />
              <Info label="法院案号" value={legal?.court_case_no} />
              <Info label="受理法院" value={c.court} />
              <Info label="开庭时间" value={c.hearing_date?.replace('T', ' ').slice(0, 16)} />
              <Info label="案由" value={legal?.cause} />
            </div>
            {c.summary && (
              <>
                <h3 className="font-bold mt-5 mb-2">案情简介</h3>
                <p className="text-sm text-slate-600 whitespace-pre-wrap">{c.summary}</p>
              </>
            )}
          </>
        ) : (
          <div className="space-y-3">
            {formErr && <div className="text-sm text-red-500">{formErr}</div>}
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="text-slate-500 block mb-1">案件名称 <span className="text-red-500">*</span></span>
                <input className={inputCls} value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label className="text-sm">
                <span className="text-slate-500 block mb-1">受理法院</span>
                <input className={inputCls} value={form.court}
                  onChange={(e) => setForm({ ...form, court: e.target.value })} />
              </label>
              <label className="text-sm">
                <span className="text-slate-500 block mb-1">法院案号</span>
                <input className={inputCls} value={form.court_case_no}
                  onChange={(e) => setForm({ ...form, court_case_no: e.target.value })} />
              </label>
              <label className="text-sm">
                <span className="text-slate-500 block mb-1">开庭时间</span>
                <input type="datetime-local" className={inputCls} value={form.hearing_date}
                  onChange={(e) => setForm({ ...form, hearing_date: e.target.value })} />
              </label>
              <label className="text-sm col-span-2">
                <span className="text-slate-500 block mb-1">案由</span>
                <input className={inputCls} value={form.cause}
                  onChange={(e) => setForm({ ...form, cause: e.target.value })} />
              </label>
              <label className="text-sm col-span-2">
                <span className="text-slate-500 block mb-1">案情简介</span>
                <textarea rows={4} className={inputCls} value={form.summary}
                  onChange={(e) => setForm({ ...form, summary: e.target.value })} />
              </label>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between mt-5 mb-3">
          <h3 className="font-bold">阶段流程</h3>
          <button onClick={onGoBoard}
            className="text-xs text-amber-600 hover:underline">
            前往看板管理 →
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {stages.map((s: any, i: number) => (
            <span key={s.id} className="px-3 py-1 bg-slate-100 rounded text-sm text-slate-600">
              {i + 1}. {s.name}
            </span>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-2">共 {stages.length} 个阶段 · 阶段与案情记录均可在看板中拖拽调整</p>
      </div>
      <div className="bg-white rounded shadow p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold">案件成员</h3>
          {canManageMembers && !showAdd && (
            <button onClick={openAdd}
              className="flex items-center gap-1 text-xs text-amber-600 hover:underline">
              <Plus className="w-3.5 h-3.5" /> 添加成员
            </button>
          )}
        </div>
        {showAdd && (
          <div className="mb-3 p-3 border rounded bg-slate-50">
            <select value={pick} onChange={(e) => setPick(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1.5 text-sm w-full mb-2">
              <option value="">选择要添加的用户…</option>
              {candidates.map((u: any) => (
                <option key={u.id} value={u.id}>{u.name}（{roleLabel(u.role)}）</option>
              ))}
            </select>
            {candidates.length === 0 && !memberMsg && (
              <p className="text-xs text-slate-400 mb-1">所有用户均已是案件成员</p>
            )}
            {memberMsg && <p className="text-xs text-red-500 mb-1">{memberMsg}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAdd(false)}
                className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-white">取消</button>
              <button onClick={addMember} disabled={!pick}
                className="text-xs px-2 py-1 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded">确定</button>
            </div>
          </div>
        )}
        {members.map((m: any) => (
          <div key={m.id} className="flex items-center text-sm py-1 group">
            <span>{m.name}</span>
            <span className="text-slate-400 text-xs ml-1">
              ({roleLabel(m.role)}{m.id === c.lead_id ? ' · 主办' : ''})
            </span>
            {canManageMembers && m.id !== c.lead_id && (
              <button onClick={() => removeMember(m.id, m.name)} title="移除成员"
                className="ml-auto text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
        <h3 className="font-bold mt-5 mb-3">联系人概要</h3>
        {parties.slice(0, 8).map((p: any) => (
          <div key={p.id} className="text-sm py-0.5 truncate">
            <span className="text-slate-400 text-xs">{sideLabel(p.side)}</span> {p.name}
          </div>
        ))}
        <button onClick={onGoContacts}
          className="mt-2 text-xs text-amber-600 hover:underline">
          前往联系人管理 →
        </button>
      </div>
    </div>
  );
}
function Info({ label, value }: any) {
  return (
    <div>
      <span className="text-slate-400 mr-2">{label}</span>
      <span className="text-slate-700">{value || '—'}</span>
    </div>
  );
}
function sideLabel(s: string) { return SIDE_LABELS[s] || s; }
export const SIDE_LABELS: Record<string, string> = {
  our: '我方当事人', opponent: '对方当事人', third: '第三人', court: '法院人员', contact: '其他联系人',
};
function roleLabel(r: string) { return { admin: '管理员', lead: '主办', co: '协办', assistant: '助理' }[r] || r; }
