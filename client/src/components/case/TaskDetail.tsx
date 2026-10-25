import { useEffect, useState } from 'react';
import { X, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { api } from '../../api';
import CommentsTab from './CommentsTab';
import AssigneeSelect, { isTaskOverdue } from './AssigneeSelect';

const INPUT = 'border border-slate-300 rounded px-2.5 py-1.5 text-sm w-full focus:outline-none focus:ring-1 focus:ring-amber-400';
const STATUS_LABEL: Record<string, string> = { todo: '待处理', doing: '进行中', done: '已完成', expired: '已过期' };

export default function TaskDetail({ taskId, onClose, onChanged }: {
  taskId: number;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [task, setTask] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('todo');
  const [priority, setPriority] = useState('medium');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<number[]>([]);

  const load = async () => {
    const d = await api(`/tasks/${taskId}/detail`);
    const t = d.task;
    setTask(t);
    setTitle(t.title || '');
    setStatus(t.status || 'todo');
    setPriority(t.priority || 'medium');
    setStartDate(t.start_date ? t.start_date.slice(0, 16) : '');
    setDueDate(t.due_date ? t.due_date.slice(0, 16) : '');
    setDescription(t.description || '');
    setAssigneeIds((t.assignees || []).map((a: any) => a.id));
  };

  useEffect(() => {
    Promise.all([load().catch((e) => setErr(e.message)), api('/users/assignable').catch(() => ({ users: [] }))])
      .then(([, ud]) => setUsers((ud as any).users || []));
  }, [taskId]);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    if (!title.trim()) { setErr('任务标题必填'); return; }
    setSaving(true); setErr('');
    try {
      await api(`/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: title.trim(), status, priority,
          start_date: startDate || null, due_date: dueDate || null,
          description: description || null,
          assignee_ids: assigneeIds,
        }),
      });
      await load();
      onChanged?.();
    } catch (e: any) {
      setErr(e.message);
    } finally { setSaving(false); }
  };

  const del = async () => {
    if (!confirm(`确认删除任务「${task?.title}」？`)) return;
    await api(`/tasks/${taskId}`, { method: 'DELETE' });
    onChanged?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-6" onMouseDown={onClose}>
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl h-[86vh] flex flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200 shrink-0">
          <h2 className="font-bold text-lg">任务详情</h2>
          {task?.case_name && <span className="text-xs text-slate-400">所属案件：{task.case_name}</span>}
          {task?.stage_name && <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">{task.stage_name}</span>}
          <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-600 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {!task ? (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            {err ? <span className="text-red-500">{err}</span> : <Loader2 className="w-6 h-6 animate-spin" />}
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex">
            {/* 左：字段编辑 */}
            <div className="w-[46%] shrink-0 overflow-y-auto p-5 border-r border-slate-200">
              {err && <div className="mb-3 text-sm text-red-500 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}
              <div className="space-y-4">
                <label className="block">
                  <span className="text-sm text-slate-500 block mb-1">标题 <span className="text-red-500">*</span></span>
                  <input className={INPUT} value={title} onChange={(e) => setTitle(e.target.value)} />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-sm text-slate-500 block mb-1">状态</span>
                    <select className={INPUT} value={status} onChange={(e) => setStatus(e.target.value)}>
                      <option value="todo">{STATUS_LABEL.todo}</option>
                      <option value="doing">{STATUS_LABEL.doing}</option>
                      <option value="done">{STATUS_LABEL.done}</option>
                      {status === 'expired' && <option value="expired">{STATUS_LABEL.expired}</option>}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm text-slate-500 block mb-1">优先级</span>
                    <select className={INPUT} value={priority} onChange={(e) => setPriority(e.target.value)}>
                      <option value="high">高</option>
                      <option value="medium">中</option>
                      <option value="low">低</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm text-slate-500 block mb-1">开始时间</span>
                    <input type="datetime-local" className={INPUT} value={startDate}
                      onChange={(e) => setStartDate(e.target.value)} />
                  </label>
                  <label className="block">
                    <span className="text-sm text-slate-500 block mb-1">截止时间</span>
                    <input type="datetime-local" className={INPUT} value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)} />
                  </label>
                </div>
                {isTaskOverdue(status, dueDate) && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    该任务尚未完成且已过截止时间，请及时跟进或将状态更新为已完成
                  </div>
                )}

                <div>
                  <span className="text-sm text-slate-500 block mb-1">任务处理人（可多选）</span>
                  <AssigneeSelect
                    users={users.map((u) => ({ id: u.id, name: u.name, role: u.role === 'admin' ? '管理员' : '成员' }))}
                    value={assigneeIds} onChange={setAssigneeIds} />
                  {assigneeIds.length === 0 && <p className="text-xs text-red-400 mt-1">至少保留一名处理人</p>}
                </div>

                <label className="block">
                  <span className="text-sm text-slate-500 block mb-1">任务描述</span>
                  <textarea rows={5} className={INPUT} value={description}
                    onChange={(e) => setDescription(e.target.value)} placeholder="补充任务背景、交付要求等…" />
                </label>

                <div className="text-xs text-slate-400">
                  创建于 {task.created_at?.replace('T', ' ').slice(0, 16)}
                  {task.completed_at && ` · 完成于 ${String(task.completed_at).replace('T', ' ').slice(0, 16)}`}
                </div>

                <div className="flex items-center pt-2">
                  <button onClick={del}
                    className="flex items-center gap-1 text-sm text-red-500 hover:bg-red-50 px-3 py-1.5 rounded">
                    <Trash2 className="w-4 h-4" /> 删除任务
                  </button>
                  <button onClick={save} disabled={saving || !title.trim() || assigneeIds.length === 0}
                    className="ml-auto bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm px-5 py-1.5 rounded">
                    {saving ? '保存中…' : '保存'}
                  </button>
                </div>
              </div>
            </div>

            {/* 右：任务评论（固定归属本任务） */}
            <div className="flex-1 min-w-0 h-full">
              {task.case_id && (
                <CommentsTab caseId={String(task.case_id)} fixedTarget={{ type: 'task', id: task.id }} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
