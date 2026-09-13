import { useEffect, useState } from 'react';
import { FolderOpen, RefreshCw, Download, Search, ChevronDown, ChevronRight, FileText, Plus } from 'lucide-react';

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [folderPath, setFolderPath] = useState('');
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<{ top: string; sub?: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState('');
  const [showTextForm, setShowTextForm] = useState(false);
  const [textForm, setTextForm] = useState({ name: '', category: '', content: '' });

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
  useEffect(() => { load(null, ''); }, []);

  const search = () => load(selected, q);

  const scan = async () => {
    setScanning(true);
    setScanMsg('');
    try {
      const r = await fetch('/api/templates/scan', { method: 'POST', credentials: 'include' }).then((x) => x.json());
      setScanMsg(`扫描完成：新增 ${r.added}，更新 ${r.updated}，移除 ${r.removed}，共 ${r.total} 个模板`);
      load();
    } finally { setScanning(false); }
  };

  const openFolder = async (sub?: string) => {
    await fetch('/api/templates/open-folder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ path: sub || '' }),
    });
  };

  const createText = async () => {
    if (!textForm.name.trim() || !textForm.content) return;
    await fetch('/api/templates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify(textForm),
    });
    setTextForm({ name: '', category: '', content: '' });
    setShowTextForm(false);
    load();
  };

  // 当前视图文件过多时截断
  const shown = templates.slice(0, 500);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">文书模板库</h1>
        <div className="flex gap-2">
          <button onClick={scan} disabled={scanning}
            className="flex items-center gap-1 border px-3 py-2 rounded text-sm hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} /> 刷新扫描
          </button>
          <button onClick={() => setShowTextForm(!showTextForm)}
            className="flex items-center gap-1 border px-3 py-2 rounded text-sm hover:bg-slate-50">
            <Plus className="w-4 h-4" /> 文本模板
          </button>
        </div>
      </div>

      {/* 本地文件夹提示条 */}
      <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-4 flex items-center justify-between gap-3">
        <div className="text-sm text-amber-900 min-w-0">
          <span className="font-medium">模板文件夹：</span>
          <code className="text-xs break-all">{folderPath}</code>
          <span className="ml-2 text-amber-700">把文件放进对应分类文件夹，点「刷新扫描」即可入库</span>
        </div>
        <button onClick={() => openFolder()}
          className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded text-sm shrink-0">
          <FolderOpen className="w-4 h-4" /> 在 Finder 中打开
        </button>
      </div>
      {scanMsg && <div className="text-sm text-green-600 mb-3">{scanMsg}</div>}

      {showTextForm && (
        <div className="bg-white rounded shadow p-4 mb-4 space-y-2">
          <div className="flex gap-2">
            <input placeholder="模板名称" value={textForm.name} onChange={(e) => setTextForm({ ...textForm, name: e.target.value })} className="flex-1 border rounded px-3 py-2 text-sm" />
            <input placeholder="分类" value={textForm.category} onChange={(e) => setTextForm({ ...textForm, category: e.target.value })} className="w-40 border rounded px-3 py-2 text-sm" />
          </div>
          <textarea placeholder="模板内容，支持占位符 {{案件编号}} {{案件名称}}" value={textForm.content} onChange={(e) => setTextForm({ ...textForm, content: e.target.value })}
            className="w-full border rounded px-3 py-2 text-sm min-h-[120px] font-mono" />
          <div className="flex gap-2">
            <button onClick={createText} className="bg-amber-500 text-white px-4 py-2 rounded text-sm">保存</button>
            <button onClick={() => setShowTextForm(false)} className="border px-4 py-2 rounded text-sm">取消</button>
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
                    className={`flex-1 text-left py-2 pr-2 text-sm truncate ${selected?.top === top.name && !selected.sub ? 'bg-amber-100 text-amber-800 font-medium rounded' : 'hover:bg-slate-50'}`}>
                    {top.name} <span className="text-xs text-slate-400">({top.count})</span>
                  </button>
                  <button title="在 Finder 中打开此分类" onClick={() => openFolder(top.name)}
                    className="p-2 text-slate-400 hover:text-amber-600">
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>
                </div>
                {expanded[top.name] && (
                  <div className="ml-6">
                    {Object.entries(top.children).map(([sub, count]) => (
                      <button key={sub} onClick={() => { setSelected({ top: top.name, sub }); load({ top: top.name, sub }, q); }}
                        className={`w-full text-left px-2 py-1.5 text-xs truncate rounded ${selected?.sub === sub ? 'bg-amber-100 text-amber-800' : 'text-slate-600 hover:bg-slate-50'}`}>
                        {sub} <span className="text-slate-400">({count})</span>
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
            {shown.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0 hover:bg-slate-50">
                <FileText className="w-4 h-4 text-blue-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{t.name}</div>
                  <div className="text-xs text-slate-400">{t.category_path || t.category || '文本模板'}</div>
                </div>
                {t.is_file ? (
                  <a href={`/api/templates/${t.id}/download`}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:underline shrink-0">
                    <Download className="w-3.5 h-3.5" /> 下载
                  </a>
                ) : (
                  <span className="text-xs text-slate-400 shrink-0">文本模板</span>
                )}
              </div>
            ))}
            {templates.length === 0 && <div className="p-10 text-center text-slate-400 text-sm">未找到模板</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
