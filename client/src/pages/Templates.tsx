import { useEffect, useState } from 'react';
import { FolderOpen, RefreshCw, Download, Search, ChevronDown, ChevronRight, FileText, Eye, X, Upload, Trash2 } from 'lucide-react';
import { api } from '../api';

// 上传模板支持的扩展名（与后端 ALLOWED_EXTS 一致）
const ACCEPT = '.docx,.doc,.pdf,.wps,.txt,.dot,.dotx,.xlsx,.xls';

export default function TemplatesPage() {
  const [me, setMe] = useState<any>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [folderPath, setFolderPath] = useState('');
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<{ top: string; sub?: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState('');
  // 上传模板弹窗
  const [showUpload, setShowUpload] = useState(false);
  const [targetDir, setTargetDir] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [tip, setTip] = useState('');

  const isAdmin = me?.role === 'admin';

  const load = (sel = selected, keyword = q) => {
    let url = '/api/templates';
    const params = new URLSearchParams();
    if (sel?.top) params.set('top', sel.top);
    if (sel?.sub) params.set('category', sel.sub);
    if (keyword) params.set('q', keyword);
    if ([...params].length) url += '?' + params.toString();
    fetch(url, { credentials: 'include' }).then((r) => r.json()).then((d) => {
      setTemplates(d.templates || []);
      setCategories(d.categories || []);
    });
    fetch('/api/templates/folder', { credentials: 'include' }).then((r) => r.json()).then((d) => setFolderPath(d.path));
  };
  useEffect(() => {
    api('/auth/me').then((r) => setMe(r.user)).catch(() => {});
    load(null, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = () => load(selected, q);

  const scan = async () => {
    setScanning(true);
    setScanMsg('');
    try {
      const r = await fetch('/api/templates/scan', { method: 'POST', credentials: 'include' });
      const d = await r.json();
      if (!r.ok) { setScanMsg(d.error || '扫描失败'); return; }
      setScanMsg(`扫描完成：新增 ${d.added}，更新 ${d.updated}，移除 ${d.removed}，共 ${d.total} 个模板`);
      load();
    } finally { setScanning(false); }
  };

  const openFolder = async (sub?: string) => {
    const r = await fetch('/api/templates/open-folder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ path: sub || '' }),
    });
    const d = await r.json();
    if (!r.ok) {
      setTip(d.error || '无权操作');
      setTimeout(() => setTip(''), 3000);
    }
  };

  // 用本地系统默认应用打开文件型模板（macOS: open 命令）
  const openLocal = async (t: any) => {
    setTip('');
    try {
      const r = await fetch(`/api/templates/${t.id}/open`, { method: 'POST', credentials: 'include' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '打开失败');
      setTip(`已使用本地应用打开「${t.name}」`);
      setTimeout(() => setTip(''), 3000);
    } catch (e: any) {
      setTip(e.message || '打开失败');
    }
  };

  const submitUpload = async () => {
    if (!file) { setUploadError('请选择模板文件'); return; }
    setUploading(true);
    setUploadError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('target_dir', targetDir);
      const r = await fetch('/api/templates/upload', { method: 'POST', credentials: 'include', body: fd });
      const d = await r.json();
      if (!r.ok) {
        setUploadError(d.error || '上传失败');
        return;
      }
      // 成功：重置弹窗 + 刷新列表
      setFile(null);
      setTargetDir('');
      setShowUpload(false);
      setTip(`已上传模板：${d.name}`);
      setTimeout(() => setTip(''), 3000);
      load();
    } catch (e: any) {
      setUploadError(e.message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const removeTemplate = async (t: any) => {
    if (!confirm(`确认删除模板「${t.name}」？${t.is_file ? '磁盘文件也会一并删除。' : ''}`)) return;
    try {
      const r = await fetch(`/api/templates/${t.id}`, { method: 'DELETE', credentials: 'include' });
      const d = await r.json();
      if (!r.ok) { setTip(d.error || '删除失败'); setTimeout(() => setTip(''), 3000); return; }
      setTip(`已删除模板：${t.name}`);
      setTimeout(() => setTip(''), 3000);
      load();
    } catch (e: any) {
      setTip(e.message || '删除失败');
    }
  };

  // 当前视图文件过多时截断
  const shown = templates.slice(0, 500);

  // 现有目录列表（来自分类树，用于 datalist 提示）
  const existingDirs: string[] = [];
  for (const top of categories) {
    existingDirs.push(top.name);
    for (const [sub] of Object.entries(top.children || {})) {
      existingDirs.push(`${top.name}/${sub}`);
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">文书模板库</h1>
        <div className="flex gap-2">
          {isAdmin && (
            <button onClick={scan} disabled={scanning}
              className="flex items-center gap-1 border px-3 py-2 rounded text-sm hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} /> 刷新扫描
            </button>
          )}
          <button onClick={() => setShowUpload(!showUpload)}
            className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 rounded text-sm">
            <Upload className="w-4 h-4" /> 上传模板
          </button>
        </div>
      </div>

      {/* 本地文件夹提示条 */}
      <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-4 flex items-center justify-between gap-3">
        <div className="text-sm text-amber-900 min-w-0">
          <span className="font-medium">模板文件夹：</span>
          <code className="text-xs break-all">{folderPath}</code>
          {isAdmin && <span className="ml-2 text-amber-700">点「上传模板」可指定子目录；或把文件放进对应分类文件夹后点「刷新扫描」入库</span>}
          {!isAdmin && <span className="ml-2 text-amber-700">可查看与下载模板；如需新增请联系管理员或使用「上传模板」</span>}
        </div>
        {isAdmin && (
          <button onClick={() => openFolder()}
            className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded text-sm shrink-0">
            <FolderOpen className="w-4 h-4" /> 在 Finder 中打开
          </button>
        )}
      </div>
      {scanMsg && <div className="text-sm text-green-600 mb-3">{scanMsg}</div>}

      {showUpload && (
        <div className="bg-white rounded shadow p-4 mb-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-700">上传模板文件</span>
            <span className="text-xs text-slate-400">支持 docx/doc/pdf/wps/txt/dot/dotx/xlsx/xls</span>
          </div>
          <div className="flex gap-2 items-center">
            <input type="file" accept={ACCEPT}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="text-sm border rounded px-3 py-2 flex-1" />
            <input placeholder="目标目录（如 判决书/民事，留空放根目录）"
              value={targetDir} onChange={(e) => setTargetDir(e.target.value)}
              list="tpl-dirs"
              className="w-72 border rounded px-3 py-2 text-sm" />
            <datalist id="tpl-dirs">
              {existingDirs.map((d) => <option key={d} value={d} />)}
            </datalist>
          </div>
          {uploadError && <div className="text-sm text-red-600">{uploadError}</div>}
          <div className="flex gap-2">
            <button onClick={submitUpload} disabled={uploading}
              className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
              {uploading ? '上传中...' : '上传'}
            </button>
            <button onClick={() => { setShowUpload(false); setFile(null); setTargetDir(''); setUploadError(''); }}
              className="border px-4 py-2 rounded text-sm">取消</button>
          </div>
        </div>
      )}

      <div className="flex gap-4">
        {/* 左侧分类树 */}
        <div className="w-64 shrink-0">
          <div className="bg-white rounded shadow p-2">
            <button onClick={() => { setSelected(null); load(null, q); }}
              className={`w-full text-left px-3 py-2 rounded text-sm ${!selected ? 'bg-amber-100 text-amber-800 font-medium' : 'hover:bg-slate-50'}`}>
              全部模板
            </button>
            {categories.map((top) => (
              <div key={top.name}>
                <div className="flex items-center">
                  <button onClick={() => setExpanded({ ...expanded, [top.name]: !expanded[top.name] })}
                    className="p-2 text-slate-400 hover:text-slate-700">
                    {expanded[top.name] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <button onClick={() => { setSelected({ top: top.name }); load({ top: top.name }, q); }}
                    className={`flex-1 text-left py-2 pr-2 text-sm truncate ${selected?.top === top.name && !selected?.sub ? 'bg-amber-100 text-amber-800 font-medium rounded' : 'hover:bg-slate-50'}`}>
                    {top.name} <span className="text-xs text-slate-400">({top.count})</span>
                  </button>
                  {isAdmin && (
                    <button title="在 Finder 中打开此分类" onClick={() => openFolder(top.name)}
                      className="p-2 text-slate-400 hover:text-amber-600">
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {expanded[top.name] && (
                  <div className="ml-6">
                    {Object.entries(top.children).map(([sub, count]) => (
                      <button key={sub} onClick={() => { setSelected({ top: top.name, sub }); load({ top: top.name, sub }, q); }}
                        className={`w-full text-left px-2 py-1.5 text-xs truncate rounded ${selected?.sub === sub ? 'bg-amber-100 text-amber-800' : 'text-slate-600 hover:bg-slate-50'}`}>
                        {sub} <span className="text-slate-400">({String(count)})</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 右侧模板列表 */}
        <div className="flex-1 min-w-0">
          <div className="flex gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()}
                placeholder="搜索模板名称..." className="w-full border border-slate-300 rounded pl-10 pr-4 py-2 text-sm" />
            </div>
            <button onClick={search} className="bg-amber-500 text-white px-4 py-2 rounded text-sm">搜索</button>
          </div>

          <div className="text-xs text-slate-400 mb-2">
            共 {templates.length} 个模板{templates.length > 500 ? '，仅显示前 500 个，请用分类或搜索缩小范围' : ''}
          </div>

          <div className="bg-white rounded shadow overflow-hidden">
            {shown.map((t) => {
              const canDelete = isAdmin || t.creator_id === me?.id;
              return (
                <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0 hover:bg-slate-50">
                  <FileText className="w-4 h-4 text-blue-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                  {t.is_file ? (
                    <a href={`/api/templates/${t.id}/download`}
                      className="text-sm truncate block text-left hover:text-amber-600 hover:underline max-w-full"
                      title={`下载 ${t.name}`}>
                      {t.name}
                    </a>
                  ) : (
                    <button onClick={() => setPreview(t)}
                      className="text-sm truncate block text-left hover:text-amber-600 hover:underline max-w-full"
                      title={`查看 ${t.name}`}>
                      {t.name}
                    </button>
                  )}
                  <div className="text-xs text-slate-400">
                    {t.category_path || t.category || '文本模板'}
                    {t.creator_name && <span className="ml-1">· 上传者：{t.creator_name}</span>}
                  </div>
                </div>
                  {t.is_file ? (
                    <div className="flex items-center gap-3 shrink-0">
                      <button onClick={() => openLocal(t)}
                        className="flex items-center gap-1 text-xs text-slate-500 hover:text-amber-600">
                        <Eye className="w-3.5 h-3.5" /> 打开
                      </button>
                      <a href={`/api/templates/${t.id}/download`}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                        <Download className="w-3.5 h-3.5" /> 下载
                      </a>
                    </div>
                  ) : (
                    <button onClick={() => setPreview(t)}
                      className="flex items-center gap-1 text-xs text-slate-500 hover:text-amber-600 shrink-0">
                      <Eye className="w-3.5 h-3.5" /> 查看
                    </button>
                  )}
                  {canDelete && (
                    <button onClick={() => removeTemplate(t)}
                      title="删除模板"
                      className="flex items-center gap-1 text-xs text-slate-500 hover:text-red-600 shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
            {templates.length === 0 && <div className="p-10 text-center text-slate-400 text-sm">未找到模板</div>}
          </div>
        </div>
      </div>

      {tip && <div className="text-sm text-amber-600 mb-3">{tip}</div>}

      {preview && !preview.is_file && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6" onClick={() => setPreview(null)}>
          <div className="bg-white rounded-lg w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 py-3 border-b">
              <FileText className="w-4 h-4 text-slate-400" />
              <span className="font-bold flex-1 truncate">{preview.name}</span>
              <button onClick={() => setPreview(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <pre className="flex-1 overflow-auto p-5 text-sm whitespace-pre-wrap font-mono text-slate-700">
              {preview.content || '（空模板）'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
