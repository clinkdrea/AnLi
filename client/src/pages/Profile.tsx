import { useEffect, useState } from 'react';
import { api } from '../api';
import { UserCog, KeyRound, Save } from 'lucide-react';

// 个人信息（所有用户）：查看本人资料 + 自助修改密码
function roleLabel(r: string) {
  return { admin: '管理员', lead: '主办律师', co: '协办律师', assistant: '律师助理' }[r] || r;
}
function statusLabel(s: string) {
  return s === 'active' ? '启用' : '停用';
}

export default function Profile() {
  const [info, setInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/profile')
      .then((d: any) => setInfo(d.user))
      .catch((e: any) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const submit = async () => {
    setMsg(''); setErr('');
    if (!oldPassword || !newPassword || !confirm) { setErr('请填写完整的密码信息'); return; }
    if (newPassword !== confirm) { setErr('两次输入的新密码不一致'); return; }
    setSaving(true);
    try {
      await api('/profile/password', {
        method: 'PUT',
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      setMsg('密码修改成功');
      setOldPassword(''); setNewPassword(''); setConfirm('');
      setTimeout(() => setMsg(''), 3000);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const INPUT = 'w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500';

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2"><UserCog className="w-5 h-5 text-amber-500" /> 个人信息</h1>
        <p className="text-xs text-slate-400 mt-1">查看本人账号信息，并可修改登录密码。</p>
      </div>

      <div className="bg-white rounded-lg shadow p-5">
        <div className="text-sm font-medium text-slate-700 mb-3">基本信息</div>
        {loading ? (
          <div className="text-sm text-slate-400">加载中...</div>
        ) : info ? (
          <div className="grid grid-cols-2 gap-y-3 text-sm">
            <div className="text-slate-400">姓名</div><div className="text-slate-800">{info.name}</div>
            <div className="text-slate-400">账号</div><div className="text-slate-800">{info.account}</div>
            <div className="text-slate-400">角色</div><div className="text-slate-800">{roleLabel(info.role)}</div>
            <div className="text-slate-400">状态</div><div className="text-slate-800">{statusLabel(info.status)}</div>
            <div className="text-slate-400">创建时间</div><div className="text-slate-800">{info.created_at}</div>
          </div>
        ) : (
          <div className="text-sm text-red-500">{err || '加载失败'}</div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-5 mt-5">
        <div className="text-sm font-medium text-slate-700 mb-3 flex items-center gap-1.5">
          <KeyRound className="w-4 h-4 text-amber-500" /> 修改密码
        </div>
        <div className="space-y-3 max-w-md">
          <input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)}
            placeholder="原密码" className={INPUT} autoComplete="current-password" />
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
            placeholder="新密码（至少 6 位）" className={INPUT} autoComplete="new-password" />
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            placeholder="确认新密码" className={INPUT} autoComplete="new-password" />
        </div>
        <div className="flex items-center gap-3 mt-5">
          <button onClick={submit} disabled={saving}
            className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
            <Save className="w-4 h-4" /> {saving ? '提交中...' : '确认修改'}
          </button>
          {msg && <span className="text-green-600 text-sm">{msg}</span>}
          {err && <span className="text-red-500 text-sm">{err}</span>}
        </div>
      </div>
    </div>
  );
}
