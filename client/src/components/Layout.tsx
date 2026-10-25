import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Briefcase, LogOut, Scale, Search, ShieldAlert,
  FileText, BookOpen, Shield, UserCog, ChevronLeft, ChevronRight, ChevronDown, Bot, LayoutGrid, Settings2, Settings, User,
} from 'lucide-react';
import { api } from '../api';
import NotificationBell from './NotificationBell';

export default function Layout({ user, onLogout, children }: any) {
  const loc = useLocation();
  const nav = [
    { to: '/', icon: LayoutDashboard, label: '概览看板' },
    { to: '/cases', icon: Briefcase, label: '案件管理' },
    { to: '/conflicts', icon: ShieldAlert, label: '冲突检索' },
    { to: '/ai-assistant', icon: Bot, label: 'AI 助手' },
    { to: '/search', icon: Search, label: '全文搜索' },
    { to: '/templates', icon: FileText, label: '文书模板' },
    { to: '/knowledge', icon: BookOpen, label: '知识库' },
  ];
  // 系统管理分组（仅管理员可见）：归到可折叠的「系统管理」下
  const sysItems = user.role === 'admin' ? [
    { to: '/audit', icon: Shield, label: '审计日志' },
    { to: '/users', icon: UserCog, label: '用户管理' },
    { to: '/board-templates', icon: LayoutGrid, label: '看板管理' },
    { to: '/settings', icon: Settings2, label: '系统设置' },
  ] : [];
  const sysActive = sysItems.some((n) => loc.pathname === n.to);

  // 「系统管理」分组折叠状态：localStorage 持久化，默认展开
  const [sysOpen, setSysOpen] = useState<boolean>(() => localStorage.getItem('sysmenu_open') !== '0');
  const toggleSys = () => {
    const next = !sysOpen;
    setSysOpen(next);
    localStorage.setItem('sysmenu_open', next ? '1' : '0');
  };

  // 侧边栏折叠状态：localStorage 持久化
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('sidebar_collapsed') === '1';
  });
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('sidebar_collapsed', next ? '1' : '0');
  };

  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // 忽略：即使后端清理失败，前端也必须退出
    } finally {
      onLogout();
    }
  };

  // 单个导航项（indented=分组内的子项）
  const renderItem = (n: any, indented = false) => {
    const active = loc.pathname === n.to;
    return (
      <Link
        key={n.to}
        to={n.to}
        title={collapsed ? n.label : undefined}
        className={`flex items-center text-sm transition-colors
          ${collapsed ? 'justify-center px-0 py-3' : `gap-3 ${indented ? 'pl-4 pr-5' : 'px-5'} py-2.5`}
          ${active
            ? 'bg-slate-800 text-white border-l-2 border-amber-400'
            : 'text-slate-300 hover:bg-slate-800'}
          ${active && collapsed ? 'px-0' : ''}`}
      >
        <n.icon className="w-5 h-5 shrink-0" />
        {!collapsed && <span className="truncate">{n.label}</span>}
      </Link>
    );
  };

  return (
    <div className="flex h-screen">
      <aside
        className={`bg-slate-900 text-slate-100 flex flex-col transition-all duration-200 ${collapsed ? 'w-16' : 'w-56'}`}
      >
        {/* 品牌区：折叠后只显示图标 */}
        <div className={`border-b border-slate-700 ${collapsed ? 'py-4 flex justify-center' : 'px-5 py-4'}`}>
          {collapsed ? (
            <Scale className="w-6 h-6 text-amber-400 shrink-0" />
          ) : (
            <div className="flex items-center gap-2">
              <Scale className="w-6 h-6 text-amber-400" />
              <span className="font-bold text-lg">案理</span>
            </div>
          )}
          {!collapsed && <div className="text-xs text-slate-400 mt-1">律师案件协作平台</div>}
        </div>

        {/* 导航 */}
        <nav className="flex-1 py-4 overflow-x-hidden">
          {nav.map((n) => renderItem(n))}

          {sysItems.length > 0 && (
            <div className="mt-2 border-t border-slate-700 pt-2">
              {collapsed ? (
                // 折叠态：不显示分组标题，直接展示图标
                sysItems.map((n) => renderItem(n))
              ) : (
                <>
                  <button
                    onClick={toggleSys}
                    className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors
                      ${sysActive ? 'text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                  >
                    <Settings className="w-5 h-5 shrink-0" />
                    <span className="truncate flex-1 text-left">系统管理</span>
                    {sysOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  {sysOpen && (
                    <div className="ml-5 border-l border-slate-700">
                      {sysItems.map((n) => renderItem(n, true))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </nav>

        {/* 底部：用户信息 + 退出 */}
        <div className={`border-t border-slate-700 ${collapsed ? 'p-3' : 'p-4'}`}>
          {collapsed ? (
            <div className="flex flex-col items-center gap-3">
              <Link to="/profile" title="个人信息" className="text-slate-400 hover:text-white">
                <User className="w-4 h-4" />
              </Link>
              <button
                onClick={logout}
                title="退出登录"
                className="text-slate-400 hover:text-white"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div>
              <Link to="/profile" title="查看个人信息" className="block group">
                <div className="flex items-center gap-1.5 text-sm truncate group-hover:text-amber-400">
                  <User className="w-4 h-4 shrink-0 text-slate-400 group-hover:text-amber-400" />
                  <span className="truncate">{user.name}</span>
                </div>
                <div className="text-xs text-slate-400">{roleLabel(user.role)}</div>
              </Link>
              <button onClick={logout} className="mt-2 flex items-center gap-1 text-xs text-slate-400 hover:text-white">
                <LogOut className="w-3 h-3" /> 退出登录
              </button>
            </div>
          )}
        </div>

        {/* 折叠/展开切换按钮：贴在底部上沿 */}
        <button
          onClick={toggleCollapsed}
          title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          className="border-t border-slate-700 py-2 flex justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
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
