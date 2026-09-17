import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';

const PAGE_SIZE = 20;

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const offsetRef = useRef(0);

  // 加载第一页
  const load = () => fetch(`/api/notifications?limit=${PAGE_SIZE}`, { credentials: 'include' })
    .then((r) => r.json()).then((d) => {
      const list = d.notifications || [];
      setNotifications(list);
      setUnread(d.unreadCount || 0);
      offsetRef.current = list.length;
      setHasMore(list.length >= (d.limit || PAGE_SIZE));
    });

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  const markAllRead = async () => {
    await fetch('/api/notifications/read-all', { method: 'POST', credentials: 'include' });
    load();
  };

  // 加载更多
  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const r = await fetch(`/api/notifications?limit=${PAGE_SIZE}&offset=${offsetRef.current}`, { credentials: 'include' });
      const d = await r.json();
      const list = d.notifications || [];
      setNotifications((prev) => [...prev, ...list]);
      offsetRef.current += list.length;
      setHasMore(list.length >= (d.limit || PAGE_SIZE));
    } finally {
      setLoadingMore(false);
    }
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
            {notifications.length > 0 && hasMore && (
              <button onClick={loadMore} disabled={loadingMore}
                className="w-full py-2 text-center text-xs text-amber-600 hover:bg-amber-50 disabled:opacity-50">
                {loadingMore ? '加载中...' : '加载更多'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
