import { useEffect, useState } from 'react';
import { api } from '../api';
import { Plus, KeyRound, Trash2, Pencil, X, UserCog } from 'lucide-react';

const ROLES = [
  { v: 'admin', l: '管理员' },
  { v: 'lead', l: '主办律师' },
  { v: 'co', l: '协办律师' },
  { v: 'assistant', l: '律师助理/实习律师' },
];
const roleLabel = (r: string) => ROLES.find((x) => x.v === r)?.l || r;

export default function Users() {
  const [users, setUsers] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = () => api('/users').then((d) => setUsers(d.users || [])).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const create = async (form: any) => {
    setErr('');
    try {
      await api('/users', { method: 'POST', body: JSON.stringify(form) });
      setShowNew(false);
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const saveEdit = async (u: any) => {
    setErr('');
    try {
      await api(`/users/${u.id}`, { method: 'PUT', body: JSON.stringify({ name: u.name, role: u.role }) });
      setEditing(null);
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const resetPassword = async (u: any) => {
    const pwd = prompt(`为「${u.name}」设置新密码（至少 6 位）：`);
    if (!pwd) return;
    setMsg('');
    try {
      await api(`/users/${u.id}/password`, { method: 'PUT', body: JSON.stringify({ password: pwd }) });
      setMsg(`已重置「${u.name}」的密码`);
    } catch (e: any) { setErr(e.message); }
  };

  const toggleStatus = async (u: any) => {
    const next = u.status === 'active' ? 'disabled' : 'active';
    setErr('');
    try {
      await api(`/users/${u.id}`, { method: 'PUT', body: JSON.stringify({ status: next }) });
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const del = async (u: any) => {
    if (!confirm(`确认删除账号「${u.name}」？此操作不可恢复。`)) return;
    setErr('');
    try {
      await api(`/users/${u.id}`, { method: 'DELETE' });
      load();
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><UserCog className="w-6 h-6 text-amber-500" /> 用户管理</h1>
        <button onClick={() => { setShowNew(true); setErr(''); }}
          className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded text-sm flex items-center gap-1">
          <Plus className="w-4 h-4" /> 新建账号
        </button>
      </div>
      {msg && <div className="mb-3 text-sm text-green-600 bg-green-50 border border-green-200 rounded px-3 py-2">{msg}</div>}
      {err && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}

      <div className="bg-white rounded shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3">姓名</th>
              <th className="text-left px-4 py-3">账号</th>
              <th className="text-left px-4 py-3">角色</th>
              <th className="text-left px-4 py-3">状态</th>
              <th className="text-left px-4 py-3">创建时间</th>
              <th className="text-left px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3 text-slate-500">{u.account}</td>
                <td className="px-4 py-3">{roleLabel(u.role)}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${u.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-500'}`}>
                    {u.status === 'active' ? '启用' : '停用'}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs">{u.created_at}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <button title="编辑姓名/角色" onClick={() => { setEditing({ ...u }); setErr(''); }}
                      className="text-slate-400 hover:text-amber-600"><Pencil className="w-4 h-4" /></button>
                    <button title="重置密码" onClick={() => resetPassword(u)}
                      className="text-slate-400 hover:text-amber-600"><KeyRound className="w-4 h-4" /></button>
                    <button title={u.status === 'active' ? '停用' : '启用'} onClick={() => toggleStatus(u)}
                      className="text-slate-400 hover:text-blue-600">
                      {u.status === 'active'
                        ? <span className="text-xs">停用</span>
                        : <span className="text-xs">启用</span>}
                    </button>
                    <button title="删除" onClick={() => del(u)}
                      className="text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && <div className="p-8 text-center text-slate-400">暂无用户</div>}
      </div>

      {showNew && <NewUserModal onClose={() => setShowNew(false)} onCreate={create} />}
      {editing && <EditUserModal user={editing} onClose={() => setEditing(null)} onSave={saveEdit} />}
    </div>
  );
}

function NewUserModal({ onClose, onCreate }: any) {
  const [name, setName] = useState('');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('co');
  const [err, setErr] = useState('');
  const submit = () => {
    if (!name.trim() || !account.trim() || !password) { setErr('姓名、账号、密码为必填'); return; }
    if (password.length < 6) { setErr('密码至少 6 位'); return; }
    onCreate({ name: name.trim(), account: account.trim(), password, role });
  };
  return (
    <Modal title="新建账号" onClose={onClose} onSubmit={submit} err={err}>
      <Field label="姓名"><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></Field>
      <Field label="登录账号"><input value={account} onChange={(e) => setAccount(e.target.value)} className={inputCls} /></Field>
      <Field label="初始密码"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} /></Field>
      <Field label="角色">
        <select value={role} onChange={(e) => setRole(e.target.value)} className={inputCls}>
          {ROLES.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
        </select>
      </Field>
    </Modal>
  );
}

function EditUserModal({ user, onClose, onSave }: any) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState(user.role);
  const [err, setErr] = useState('');
  const submit = () => {
    if (!name.trim()) { setErr('姓名必填'); return; }
    onSave({ id: user.id, name: name.trim(), role });
  };
  return (
    <Modal title={`编辑：${user.name}（${user.account}）`} onClose={onClose} onSubmit={submit} err={err}>
      <Field label="姓名"><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></Field>
      <Field label="角色">
        <select value={role} onChange={(e) => setRole(e.target.value)} className={inputCls}>
          {ROLES.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
        </select>
      </Field>
    </Modal>
  );
}

const inputCls = 'w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-400';

function Modal({ title, onClose, onSubmit, children, err }: any) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg p-6 w-[420px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">{children}</div>
        {err && <div className="text-red-500 text-sm mt-3">{err}</div>}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 border rounded text-sm">取消</button>
          <button onClick={onSubmit} className="px-4 py-2 bg-amber-500 text-white rounded text-sm">保存</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: any) {
  return <div><label className="block text-sm text-slate-600 mb-1">{label}</label>{children}</div>;
}
