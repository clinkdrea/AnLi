import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Download, Trash2, FileText, Image, FileArchive, Copy, FolderInput, X, Search, ChevronRight, Eye, Pencil } from 'lucide-react';
import { api } from '../../api';
import OcrActions, { isImageFile } from './OcrActions';
import { RenameFileModal } from './RenameFile';

function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'heic', 'webp'].includes(ext)) return <Image className="w-5 h-5 text-green-500" />;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return <FileArchive className="w-5 h-5 text-amber-500" />;
  return <FileText className="w-5 h-5 text-blue-500" />;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

export default function FilesTab({ caseId, onChanged }: { caseId: string; onChanged?: () => void }) {
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [showTplModal, setShowTplModal] = useState(false);
  const [showCaseModal, setShowCaseModal] = useState(false);
  const [tip, setTip] = useState('');
  const [renaming, setRenaming] = useState<any>(null);

  const load = () => {
    fetch(`/api/cases/${caseId}/files`, { credentials: 'include' })
      .then((r) => r.json()).then((d) => setFiles(d.files || []));
  };
  useEffect(() => { load(); }, [caseId]);

  // 有图片正在识别时（如后台 worker 自动识别），每 3 秒轮询刷新
  const hasProcessing = files.some((f) => isImageFile(f.file_name) && f.ocr_status === 'processing');
  useEffect(() => {
    if (!hasProcessing) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [hasProcessing]);

  const reloadAll = () => { load(); onChanged?.(); };

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    setLoading(true);
    const fd = new FormData();
    for (let i = 0; i < list.length; i++) fd.append('file', list[i]);
    try {
      await fetch(`/api/cases/${caseId}/files`, { method: 'POST', body: fd, credentials: 'include' });
      reloadAll();
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const del = async (id: number, name: string) => {
    if (!confirm(`确认删除文件「${name}」？`)) return;
    await fetch(`/api/files/${id}`, { method: 'DELETE', credentials: 'include' });
    reloadAll();
  };

  // 用本地系统默认应用打开文件（macOS: open 命令）
  const openLocal = async (id: number, name: string) => {
    setTip('');
    try {
      const r = await fetch(`/api/files/${id}/open`, { method: 'POST', credentials: 'include' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '打开失败');
      setTip(`已使用本地应用打开「${name}」`);
      setTimeout(() => setTip(''), 3000);
    } catch (e: any) {
      setTip(e.message || '打开失败');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <p className="text-sm text-slate-500">文件存放在案件文件夹中，支持 PDF / Word / Excel / 图片等；图片可 OCR 识别并在弹窗查看、复制文本</p>
        <div className="flex gap-2">
          <button onClick={() => setShowTplModal(true)}
            className="flex items-center gap-1 border px-3 py-2 rounded text-sm hover:bg-slate-50">
            <Copy className="w-4 h-4" /> 从模板复制
          </button>
          <button onClick={() => setShowCaseModal(true)}
            className="flex items-center gap-1 border px-3 py-2 rounded text-sm hover:bg-slate-50">
            <FolderInput className="w-4 h-4" /> 从其他案件复制
          </button>
          <button onClick={() => inputRef.current?.click()}
            className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded text-sm">
            <Upload className="w-4 h-4" /> 上传文件
          </button>
          <input ref={inputRef} type="file" multiple className="hidden" onChange={upload} />
        </div>
      </div>
      {loading && <div className="text-sm text-amber-600 mb-2">上传中...</div>}
      {tip && <div className="text-sm text-amber-600 mb-2">{tip}</div>}

      <div className="bg-white rounded shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3">文件名</th>
              <th className="text-left px-4 py-3">大小</th>
              <th className="text-left px-4 py-3">上传人</th>
              <th className="text-left px-4 py-3">OCR 识别</th>
              <th className="text-left px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id} className="border-t hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <FileIcon name={f.file_name} />
                    <button onClick={() => openLocal(f.id, f.file_name)}
                      className="text-slate-700 hover:text-amber-600 hover:underline truncate max-w-[320px]"
                      title={`用本地应用打开 ${f.file_name}`}>
                      {f.file_name}
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-500">{formatSize(f.size)}</td>
                <td className="px-4 py-3 text-slate-500">{f.uploader_name}</td>
                <td className="px-4 py-3">
                  <OcrActions file={f} size="cell" onChanged={load} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => openLocal(f.id, f.file_name)}
                      className="text-slate-500 hover:text-amber-600 flex items-center gap-1">
                      <Eye className="w-3.5 h-3.5" /> 打开
                    </button>
                    <a href={`/api/files/${f.id}/download`} className="text-blue-600 hover:underline flex items-center gap-1">
                      <Download className="w-3 h-3" /> 下载
                    </a>
                    <button onClick={() => setRenaming(f)}
                      className="text-slate-500 hover:text-amber-600 flex items-center gap-1">
                      <Pencil className="w-3.5 h-3.5" /> 重命名
                    </button>
                    <button onClick={() => del(f.id, f.file_name)} className="text-red-500 hover:underline flex items-center gap-1">
                      <Trash2 className="w-3 h-3" /> 删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {files.length === 0 && <div className="p-8 text-center text-slate-400">暂无文件，可上传或从模板/其他案件复制</div>}
      </div>

      {showTplModal && (
        <CopyFromTemplateModal caseId={caseId} onClose={() => setShowTplModal(false)} onCopied={reloadAll} />
      )}
      {showCaseModal && (
        <CopyFromCaseModal caseId={caseId} onClose={() => setShowCaseModal(false)} onCopied={reloadAll} />
      )}
      {renaming && (
        <RenameFileModal file={renaming}
          onClose={() => setRenaming(null)}
          onRenamed={() => { setRenaming(null); reloadAll(); }} />
      )}
    </div>
  );
}

// 从文书模板复制（树状浏览 + 多选批量）
function CopyFromTemplateModal({ caseId, onClose, onCopied }: any) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [copying, setCopying] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    api('/templates').then((d) => setTemplates((d.templates || []).filter((t: any) => t.is_file)));
  }, []);

  // 构建树：大类/子类/文件
  const tree = useMemo(() => {
    const root: any = { name: '', dirs: new Map(), files: [] };
    for (const t of templates) {
      const parts = String(t.category_path || t.category || '未分类').split('/').filter(Boolean);
      let node = root;
      for (const p of parts) {
        if (!node.dirs.has(p)) node.dirs.set(p, { name: p, dirs: new Map(), files: [] });
        node = node.dirs.get(p);
      }
      node.files.push(t);
    }
    return root;
  }, [templates]);

  // 默认展开第一层大类
  useEffect(() => {
    if (templates.length && expanded.size === 0) {
      const keys = new Set<string>();
      for (const t of templates) {
        const first = String(t.category_path || t.category || '未分类').split('/')[0];
        if (first) keys.add('/' + first);
      }
      setExpanded(keys);
    }
  }, [templates]);

  const keyword = q.trim().toLowerCase();
  const searching = keyword.length > 0;
  const visible = useMemo(
    () => (searching ? templates.filter((t: any) => t.name.toLowerCase().includes(keyword)) : []),
    [templates, keyword]
  );

  const toggle = (id: number) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const collectFiles = (node: any): any[] => {
    const out = [...node.files];
    node.dirs.forEach((child: any) => out.push(...collectFiles(child)));
    return out;
  };
  const toggleDir = (files: any[]) => {
    setSel((s) => {
      const n = new Set(s);
      const all = files.length > 0 && files.every((f) => n.has(f.id));
      for (const f of files) { if (all) n.delete(f.id); else n.add(f.id); }
      return n;
    });
  };
  const toggleExpand = (key: string) => setExpanded((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const allSearchSelected = searching && visible.length > 0 && visible.every((t) => sel.has(t.id));
  const toggleAllSearch = () => setSel(allSearchSelected ? new Set() : new Set(visible.map((t) => t.id)));

  const copySelected = async () => {
    if (sel.size === 0 || copying) return;
    setCopying(true); setMsg('');
    try {
      const r = await api(`/cases/${caseId}/files/copy-from-template`, {
        method: 'POST', body: JSON.stringify({ template_ids: Array.from(sel) }),
      });
      const failNote = r.failed?.length ? `，${r.failed.length} 个失败` : '';
      setMsg(`已复制 ${r.count} 个模板到本案件资料${failNote}`);
      setSel(new Set());
      onCopied();
    } catch (e: any) { setMsg(e.message); }
    finally { setCopying(false); }
  };

  const renderFile = (f: any, depth: number) => (
    <div key={f.id} onClick={() => toggle(f.id)}
      className={`flex items-center gap-3 py-1.5 cursor-pointer rounded px-1 transition ${sel.has(f.id) ? 'bg-amber-50' : 'hover:bg-slate-50'}`}
      style={{ paddingLeft: depth * 16 + 4 }}>
      <input type="checkbox" checked={sel.has(f.id)} onChange={() => toggle(f.id)}
        onClick={(e) => e.stopPropagation()} className="accent-amber-500 shrink-0" />
      <FileIcon name={f.file_path || '.docx'} />
      <span className="text-sm flex-1 min-w-0 truncate">{f.name}</span>
    </div>
  );

  const renderDir = (node: any, key: string, depth: number) => {
    const isOpen = expanded.has(key);
    const subFiles = collectFiles(node);
    const allSel = subFiles.length > 0 && subFiles.every((f: any) => sel.has(f.id));
    return (
      <div key={key}>
        <div className={`flex items-center gap-2 py-1.5 cursor-pointer rounded px-1 hover:bg-slate-50 ${depth === 0 ? 'font-medium' : ''}`}
          style={{ paddingLeft: depth * 16 + 4 }} onClick={() => toggleExpand(key)}>
          <ChevronRight className={`w-3.5 h-3.5 text-slate-400 transition shrink-0 ${isOpen ? 'rotate-90' : ''}`} />
          <FolderInput className="w-4 h-4 text-amber-500 shrink-0" />
          <span className="text-sm flex-1 truncate">{node.name}</span>
          <span className="text-xs text-slate-400 shrink-0">{subFiles.length}</span>
          <input type="checkbox" checked={allSel} onChange={() => toggleDir(subFiles)}
            onClick={(e) => e.stopPropagation()} className="accent-amber-500 shrink-0" title="选中/取消整个文件夹" />
        </div>
        {isOpen && (
          <div>
            {node.files.map((f: any) => renderFile(f, depth + 1))}
            {Array.from(node.dirs.values()).map((child: any) => renderDir(child, `${key}/${child.name}`, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg p-5 w-[580px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold">从文书模板复制</h3>
          <button onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        <div className="relative mb-2">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索模板名称（搜索时切换为平铺列表）..."
            className="w-full border border-slate-300 rounded pl-10 pr-3 py-2 text-sm" autoFocus />
        </div>
        <div className="flex items-center justify-between mb-1 text-xs">
          {searching ? (
            <button onClick={toggleAllSearch} className="text-amber-600 hover:underline">
              {allSearchSelected ? '取消全选' : '全选搜索结果'}
            </button>
          ) : (
            <span className="text-slate-400">点文件夹名展开/收起，勾选文件夹可整类选中</span>
          )}
          <span className="text-slate-400">已选 {sel.size} 个</span>
        </div>
        {msg && <div className="text-xs text-green-600 mb-2">{msg}</div>}
        <div className="overflow-y-auto flex-1 divide-y">
          {searching ? (
            <>
              {visible.map((t) => (
                <div key={t.id} onClick={() => toggle(t.id)}
                  className={`flex items-center gap-3 py-2 cursor-pointer transition ${sel.has(t.id) ? 'bg-amber-50' : 'hover:bg-slate-50'}`}>
                  <input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)}
                    onClick={(e) => e.stopPropagation()} className="accent-amber-500 shrink-0" />
                  <FileIcon name={t.file_path || '.docx'} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{t.name}</div>
                    <div className="text-xs text-slate-400 truncate">{t.category_path || t.category}</div>
                  </div>
                </div>
              ))}
              {visible.length === 0 && <div className="py-8 text-center text-slate-400 text-sm">未找到匹配模板</div>}
            </>
          ) : (
            Array.from(tree.dirs.values()).map((child: any) => renderDir(child, '/' + child.name, 0))
          )}
        </div>
        {sel.size > 0 && (
          <div className="border-t border-slate-200 pt-3 mt-2 flex items-center justify-between">
            <button onClick={() => setSel(new Set())} className="text-xs text-slate-500 hover:underline">清空选择</button>
            <button onClick={copySelected} disabled={copying}
              className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
              {copying ? '复制中...' : `复制所选（${sel.size}）`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// 从其他案件复制
function CopyFromCaseModal({ caseId, onClose, onCopied }: any) {
  const [cases, setCases] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [files, setFiles] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    api('/cases').then((d) => setCases((d.cases || []).filter((c: any) => String(c.id) !== String(caseId))));
  }, [caseId]);
  useEffect(() => {
    if (!selected) return;
    setSel(new Set());
    api(`/cases/${selected.id}/files`).then((d) => setFiles(d.files || []));
  }, [selected]);

  const toggle = (id: number) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSelected = files.length > 0 && files.every((f) => sel.has(f.id));
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(files.map((f) => f.id)));

  const copySelected = async () => {
    if (sel.size === 0 || copying) return;
    setCopying(true); setMsg('');
    try {
      const r = await api(`/cases/${caseId}/files/copy-from-case`, {
        method: 'POST', body: JSON.stringify({ source_file_ids: Array.from(sel) }),
      });
      const failNote = r.failed?.length ? `，${r.failed.length} 个失败` : '';
      setMsg(`已复制 ${r.count} 个文件到本案件资料${failNote}`);
      setSel(new Set());
      onCopied();
    } catch (e: any) { setMsg(e.message); }
    finally { setCopying(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg p-5 w-[560px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold">从其他案件复制文书</h3>
          <button onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        {!selected ? (
          <div className="overflow-y-auto flex-1 divide-y">
            {cases.map((c) => (
              <button key={c.id} onClick={() => setSelected(c)}
                className="w-full text-left py-2.5 hover:bg-slate-50 flex items-center gap-2">
                <FolderInput className="w-4 h-4 text-amber-500" />
                <span className="text-sm">{c.name}</span>
                <span className="text-xs text-slate-400 ml-auto">{c.case_no}</span>
              </button>
            ))}
            {cases.length === 0 && <div className="py-8 text-center text-slate-400 text-sm">没有其他案件</div>}
          </div>
        ) : (
          <>
            <button onClick={() => { setSelected(null); setSel(new Set()); }} className="text-xs text-amber-600 hover:underline mb-2 text-left">
              ← 返回案件列表（当前：{selected.name}）
            </button>
            <div className="flex items-center justify-between mb-1 text-xs">
              <button onClick={toggleAll} className="text-amber-600 hover:underline">
                {allSelected ? '取消全选' : '全选'}
              </button>
              <span className="text-slate-400">点击行勾选，可多选</span>
            </div>
            {msg && <div className="text-xs text-green-600 mb-2">{msg}</div>}
            <div className="overflow-y-auto flex-1 divide-y">
              {files.map((f) => (
                <div key={f.id} onClick={() => toggle(f.id)}
                  className={`flex items-center gap-3 py-2.5 cursor-pointer transition ${sel.has(f.id) ? 'bg-amber-50' : 'hover:bg-slate-50'}`}>
                  <input type="checkbox" checked={sel.has(f.id)} onChange={() => toggle(f.id)}
                    onClick={(e) => e.stopPropagation()} className="accent-amber-500 shrink-0" />
                  <FileIcon name={f.file_name} />
                  <span className="text-sm flex-1 min-w-0 truncate">{f.file_name}</span>
                  <span className="text-xs text-slate-400">{formatSize(f.size)}</span>
                </div>
              ))}
              {files.length === 0 && <div className="py-8 text-center text-slate-400 text-sm">该案件暂无文件</div>}
            </div>
            {sel.size > 0 && (
              <div className="border-t border-slate-200 pt-3 mt-2 flex items-center justify-between">
                <button onClick={() => setSel(new Set())} className="text-xs text-slate-500 hover:underline">清空选择</button>
                <button onClick={copySelected} disabled={copying}
                  className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
                  {copying ? '复制中...' : `复制所选（${sel.size}）`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
