import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Briefcase, LogOut, Scale, Search, ShieldAlert, FileText, BookOpen, Shield } from 'lucide-react';
import { api } from '../api';
import NotificationBell from './NotificationBell';

export default function Layout({ user, onLogout, children }: any) {
  const loc = useLocation();
  const nav = [
    { to: '/', icon: LayoutDashboard, label: '概览看板' },
    { to: '/cases', icon: Briefcase, label: '案件管理' },
    { to: '/conflicts', icon: ShieldAlert, label: '冲突检索' },
    { to: '/search', icon: Search, label: '全文搜索' },
    { to: '/templates', icon: FileText, label: '文书模板' },
    { to: '/knowledge', icon: BookOpen, label: '知识库' },
  ];
  if (user.role === 'admin') {
    nav.push({ to: '/audit', icon: Shield, label: '审计日志' });
  }
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    onLogout();
  };
  return (
    <div className="flex h-screen">
      <aside className="w-56 bg-slate-900 text-slate-100 flex flex-col">
        <div className="px-5 py-4 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <Scale className="w-6 h-6 text-amber-400" />
            <span className="font-bold text-lg">案理</span>
          </div>
          <div className="text-xs text-slate-400 mt-1">律师案件协作平台</div>
        </div>
        <nav className="flex-1 py-4">
          {nav.map((n) => {
            const active = loc.pathname === n.to;
            return (
              <Link key={n.to} to={n.to}
                className={`flex items-center gap-3 px-5 py-2.5 text-sm ${active ? 'bg-slate-800 text-white border-l-2 border-amber-400' : 'text-slate-300 hover:bg-slate-800'}`}>
                <n.icon className="w-4 h-4" /> {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-slate-700">
          <div className="text-sm">{user.name}</div>
          <div className="text-xs text-slate-400">{roleLabel(user.role)}</div>
          <button onClick={logout} className="mt-2 flex items-center gap-1 text-xs text-slate-400 hover:text-white">
            <LogOut className="w-3 h-3" /> 退出登录
          </button>
        </div>
      </aside>
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b px-6 py-3 flex items-center justify-end">
          <NotificationBell />
        </header>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

function roleLabel(r: string) {
  return { admin: '管理员', lead: '主办律师', co: '协办律师', assistant: '律师助理' }[r] || r;
}
