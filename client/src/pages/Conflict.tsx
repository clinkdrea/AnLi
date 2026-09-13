import { useState } from 'react';
import { AlertTriangle, ShieldAlert, AlertCircle, CheckCircle, FileText } from 'lucide-react';

const RISK_INFO: Record<string, { label: string; color: string; icon: any }> = {
  forbidden: { label: '禁止代理', color: 'text-red-600 bg-red-50 border-red-200', icon: ShieldAlert },
  consent: { label: '须告知并取得书面同意', color: 'text-amber-600 bg-amber-50 border-amber-200', icon: AlertTriangle },
  caution: { label: '审慎评估', color: 'text-blue-600 bg-blue-50 border-blue-200', icon: AlertCircle },
  safe: { label: '未发现冲突', color: 'text-green-600 bg-green-50 border-green-200', icon: CheckCircle },
};

export default function ConflictPage() {
  const [opponent, setOpponent] = useState('');
  const [related, setRelated] = useState('');
  const [cause, setCause] = useState('');
  const [courtNo, setCourtNo] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const check = async () => {
    if (!opponent.trim()) return;
    setLoading(true);
    const relatedParties = related.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean).map((name) => ({ name }));
    const r = await fetch('/api/conflicts/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ opponent_name: opponent, related_parties: relatedParties, cause, court_case_no: courtNo }),
    }).then((res) => res.json());
    setResult(r);
    setLoading(false);
  };

  const conclude = async (conclusion: string) => {
    if (!result) return;
    const remark = conclusion === 'accept_no_conflict' && result.overall === 'forbidden'
      ? prompt('存在禁止代理情形，请填写处理说明：') : '';
    if (remark === null) return;
    await fetch(`/api/conflicts/${result.report_id}/conclusion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ conclusion, remark }),
    });
    alert('处理结论已记录');
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-2">利益冲突检索</h1>
      <p className="text-sm text-slate-500 mb-6">接案前核查对方当事人是否与本所历史案件存在利益冲突，仅检索案件元数据，不泄露案情内容。</p>

      <div className="bg-white rounded shadow p-6 mb-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-slate-600 mb-1">对方当事人（必填）</label>
            <input value={opponent} onChange={(e) => setOpponent(e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm" placeholder="如：B" />
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1">法院案号</label>
            <input value={courtNo} onChange={(e) => setCourtNo(e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm" placeholder="未立案可后补" />
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1">案由</label>
            <input value={cause} onChange={(e) => setCause(e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm" placeholder="如：合同纠纷" />
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1">关联主体（逗号分隔）</label>
            <input value={related} onChange={(e) => setRelated(e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm" placeholder="近亲属、关联企业等" />
          </div>
        </div>
        <button onClick={check} disabled={loading || !opponent.trim()}
          className="mt-4 bg-amber-500 hover:bg-amber-600 text-white px-6 py-2 rounded text-sm disabled:opacity-50">
          {loading ? '检索中...' : '发起冲突检索'}
        </button>
      </div>

      {result && (
        <div className="bg-white rounded shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-lg">检索报告 #{result.report_id}</h3>
            {(() => {
              const info = RISK_INFO[result.overall];
              const Icon = info.icon;
              return (
                <span className={`px-3 py-1 rounded border text-sm font-medium flex items-center gap-1 ${info.color}`}>
                  <Icon className="w-4 h-4" /> {info.label}
                </span>
              );
            })()}
          </div>

          <div className="space-y-3 mb-6">
            {result.hits.length === 0 && <div className="text-slate-400 text-center py-4">未命中任何历史案件</div>}
            {result.hits.map((h: any, i: number) => {
              const info = RISK_INFO[h.level];
              const Icon = info.icon;
              return (
                <div key={i} className="border rounded p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">{h.case_name}（{h.case_no}）</span>
                    <span className={`px-2 py-0.5 rounded text-xs ${info.color}`}><Icon className="w-3 h-3 inline" /> {info.label}</span>
                  </div>
                  <div className="text-sm text-slate-500 space-y-1">
                    <div>命中主体：{h.matched_name}（{h.side === 'our' ? '我方' : h.side === 'opponent' ? '对方' : '关联'}）</div>
                    <div>案由：{h.cause || '-'} | 案号：{h.court_case_no || '-'} | 状态：{h.status === 'active' ? '办理中' : '已结案'}</div>
                    <div>承办人：{h.lead_name || '-'} | 结案日：{h.close_date || '-'}</div>
                    <div className="text-slate-700 mt-1">判定：{h.reason}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t pt-4">
            <h4 className="font-medium mb-2">处理结论（主办律师填写，留痕）</h4>
            <div className="flex gap-2">
              <button onClick={() => conclude('accept_no_conflict')} className="px-3 py-1.5 border rounded text-sm hover:bg-slate-50">已确认无冲突，同意接案</button>
              <button onClick={() => conclude('accept_with_consent')} className="px-3 py-1.5 border rounded text-sm hover:bg-slate-50">已告知并取得书面同意</button>
              <button onClick={() => conclude('decline')} className="px-3 py-1.5 border rounded text-sm hover:bg-slate-50 text-red-600">放弃接受委托</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
