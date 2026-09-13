import { useEffect, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const load = () => fetch('/api/notifications', { credentials: 'include' })
    .then((r) => r.json()).then((d) => { setNotifications(d.notifications || []); setUnread(d.unreadCount || 0); });

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  const markAllRead = async () => {
    await fetch('/api/notifications/read-all', { method: 'POST', credentials: 'include' });
    load();
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="relative p-2 text-slate-300 hover:text-white">
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border z-50 max-h-96 overflow-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <span className="font-medium text-sm">通知</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-amber-600 hover:underline flex items-center gap-1">
                <CheckCheck className="w-3 h-3" /> 全部已读
              </button>
            )}
          </div>
          <div>
            {notifications.length === 0 && (
              <div className="text-center text-slate-400 py-8 text-sm">暂无通知</div>
            )}
            {notifications.map((n) => (
              <div key={n.id} className={`px-4 py-3 border-b last:border-0 hover:bg-slate-50 ${n.is_read ? 'opacity-60' : ''}`}>
                <div className="text-sm">{n.content}</div>
                <div className="text-xs text-slate-400 mt-1">{n.created_at}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
