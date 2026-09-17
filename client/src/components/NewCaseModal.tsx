import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import { CASE_TYPES } from '../constants';

const CATEGORIES = [
  { v: 'our', l: '我方当事人' },
  { v: 'opponent', l: '对方当事人' },
  { v: 'third', l: '第三人' },
  { v: 'court', l: '法院人员' },
  { v: 'contact', l: '其他联系人' },
];
interface Contact {
  category: string; name: string; party_type: string; id_number: string;
  phone: string; address: string; organization: string; role: string; remark: string;
}
const emptyContact = (category = 'contact'): Contact => ({
  category, name: '', party_type: 'natural', id_number: '',
  phone: '', address: '', organization: '', role: '', remark: '',
});
const INPUT = 'border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400';
const inputCls = (err?: string) => (err ? `${INPUT} border-red-400 ring-1 ring-red-200` : INPUT);

export default function NewCaseModal({ onClose }: any) {
  const [name, setName] = useState('');
  const [type, setType] = useState('civil');
  const [courtCaseNo, setCourtCaseNo] = useState('');
  const [court, setCourt] = useState('');
  const [hearingAt, setHearingAt] = useState('');
  const [cause, setCause] = useState('');
  const [summary, setSummary] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([emptyContact('our'), emptyContact('opponent')]);
  const [errors, setErrors] = useState<any>({});
  const [loading, setLoading] = useState(false);

  const upd = (i: number, k: keyof Contact, v: string) =>
    setContacts((cs) => cs.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  const addContact = () => setContacts((cs) => [...cs, emptyContact()]);
  const delContact = (i: number) => setContacts((cs) => cs.filter((_, j) => j !== i));
  const clearErr = (k: string) => setErrors((p: any) => { const n = { ...p }; delete n[k]; return n; });
  const clearContactErr = (i: number) => setErrors((p: any) => {
    if (!p.contacts) return p;
    const arr = { ...p.contacts }; delete arr[i]; return { ...p, contacts: arr };
  });

  const validate = () => {
    const e: any = {};
    if (!name.trim()) e.name = '请输入案件名称';
    if (!hearingAt) e.hearing = '请选择开庭时间（开庭将自动记入待办）';
    if (!contacts.some((c) => c.category === 'our' && c.name.trim())) e.our = '请填写我方当事人姓名/名称';
    if (!contacts.some((c) => c.category === 'opponent' && c.name.trim())) e.opponent = '请填写对方当事人姓名/名称';
    const cerr: any = {};
    contacts.forEach((c, i) => {
      const hasAny = c.phone.trim() || c.id_number.trim() || c.organization.trim() || c.address.trim() || c.role.trim();
      if (hasAny && !c.name.trim()) cerr[i] = '请填写姓名/名称';
    });
    if (Object.keys(cerr).length) e.contacts = cerr;
    return e;
  };

  const submit = async () => {
    const e = validate();
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    setLoading(true);
    try {
      await api('/cases', {
        method: 'POST',
        body: JSON.stringify({
          name, type,
          legal: { cause, court_case_no: courtCaseNo, court, hearing_at: hearingAt || null, summary },
          contacts,
        }),
      });
      onClose();
    } catch (err: any) { setErrors({ submit: err.message }); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-[720px] max-h-[90vh] overflow-auto">
        <h2 className="text-xl font-bold mb-4">新建案件</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="案件名称" required error={errors.name}>
              <input value={name} onChange={(e) => { setName(e.target.value); clearErr('name'); }}
                placeholder="如：张三诉某某公司买卖合同纠纷"
                className={`w-full ${inputCls(errors.name)}`} />
            </Field>
            <Field label="案件类型" required>
              <select value={type} onChange={(e) => setType(e.target.value)} className={`w-full ${INPUT}`}>
                {CASE_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
            </Field>
            <Field label="案号">
              <input value={courtCaseNo} onChange={(e) => setCourtCaseNo(e.target.value)}
                placeholder="如：(2026)京01民初123号" className={`w-full ${INPUT}`} />
            </Field>
            <Field label="受理法院">
              <input value={court} onChange={(e) => setCourt(e.target.value)}
                placeholder="如：北京市第一中级人民法院" className={`w-full ${INPUT}`} />
            </Field>
            <Field label="开庭时间" required error={errors.hearing}>
              <input type="datetime-local" value={hearingAt}
                onChange={(e) => { setHearingAt(e.target.value); clearErr('hearing'); }}
                className={`w-full ${inputCls(errors.hearing)}`} />
            </Field>
            <Field label="案由">
              <input value={cause} onChange={(e) => setCause(e.target.value)}
                placeholder="如：买卖合同纠纷" className={`w-full ${INPUT}`} />
            </Field>
          </div>
          <Field label="案情简介">
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3}
              placeholder="简述案件事实与委托事项..." className={`w-full ${INPUT}`} />
          </Field>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-slate-600">
                当事人 / 联系人信息<span className="text-red-500 ml-0.5">*</span>
                <span className="text-slate-400 text-xs ml-2">我方与对方当事人必填</span>
              </label>
              <button type="button" onClick={addContact}
                className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700">
                <Plus className="w-3.5 h-3.5" /> 添加联系人
              </button>
            </div>
            {(errors.our || errors.opponent) && (
              <div className="text-red-500 text-xs mb-2 space-y-0.5">
                {errors.our && <div>{errors.our}</div>}
                {errors.opponent && <div>{errors.opponent}</div>}
              </div>
            )}
            <div className="space-y-2">
              {contacts.map((c, i) => {
                const cerr = errors.contacts?.[i];
                return (
                  <div key={i} className="border border-slate-200 rounded p-3 space-y-2 bg-slate-50/50">
                    <div className="flex gap-2 flex-wrap">
                      <select value={c.category} onChange={(e) => upd(i, 'category', e.target.value)}
                        className="border border-slate-300 rounded px-2 py-1.5 text-sm">
                        {CATEGORIES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                      </select>
                      <input value={c.name} onChange={(e) => { upd(i, 'name', e.target.value); clearContactErr(i); }}
                        placeholder="姓名 / 名称 *"
                        className={`border rounded px-2 py-1.5 text-sm flex-1 min-w-[120px] focus:outline-none focus:ring-1 focus:ring-amber-400 ${cerr ? 'border-red-400 ring-1 ring-red-200' : 'border-slate-300'}`} />
                      {c.category !== 'court' && (
                        <select value={c.party_type} onChange={(e) => upd(i, 'party_type', e.target.value)}
                          className="border border-slate-300 rounded px-2 py-1.5 text-sm">
                          <option value="natural">自然人</option>
                          <option value="legal">法人/组织</option>
                        </select>
                      )}
                      {c.category === 'court' && (
                        <input value={c.role} onChange={(e) => upd(i, 'role', e.target.value)}
                          placeholder="职务（如审判长）" className="border border-slate-300 rounded px-2 py-1.5 text-sm w-40" />
                      )}
                      {contacts.length > 2 && (
                        <button type="button" onClick={() => delContact(i)}
                          className="text-red-400 hover:text-red-600 p-1.5"><Trash2 className="w-4 h-4" /></button>
                      )}
                    </div>
                    {cerr && <div className="text-red-500 text-xs">{cerr}</div>}
                    <div className="flex gap-2 flex-wrap">
                      <input value={c.phone} onChange={(e) => upd(i, 'phone', e.target.value)}
                        placeholder="电话" className="border border-slate-300 rounded px-2 py-1.5 text-sm flex-1 min-w-[120px]" />
                      <input value={c.id_number} onChange={(e) => upd(i, 'id_number', e.target.value)}
                        placeholder={c.party_type === 'legal' && c.category !== 'court' ? '统一社会信用代码' : '身份证号'}
                        className="border border-slate-300 rounded px-2 py-1.5 text-sm flex-1 min-w-[160px]" />
                      {c.category !== 'court' && (
                        <input value={c.organization} onChange={(e) => upd(i, 'organization', e.target.value)}
                          placeholder="工作单位" className="border border-slate-300 rounded px-2 py-1.5 text-sm flex-1 min-w-[120px]" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {errors.submit && <div className="text-red-500 text-sm mt-3">{errors.submit}</div>}
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

function Field({ label, required, error, children }: any) {
  return (
    <div>
      <label className="block text-sm text-slate-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && <div className="text-red-500 text-xs mt-1">{error}</div>}
    </div>
  );
}
