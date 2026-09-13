import { useEffect, useState, useRef } from 'react';
import { Plus, Trash2, Pencil, X, Check, GripVertical, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../../api';

const INPUT = 'border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400';

export default function BoardTab({ caseId }: { caseId: string }) {
  const [stages, setStages] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // 表单/编辑状态
  const [editingStage, setEditingStage] = useState<number | null>(null);
  const [stageName, setStageName] = useState('');
  const [newStageName, setNewStageName] = useState('');
  const [showAddStage, setShowAddStage] = useState(false);
  const [addingNote, setAddingNote] = useState<number | null>(null);
  const [newNote, setNewNote] = useState('');
  const [editingNote, setEditingNote] = useState<number | null>(null);
  const [noteContent, setNoteContent] = useState('');

  // 拖拽状态：拖什么、悬停在哪、落点在哪
  const [dragNoteId, setDragNoteId] = useState<number | null>(null);
  const [dragStageId, setDragStageId] = useState<number | null>(null);
  const [overStage, setOverStage] = useState<number | null | 'unassigned' | null>(null);
  const [overIndex, setOverIndex] = useState(0);
  const [overBeforeStage, setOverBeforeStage] = useState<number | 'end' | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 横向滚动按钮可用状态
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateArrows = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };
  const scrollBoard = (dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });
  };

  // 悬停阶段标题时滚轮横向滚动，离开标题恢复纵向滚动
  // （React 的 onWheel 是 passive 监听，无法 preventDefault，故用原生监听）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.target as HTMLElement).closest('[data-stage-header]')) return;
      const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (d === 0) return;
      e.preventDefault();
      el.scrollLeft += d;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateArrows, { passive: true });
    window.addEventListener('resize', updateArrows);
    updateArrows();
    return () => {
      el.removeEventListener('scroll', updateArrows);
      window.removeEventListener('resize', updateArrows);
    };
  }, [stages, notes]);

  const load = async () => {
    setLoading(true);
    try {
      const [sd, nd] = await Promise.all([
        api(`/cases/${caseId}/stages`),
        api(`/cases/${caseId}/notes`),
      ]);
      setStages(sd.stages || []);
      setNotes(nd.notes || []);
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [caseId]);

  const draggingAny = dragNoteId != null || dragStageId != null;

  // ---------- 阶段 CRUD ----------
  const addStage = async () => {
    if (!newStageName.trim()) return;
    await api(`/cases/${caseId}/stages`, { method: 'POST', body: JSON.stringify({ name: newStageName }) });
    setNewStageName(''); setShowAddStage(false); load();
  };
  const renameStage = async (sid: number) => {
    if (!stageName.trim()) return;
    await api(`/stages/${sid}`, { method: 'PUT', body: JSON.stringify({ name: stageName }) });
    setEditingStage(null); load();
  };
  const delStage = async (sid: number, name: string) => {
    if (!confirm(`确认删除阶段「${name}」？该阶段下的记录将变为未分配。`)) return;
    await api(`/stages/${sid}`, { method: 'DELETE' }); load();
  };

  // ---------- 记录 CRUD ----------
  const addNote = async (sid: number | null) => {
    if (!newNote.trim()) return;
    await api(`/cases/${caseId}/notes`, { method: 'POST', body: JSON.stringify({ content: newNote, stage_id: sid }) });
    setNewNote(''); setAddingNote(null); load();
  };
  const updateNote = async (nid: number) => {
    if (!noteContent.trim()) return;
    await api(`/notes/${nid}`, { method: 'PUT', body: JSON.stringify({ content: noteContent }) });
    setEditingNote(null); load();
  };
  const delNote = async (nid: number, content: string) => {
    if (!confirm(`确认删除记录「${content.slice(0, 20)}${content.length > 20 ? '...' : ''}」？`)) return;
    await api(`/notes/${nid}`, { method: 'DELETE' }); load();
  };

  // ---------- 卡片拖拽 ----------
  const globalOrder = (a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0);

  const doNoteDrop = (targetStage: number | null, targetIdx: number) => {
    const nid = dragNoteId;
    if (nid == null) return;
    const dragged = notes.find(n => n.id === nid);
    if (!dragged) return;

    // 按容器顺序重建全局排序：各阶段列（含未分配），目标容器在 targetIdx 插入被拖卡片
    const others = notes.filter(n => n.id !== nid).sort(globalOrder);
    const containers: { sid: number | null; list: any[] }[] = [
      ...stages.map(s => ({ sid: s.id as number | null, list: others.filter(n => n.stage_id === s.id) })),
      { sid: null, list: others.filter(n => !n.stage_id) },
    ];
    const items: { id: number; stage_id: number | null }[] = [];
    for (const c of containers) {
      const list = [...c.list];
      if ((c.sid ?? 'unassigned') === (targetStage ?? 'unassigned')) {
        const orig = notes.find(n => n.id === nid);
        const moving = orig && orig.stage_id !== targetStage; // 跨列移动才允许任意落点
        const idx = moving ? targetIdx : Math.min(targetIdx, list.length);
        list.splice(idx, 0, dragged);
      }
      for (const n of list) items.push({ id: n.id, stage_id: c.sid });
    }

    // 乐观更新
    const orderMap = new Map(items.map((it, i) => [it.id, i]));
    const stageMap = new Map(items.map(it => [it.id, it.stage_id]));
    setNotes(prev => prev.map(n => ({ ...n, sort_order: orderMap.get(n.id) ?? n.sort_order, stage_id: stageMap.get(n.id) ?? n.stage_id })));
    api(`/cases/${caseId}/notes/reorder`, { method: 'PUT', body: JSON.stringify({ items }) })
      .catch(() => load());
    setDragNoteId(null); setOverStage(null); setOverIndex(0);
  };

  const computeInsertIndex = (e: React.DragEvent, colNotes: any[]) => {
    let idx = 0;
    for (const n of colNotes) {
      const el = document.getElementById(`note-${n.id}`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (e.clientY > r.top + r.height / 2) idx++;
    }
    return idx;
  };

  const onNoteDragStart = (e: React.DragEvent, nid: number) => {
    setDragNoteId(nid);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(nid));
  };
  const onColumnDragOver = (e: React.DragEvent, sid: number | null, colNotes: any[]) => {
    if (dragNoteId == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOverStage(sid ?? 'unassigned');
    setOverIndex(computeInsertIndex(e, colNotes.filter(n => n.id !== dragNoteId)));
  };
  const onColumnDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setOverStage(prev => prev);
    }
  };
  const onDragEnd = () => {
    setDragNoteId(null); setDragStageId(null); setOverStage(null); setOverIndex(0); setOverBeforeStage(null);
  };

  // ---------- 阶段列拖拽（手柄触发） ----------
  const stageHeaderRef = useRef<Record<number, HTMLDivElement | null>>({});
  const onStageHandleDown = (sid: number) => {
    const el = stageHeaderRef.current[sid];
    if (el) { el.draggable = true; }
  };
  const onStageDragStart = (e: React.DragEvent, sid: number) => {
    setDragStageId(sid);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `stage:${sid}`);
  };
  const onStageAreaDragOver = (e: React.DragEvent, sid: number) => {
    if (dragStageId == null) return;
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const before = e.clientX < r.left + r.width / 2;
    // 确定插入位置：本列之前 / 下一列之前 / 末尾
    const idx = stages.findIndex(s => s.id === sid);
    const next = stages[idx + 1];
    setOverBeforeStage(before ? sid : (next ? next.id : 'end'));
  };
  const doStageDrop = () => {
    if (dragStageId == null || overBeforeStage == null) return;
    const ids = stages.map(s => s.id);
    const fromIdx = ids.indexOf(dragStageId);
    ids.splice(fromIdx, 1);
    if (overBeforeStage === 'end') {
      ids.push(dragStageId);
    } else {
      const toIdx = ids.indexOf(overBeforeStage);
      ids.splice(toIdx, 0, dragStageId);
    }
    const same = ids.every((id, i) => id === stages[i].id);
    if (!same) {
      setStages(ids.map(id => stages.find(s => s.id === id)!).filter(Boolean));
      api(`/cases/${caseId}/stages/reorder`, { method: 'PUT', body: JSON.stringify({ order: ids }) })
        .catch(() => load());
    }
    onDragEnd();
  };

  // 拖拽时横向自动滚动
  const onBoardDragOver = (e: React.DragEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (e.clientX < r.left + 70) el.scrollLeft -= 14;
    else if (e.clientX > r.right - 70) el.scrollLeft += 14;
  };

  const renderPlaceholder = () => (
    <div className="h-16 rounded border-2 border-dashed border-amber-400 bg-amber-50/70 animate-pulse flex items-center justify-center text-xs text-amber-500">
      松开移动到此处
    </div>
  );

  const renderNoteCard = (n: any) => {
    const isDragging = dragNoteId === n.id;
    if (editingNote === n.id) {
      return (
        <div key={n.id} className="bg-white rounded shadow-sm p-2.5 border border-amber-300">
          <textarea value={noteContent} onChange={(e) => setNoteContent(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) updateNote(n.id); }}
            rows={3} className={`${INPUT} w-full mb-2`} autoFocus />
          <div className="flex gap-1 justify-end items-center">
            <span className="text-xs text-slate-400 mr-auto">⌘/Ctrl+Enter 保存</span>
            <button onClick={() => updateNote(n.id)} className="text-green-600"><Check className="w-4 h-4" /></button>
            <button onClick={() => setEditingNote(null)} className="text-slate-400"><X className="w-4 h-4" /></button>
          </div>
        </div>
      );
    }
    return (
      <div key={n.id} id={`note-${n.id}`}
        draggable
        onDragStart={(e) => onNoteDragStart(e, n.id)}
        onDragEnd={onDragEnd}
        onDoubleClick={() => { setEditingNote(n.id); setNoteContent(n.content); }}
        className={`bg-white rounded shadow-sm p-2.5 text-sm cursor-grab active:cursor-grabbing hover:shadow-md group transition-all
          ${isDragging ? 'opacity-30 scale-95 rotate-1' : 'hover:-translate-y-0.5'}`}>
        <div className="whitespace-pre-wrap break-words pointer-events-none">{n.content}</div>
        <div className={`flex justify-between items-center mt-1.5 pt-1.5 border-t border-slate-100 transition ${isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          <span className="text-xs text-slate-400 select-none">{n.author_name} · {n.created_at?.slice(5, 10)}</span>
          <button onClick={() => delNote(n.id, n.content)} className="text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>
    );
  };

  const renderColumnBody = (sid: number | null) => {
    const colNotes = notes.filter(n => (sid == null ? !n.stage_id : n.stage_id === sid)).sort(globalOrder);
    const isOver = overStage === (sid ?? 'unassigned') && dragNoteId != null;
    const display: any[] = [];
    const insertAt = isOver ? Math.min(overIndex, colNotes.length) : -1;
    colNotes.forEach((n, i) => {
      if (i === insertAt) display.push({ ph: true, key: `ph-${sid}` });
      display.push(n);
    });
    if (isOver && (insertAt >= colNotes.length || colNotes.length === 0)) display.push({ ph: true, key: `ph-${sid}` });

    return (
      <div
        onDragOver={(e) => onColumnDragOver(e, sid, colNotes)}
        onDragLeave={onColumnDragLeave}
        onDrop={(e) => { e.preventDefault(); doNoteDrop(sid, overIndex); }}
        className={`p-2 space-y-2 flex-1 overflow-y-auto min-h-[70px] transition-colors rounded-b
          ${isOver ? 'bg-amber-50/60 ring-1 ring-inset ring-amber-200' : ''}`}>
        {display.map((it: any) =>
          it.ph ? <div key={it.key}>{renderPlaceholder()}</div> : renderNoteCard(it)
        )}
        {addingNote === sid ? (
          <div className="bg-white rounded shadow-sm p-2 ring-1 ring-amber-300">
            <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addNote(sid); }}
              rows={2} placeholder="记录案情..." className={`${INPUT} w-full mb-2`} autoFocus />
            <div className="flex gap-1 justify-end items-center">
              <span className="text-xs text-slate-400 mr-auto">⌘/Ctrl+Enter</span>
              <button onClick={() => addNote(sid)} className="bg-amber-500 text-white px-2 py-1 rounded text-xs">添加</button>
              <button onClick={() => { setAddingNote(null); setNewNote(''); }} className="text-slate-400 px-2 py-1"><X className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ) : (
          <button onClick={() => { setAddingNote(sid); setNewNote(''); }}
            className="w-full text-xs text-slate-400 hover:text-amber-600 hover:bg-white rounded py-1.5 flex items-center justify-center gap-1 transition">
            <Plus className="w-3.5 h-3.5" /> 添加记录
          </button>
        )}
      </div>
    );
  };

  if (loading) return <div className="p-8 text-slate-400">加载中...</div>;

  return (
    <div className="flex flex-col h-[calc(100vh_-_14rem)]">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-slate-500 select-none">
          {draggingAny ? (
            dragNoteId != null
              ? <span className="text-amber-600 font-medium">正在拖动记录 — 悬停到目标阶段后松开</span>
              : <span className="text-amber-600 font-medium">正在拖动阶段 — 移到目标位置竖线处松开</span>
          ) : (
            <>拖 <GripVertical className="w-3.5 h-3.5 inline -mt-0.5" /> 手柄调整阶段顺序 · 拖拽卡片跨阶段移动 · 双击卡片编辑</>
          )}
        </p>
        <button onClick={() => setShowAddStage(s => !s)}
          className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded text-sm">
          <Plus className="w-4 h-4" /> 新增阶段
        </button>
      </div>

      {showAddStage && (
        <div className="flex gap-2 mb-3">
          <input value={newStageName} onChange={(e) => setNewStageName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addStage()}
            placeholder="阶段名称，如：一审审理" className={`${INPUT} flex-1 max-w-xs`} autoFocus />
          <button onClick={addStage} className="bg-slate-700 text-white px-3 py-1 rounded text-sm">添加</button>
          <button onClick={() => { setShowAddStage(false); setNewStageName(''); }} className="text-slate-400 px-2"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="relative flex-1 min-h-0">
        {canLeft && (
          <button onClick={() => scrollBoard(-1)} title="向左滚动"
            className="absolute left-1.5 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/95 shadow-md border border-slate-200 flex items-center justify-center text-slate-500 hover:text-amber-600 hover:shadow-lg transition">
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        {canRight && (
          <button onClick={() => scrollBoard(1)} title="向右滚动"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/95 shadow-md border border-slate-200 flex items-center justify-center text-slate-500 hover:text-amber-600 hover:shadow-lg transition">
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
        <div ref={scrollRef} onDragOver={onBoardDragOver} onDrop={(e) => { if (dragStageId != null) { e.preventDefault(); doStageDrop(); } }}
          className={`flex gap-2.5 overflow-x-auto pb-3 h-full ${draggingAny ? 'select-none' : ''}`}>

        {stages.map((s) => {
          const isDragged = dragStageId === s.id;
          const showBar = dragStageId != null && overBeforeStage === s.id;
          const sNotes = notes.filter(n => n.stage_id === s.id);
          return (
            <div key={s.id} className="flex items-stretch shrink-0">
              {showBar && <div className="w-1 rounded-full bg-amber-400 mr-1 animate-pulse" />}
              <div
                onDragOver={(e) => onStageAreaDragOver(e, s.id)}
                onDrop={(e) => { if (dragStageId != null) { e.preventDefault(); doStageDrop(); } }}
                className={`bg-slate-100 rounded w-72 flex flex-col transition-opacity
                  ${isDragged ? 'opacity-40 scale-[0.98]' : ''}`}>
                <div data-stage-header ref={(el) => { stageHeaderRef.current[s.id] = el; }}
                  draggable={dragStageId === s.id}
                  onDragStart={(e) => onStageDragStart(e, s.id)}
                  onDragEnd={onDragEnd}
                  className="p-2.5 pl-2 border-b border-slate-200 flex items-center gap-1.5">
                  <span onMouseDown={() => onStageHandleDown(s.id)} onMouseUp={(e) => { (e.currentTarget.parentElement as HTMLDivElement).draggable = false; }}
                    title="拖动调整阶段顺序"
                    className="text-slate-300 hover:text-amber-500 cursor-grab active:cursor-grabbing p-0.5">
                    <GripVertical className="w-4 h-4" />
                  </span>
                  {editingStage === s.id ? (
                    <>
                      <input value={stageName} onChange={(e) => setStageName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && renameStage(s.id)}
                        className={`${INPUT} flex-1`} autoFocus />
                      <button onClick={() => renameStage(s.id)} className="text-green-600"><Check className="w-4 h-4" /></button>
                      <button onClick={() => setEditingStage(null)} className="text-slate-400"><X className="w-4 h-4" /></button>
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-sm flex-1 truncate select-none">{s.name}</span>
                      <span className={`text-xs rounded-full px-2 py-0.5 transition ${overStage === s.id && dragNoteId != null ? 'bg-amber-200 text-amber-700' : 'text-slate-400 bg-slate-200'}`}>{sNotes.length}</span>
                      <button onClick={() => { setEditingStage(s.id); setStageName(s.name); }} className="text-slate-400 hover:text-amber-600"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => delStage(s.id, s.name)} className="text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                    </>
                  )}
                </div>
                {renderColumnBody(s.id)}
              </div>
            </div>
          );
        })}

        {dragStageId != null && overBeforeStage === 'end' && <div className="w-1 rounded-full bg-amber-400 animate-pulse" />}

        {/* 未分配列 */}
        <div onDragOver={(e) => { if (dragNoteId != null) { e.preventDefault(); setOverStage('unassigned'); } }}
          onDrop={(e) => { if (dragNoteId != null) { e.preventDefault(); doNoteDrop(null, overStage === 'unassigned' ? overIndex : 0); } }}
          className={`bg-slate-50 border-2 border-dashed rounded w-72 shrink-0 flex flex-col transition-colors
            ${overStage === 'unassigned' && dragNoteId != null ? 'border-amber-400 bg-amber-50/60' : 'border-slate-300'}`}>
          <div data-stage-header className="p-2.5 border-b border-slate-200 text-sm text-slate-500 select-none">未分配</div>
          {renderColumnBody(null)}
        </div>
        </div>
      </div>
    </div>
  );
}
