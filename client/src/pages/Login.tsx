import { useState } from 'react';
import { Scale } from 'lucide-react';
import { api } from '../api';

export default function Login({ onLogin }: any) {
  const [account, setAccount] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setErr('');
    try {
      const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ account, password }) });
      onLogin(r.user);
    } catch (e: any) {
      setErr(e.message);
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
      <div className="bg-white rounded-lg shadow-xl p-8 w-96">
        <div className="flex items-center gap-2 mb-6 justify-center">
          <Scale className="w-8 h-8 text-amber-500" />
          <h1 className="text-2xl font-bold text-slate-800">案理</h1>
        </div>
        <p className="text-center text-sm text-slate-500 mb-6">律师案件协作平台</p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-600 mb-1">账号</label>
            <input value={account} onChange={(e) => setAccount(e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2 focus:outline-none focus:border-amber-500" />
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1">密码</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2 focus:outline-none focus:border-amber-500" />
          </div>
          {err && <div className="text-red-500 text-sm">{err}</div>}
          <button disabled={loading}
            className="w-full bg-amber-500 hover:bg-amber-600 text-white py-2 rounded font-medium disabled:opacity-50">
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
        <p className="text-xs text-slate-400 mt-4 text-center">默认管理员 admin / admin123</p>
      </div>
    </div>
  );
}
