import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FileScan, Play, Pause, RotateCw, Trash2, X, FileText, Loader2, ExternalLink, Folder, Monitor, Cloud, Settings2, Save, ChevronRight, ChevronDown, FileImage, FileArchive, HelpCircle, Sparkles, Zap, Gauge } from 'lucide-react';

// 树状文件节点
type FileNode = {
  name: string;           // 显示名（最后一段）
  path: string;           // 完整相对路径
  isFolder: boolean;
  children: FileNode[];   // 仅文件夹有
  file?: any;             // 叶子文件对应的 file_records 记录
  ext?: string;           // 小写后缀（文件类型筛选用）
};

// OCR 中心：独立页面 / 案件内弹窗 共用
// 独立页面：用户选择文件来源（案件文件 / 本地路径 / 浏览器上传）
// 案件内弹窗：固定来源=案件文件，直接列当前案件文件

type CaseBrief = { id: number; case_no: string; name: string };
type OcrJob = {
  id: number;
  file_name: string;
  case_id: number | null;
  case_no?: string;
  case_name?: string;
  engine: string;
  ocr_format: string;
  compress_preset?: string | null;
  status: 'pending' | 'processing' | 'paused' | 'done' | 'failed' | 'canceled';
  total_pages: number;
  done_pages: number;
  failed_pages: number;
  error_msg: string | null;
  current_hint?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
};

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  pending: { text: '待处理', cls: 'text-slate-500 bg-slate-100' },
  processing: { text: '识别中', cls: 'text-amber-600 bg-amber-100' },
  paused: { text: '已暂停', cls: 'text-slate-600 bg-slate-100' },
  done: { text: '已完成', cls: 'text-green-600 bg-green-100' },
  failed: { text: '失败', cls: 'text-red-600 bg-red-100' },
  canceled: { text: '已取消', cls: 'text-slate-400 bg-slate-100' },
};

const ENGINE_LABEL: Record<string, string> = {
  rapidocr: 'RapidOCR（极速，通用）',
  paddleocr: 'PaddleOCR（精度最高，扫描件最佳）',
  vision: 'macOS Vision（系统原生，图片专用）',
  docling: 'Docling（版面分析 + 表格 + 公式）',
  mineru: 'MinerU（云端 VLM，可选 Agent/Token 模式）',
};

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function isOcrTarget(name: string) {
  return /\.(pdf|docx|pptx|xlsx|jpg|jpeg|png|tiff|tif|heic|webp|gif|bmp)$/i.test(name);
}

// 按 rel_path 把文件列表聚合成树
function buildFileTree(files: any[]): FileNode {
  const root: FileNode = { name: '', path: '', isFolder: true, children: [] };
  const byPath = new Map<string, FileNode>();
  byPath.set('', root);

  for (const f of files) {
    // rel_path 形如 "文件夹A/子文件夹B/文件名.pdf"；根目录文件的 rel_path 等于 file_name
    const rel: string = f.rel_path || f.file_name || '';
    const parts = rel.split(/[\\/]/).filter(Boolean);
    if (parts.length === 0) continue;

    // 逐级创建文件夹节点
    let parentPath = '';
    let parent = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      const segPath = parentPath ? `${parentPath}/${seg}` : seg;
      let node = byPath.get(segPath);
      if (!node) {
        node = { name: seg, path: segPath, isFolder: true, children: [] };
        byPath.set(segPath, node);
        parent.children.push(node);
      }
      parentPath = segPath;
      parent = node;
    }

    // 最后一段 = 文件
    const fname = parts[parts.length - 1];
    const fpath = parentPath ? `${parentPath}/${fname}` : fname;
    const ext = (fname.split('.').pop() || '').toLowerCase();
    const leaf: FileNode = { name: fname, path: fpath, isFolder: false, children: [], file: f, ext };
    parent.children.push(leaf);
  }

  // 排序：文件夹在前，按 name 升序
  const sortNode = (n: FileNode) => {
    n.children.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
    n.children.forEach(sortNode);
  };
  sortNode(root);
  return root;
}

// 类型过滤：按 ext 分组
type TypeBucket = { label: string; exts: string[]; icon: any };
const TYPE_BUCKETS: TypeBucket[] = [
  { label: '全部', exts: [], icon: FileText },
  { label: 'PDF', exts: ['pdf'], icon: FileText },
  { label: 'Word', exts: ['docx'], icon: FileText },
  { label: 'PPT', exts: ['pptx'], icon: FileText },
  { label: 'Excel', exts: ['xlsx'], icon: FileText },
  { label: '图片', exts: ['jpg', 'jpeg', 'png', 'tiff', 'tif', 'heic', 'webp', 'gif', 'bmp'], icon: FileImage },
  { label: '压缩包', exts: ['zip', 'rar', '7z'], icon: FileArchive },
];

// ============ 树状节点渲染（递归） ============
function TreeNodeList(props: {
  nodes: FileNode[];
  depth: number;
  selectedFileIds: Set<number>;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onToggleFile: (id: number) => void;
  onSelectFolder: (node: FileNode, checked: boolean) => void;
  folderLeafCount: (node: FileNode) => number;
  folderSelectedCount: (node: FileNode) => number;
}) {
  const { nodes, depth, selectedFileIds, expandedFolders, onToggleFolder, onToggleFile, onSelectFolder, folderLeafCount, folderSelectedCount } = props;
  const indent = depth * 14;

  return (
    <>
      {nodes.map((node) => {
        if (node.isFolder) {
          const isOpen = expandedFolders.has(node.path);
          const total = folderLeafCount(node);
          const sel = folderSelectedCount(node);
          const indeterminate = sel > 0 && sel < total;
          const allSel = sel === total && total > 0;
          return (
            <div key={node.path}>
              <div className="flex items-center gap-1.5 px-2 py-1 hover:bg-slate-50 text-xs border-b border-slate-100 last:border-b-0 group">
                <button
                  onClick={() => onToggleFolder(node.path)}
                  className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-600 shrink-0"
                  style={{ marginLeft: indent }}
                  aria-label={isOpen ? '折叠' : '展开'}>
                  {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </button>
                <input
                  type="checkbox"
                  checked={allSel}
                  ref={(el) => { if (el) el.indeterminate = indeterminate; }}
                  onChange={(e) => onSelectFolder(node, e.target.checked)}
                  className="shrink-0"
                />
                <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className="text-slate-700 truncate flex-1 font-medium">{node.name}</span>
                <span className="text-[10px] text-slate-400 shrink-0">{sel}/{total}</span>
              </div>
              {isOpen && (
                <TreeNodeList
                  nodes={node.children}
                  depth={depth + 1}
                  selectedFileIds={selectedFileIds}
                  expandedFolders={expandedFolders}
                  onToggleFolder={onToggleFolder}
                  onToggleFile={onToggleFile}
                  onSelectFolder={onSelectFolder}
                  folderLeafCount={folderLeafCount}
                  folderSelectedCount={folderSelectedCount}
                />
              )}
            </div>
          );
        }

        // 文件节点
        const f: any = node.file;
        const ext = node.ext || '';
        const extColor: Record<string, string> = {
          pdf: 'text-red-500', docx: 'text-blue-500', pptx: 'text-orange-500',
          xlsx: 'text-green-600', jpg: 'text-purple-500', png: 'text-purple-500',
          tiff: 'text-purple-500', tif: 'text-purple-500', heic: 'text-purple-500',
        };
        const Icon = ['jpg', 'jpeg', 'png', 'tiff', 'tif', 'heic', 'webp', 'gif', 'bmp'].includes(ext)
          ? FileImage : FileText;

        return (
          <label
            key={node.path}
            className="flex items-center gap-1.5 px-2 py-1 hover:bg-slate-50 cursor-pointer text-xs border-b border-slate-100 last:border-b-0">
            <span style={{ width: indent + 16 }} />
            <input type="checkbox" checked={selectedFileIds.has(f.id)} onChange={() => onToggleFile(f.id)} />
            <Icon className={`w-3.5 h-3.5 shrink-0 ${extColor[ext] || 'text-slate-400'}`} />
            <span className="text-slate-700 truncate flex-1">{node.name}</span>
            <span className="text-slate-400 shrink-0">{formatSize(f.size || 0)}</span>
          </label>
        );
      })}
    </>
  );
}

// ============ 引擎帮助数据 ============
type EngineHelp = {
  key: string;
  name: string;
  tag: string;
  icon: any;       // lucide icon component
  color: string;    // tailwind color class
  accuracy: string;
  speed: string;
  modelSize: string;
  prereq: string;
  pros: string[];
  cons: string[];
  bestFor: string;
};
const ENGINE_HELP: EngineHelp[] = [
  {
    key: 'rapidocr', name: 'RapidOCR', tag: '快速', icon: Zap, color: 'text-emerald-500',
    accuracy: '★★★', speed: '极快（毫秒级）', modelSize: '小（~30MB ONNX）',
    prereq: 'pip install rapidocr-onnxruntime',
    pros: ['本地运行，不联网', '首次装完即秒开', '资源占用低'],
    cons: ['扫描件手写/公章识别弱', '复杂版面不分析'],
    bestFor: '电子 PDF、纯打字印刷体、大批量快速扫描件',
  },
  {
    key: 'paddleocr', name: 'PaddleOCR', tag: '精度最高', icon: Gauge, color: 'text-blue-500',
    accuracy: '★★★★★', speed: '快（~1s/页）', modelSize: '中（~100MB）',
    prereq: 'pip install paddlepaddle paddleocr（首次自动下模型）',
    pros: ['自带方向分类（旋转倒置自动矫正）', '手写/签名也能识别', '中英文混合最优', '工业级 baseline'],
    cons: ['模型较大，首次加载稍慢', '显存/内存占用略高'],
    bestFor: '扫描件、手写笔录、公章文件、中英混排法律文书',
  },
  {
    key: 'vision', name: 'macOS Vision', tag: '图片专用', icon: Sparkles, color: 'text-indigo-500',
    accuracy: '★★★', speed: '极快（系统原生）', modelSize: '0（系统自带）',
    prereq: '无需安装（macOS 原生框架）',
    pros: ['零依赖，装完即用', '图片专用效率最高', '隐私本地处理'],
    cons: ['仅支持图片（PNG/JPG）', '不支持 PDF 分页', '中文略逊于 PaddleOCR'],
    bestFor: '单张截图、手机拍照文书、快速查看不存档',
  },
  {
    key: 'docling', name: 'Docling', tag: '版面+表格', icon: FileText, color: 'text-purple-500',
    accuracy: '★★★★★', speed: '较慢（~3s/页）', modelSize: '大（~300MB）',
    prereq: 'pip install docling（需 Python 3.10+，首次下载 770 个权重文件）',
    pros: ['自动版面分析（标题/段落/表格/公式分开）', '表格转 Markdown', '支持 PDF 内嵌图片 OCR'],
    cons: ['首次装耗时 3-5 分钟', '整份 PDF 一次性阻塞处理', 'CPU 吃紧'],
    bestFor: '学术论文、合同表格、带公式/图表的专业文书',
  },
  {
    key: 'mineru', name: 'MinerU', tag: '云端 VLM', icon: Cloud, color: 'text-amber-500',
    accuracy: '★★★★★', speed: '慢（~10-30s/页）', modelSize: 'N/A（云端 API）',
    prereq: 'Agent Pipeline（免Token，≤10MB/≤20页）\nPrecision VLM（需 mineru.net Token，≤200MB/≤600页，每天 2000 页免费）',
    pros: ['VLM 大模型理解版面', '表格/公式/版面统一输出', 'Agent Pipeline 免Token 零门槛'],
    cons: ['慢，依赖网络', 'Agent Pipeline 有 IP 排队', '上传到第三方云'],
    bestFor: '超大文件、版式极复杂、追求完美版面还原',
  },
];

// ============ 独立页面（侧边栏入口） ============
export default function OcrCenterPage() {
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // 支持从案件文书页跳转时预选案件：/ocr?case=<案件 id>
  const [searchParams] = useSearchParams();
  const prefillCase = Number(searchParams.get('case')) || null;
  return (
    <div className="p-6 max-w-[1400px] mx-auto h-[calc(100vh-80px)] flex flex-col min-h-0">
      <div className="mb-4 flex items-start justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <FileScan className="w-5 h-5 text-amber-500" /> OCR 中心
            <button
              onClick={() => setShowHelp(true)}
              title="引擎选择帮助"
              className="ml-1 group inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-100 hover:bg-amber-100 transition">
              <HelpCircle className="w-3.5 h-3.5 text-slate-400 group-hover:text-amber-600" />
            </button>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            左栏创建任务，右栏队列管理。支持 PDF / Word / 图片，默认保留 14 天自动清理。
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setShowHelp(true)}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-amber-600 hover:bg-amber-50 px-3 py-1.5 rounded border border-slate-200">
            <HelpCircle className="w-3.5 h-3.5" /> 引擎对比
          </button>
          <button onClick={() => setShowSettings(true)}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-amber-600 hover:bg-amber-50 px-3 py-1.5 rounded border border-slate-200">
            <Settings2 className="w-3.5 h-3.5" /> 设置
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
      <OcrCenterInner caseId={null} initialCaseId={prefillCase} caseFiles={null} onClose={null} showSettings={showSettings} setShowSettings={setShowSettings} />
      </div>
      {showHelp && <EngineHelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}

// 共用核心组件（命名导出供 FilesTab 使用）
export function OcrCenter({ caseId, caseFiles, onClose, showSettings: showSettingsOuter, setShowSettings: setShowSettingsOuter }: {
  caseId: number | string | null;
  caseFiles: any[] | null;
  onClose: (() => void) | null;
  showSettings?: boolean;
  setShowSettings?: (v: boolean) => void;
}) {
  const isStandalone = caseId === null;
  return (
    <>
      {!isStandalone && onClose && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
          <div className="bg-white rounded-lg w-[720px] max-w-[92vw] max-h-[86vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
              <h3 className="font-bold flex items-center gap-2">
                <FileScan className="w-5 h-5 text-amber-500" /> OCR 中心
              </h3>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <OcrCenterInner caseId={caseId} caseFiles={caseFiles} onClose={onClose} />
            </div>
          </div>
        </div>
      )}
      {isStandalone && <OcrCenterInner caseId={null} caseFiles={null} onClose={null}
        showSettings={showSettingsOuter} setShowSettings={setShowSettingsOuter} />}
    </>
  );
}

// ============ 内部实现 ============
type Source = 'case' | 'path' | 'upload';

function OcrCenterInner({ caseId, initialCaseId = null, caseFiles, onClose, showSettings, setShowSettings }: {
  caseId: number | string | null;
  initialCaseId?: number | null;
  caseFiles: any[] | null;
  onClose: (() => void) | null;
  showSettings?: boolean;
  setShowSettings?: (v: boolean) => void;
}) {
  const isStandalone = caseId === null;
  const navigate = useNavigate();

  // 配置
  const [engine, setEngine] = useState('rapidocr');
  const [format, setFormat] = useState('markdown');

  // PDF 预压缩
  const [compressEnabled, setCompressEnabled] = useState(false);
  const [compressPreset, setCompressPreset] = useState<'printer' | 'ebook' | 'screen'>('ebook');
  const [compressAvailable, setCompressAvailable] = useState<boolean | null>(null);

  // 设置（OCR 结果目录 + MinerU API + 保存天数）
  const [ocrSettings, setOcrSettings] = useState<{
    ocr_results: string; ocr_results_default: string;
    mineru_api_base: string; mineru_api_token: string; mineru_api_token_configured: boolean;
    ocr_retention_days: number;
  }>({
    ocr_results: '', ocr_results_default: '',
    mineru_api_base: '', mineru_api_token: '', mineru_api_token_configured: false,
    ocr_retention_days: 14,
  });
  const [savingSettings, setSavingSettings] = useState(false);

  // 加载设置（仅独立页面需要）
  useEffect(() => {
    if (!isStandalone) return;
    fetch('/api/settings', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        setOcrSettings({
          ocr_results: d.settings?.ocr_results || '',
          ocr_results_default: d.settings?.ocr_results_default || '',
          mineru_api_base: d.settings?.mineru_api_base || '',
          mineru_api_token: '',  // 后端不返回明文 token
          mineru_api_token_configured: !!d.settings?.mineru_api_token_configured,
          ocr_retention_days: Number(d.settings?.ocr_retention_days ?? 14),
        });
      })
      .catch(() => {});
  }, [isStandalone]);

  // 检测 ghostscript 压缩能力（任何人都可以查）
  useEffect(() => {
    fetch('/api/ocr/compress-capability', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setCompressAvailable(!!d.available))
      .catch(() => setCompressAvailable(false));
  }, []);

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const body: any = {
        ocr_results: ocrSettings.ocr_results,
        ocr_retention_days: ocrSettings.ocr_retention_days,
      };
      if (ocrSettings.mineru_api_base) body.mineru_api_base = ocrSettings.mineru_api_base;
      // 只有用户在 token 输入框填了东西才提交（空字符串表示不改）
      if (ocrSettings.mineru_api_token !== '') body.mineru_api_token = ocrSettings.mineru_api_token;

      const r = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error || '保存失败');
      const d = await r.json();
      setOcrSettings({
        ocr_results: d.settings?.ocr_results || '',
        ocr_results_default: d.settings?.ocr_results_default || '',
        mineru_api_base: d.settings?.mineru_api_base || '',
        mineru_api_token: '',
        mineru_api_token_configured: !!d.settings?.mineru_api_token_configured,
        ocr_retention_days: Number(d.settings?.ocr_retention_days ?? 14),
      });
      alert('设置已保存');
    } catch (e: any) { alert(e.message); }
    finally { setSavingSettings(false); }
  };

  // 文件来源（独立页面可选；弹窗固定 case）
  const [source, setSource] = useState<Source>(isStandalone ? 'case' : 'case');

  // 案件文件相关
  const [allCases, setAllCases] = useState<CaseBrief[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(
    caseId ? Number(caseId) : (initialCaseId ?? null)
  );
  const [caseFileMap, setCaseFileMap] = useState<Record<number, any[]>>({});
  const [selectedFileIds, setSelectedFileIds] = useState<Set<number>>(new Set());
  // 树状列表状态
  const [typeFilter, setTypeFilter] = useState<string>('全部');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['']));

  // 本地路径相关
  const [pathInput, setPathInput] = useState('');
  const [pathIsDir, setPathIsDir] = useState(false);
  const [pathOutputDir, setPathOutputDir] = useState('');
  const [pathError, setPathError] = useState('');
  const [pathSubmitting, setPathSubmitting] = useState(false);

  // 浏览器上传相关
  const [uploadSubmitting, setUploadSubmitting] = useState(false);

  // 任务
  const [jobs, setJobs] = useState<OcrJob[]>([]);
  const [viewJob, setViewJob] = useState<OcrJob | null>(null);

  const INPUT = 'w-full border border-slate-300 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:border-amber-400';

  // 加载案件列表
  useEffect(() => {
    if (!isStandalone) return;
    fetch('/api/cases', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        const cases: CaseBrief[] = d.cases || [];
        setAllCases(cases);
        // 预选案件若不在可访问列表中（无权限/已删除）则回退到第一个
        setSelectedCaseId((prev) => {
          if (prev && cases.some((c) => c.id === prev)) return prev;
          return cases.length > 0 ? cases[0].id : null;
        });
      })
      .catch(() => {});
  }, [isStandalone]);

  // 加载案件文件（独立页面：按 selectedCaseId；弹窗：直接用传入的 caseFiles）
  useEffect(() => {
    if (!isStandalone && caseFiles) return;
    if (selectedCaseId == null) return;
    fetch(`/api/cases/${selectedCaseId}/files`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        const files = (d.files || []).filter((f: any) => isOcrTarget(f.file_name));
        setCaseFileMap((m) => ({ ...m, [selectedCaseId]: files }));
      })
      .catch(() => {});
  }, [selectedCaseId, isStandalone, caseId]);

  // 弹窗模式：整理传入的 caseFiles
  const popupCaseFiles = !isStandalone && caseFiles
    ? caseFiles.filter((f: any) => isOcrTarget(f.file_name))
    : [];

  const currentCaseFiles = isStandalone
    ? (selectedCaseId != null ? caseFileMap[selectedCaseId] || [] : [])
    : popupCaseFiles;

  // 按筛选条件过滤出参与建树的文件（仅 OCR 目标 + 类型匹配）
  const typeExts = TYPE_BUCKETS.find((b) => b.label === typeFilter)?.exts || [];
  const visibleFiles = useMemo(
    () =>
      currentCaseFiles.filter((f: any) => {
        if (!isOcrTarget(f.file_name)) return false;
        if (typeExts.length === 0) return true;
        const ext = (f.file_name.split('.').pop() || '').toLowerCase();
        return typeExts.includes(ext);
      }),
    [currentCaseFiles, typeExts.join(',')],
  );

  const fileTree = useMemo(() => buildFileTree(visibleFiles), [visibleFiles]);

  // 折叠 / 展开
  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const s = new Set(prev);
      if (s.has(path)) s.delete(path); else s.add(path);
      return s;
    });
  };

  // 全选：选中 visibleFiles 所有文件
  const selectAllVisible = () => {
    const ids = visibleFiles.map((f: any) => f.id);
    setSelectedFileIds((prev) => {
      const s = new Set(prev);
      ids.forEach((id) => s.add(id));
      return s;
    });
  };

  // 递归：文件夹内全部勾选
  const selectFolder = (node: FileNode, checked: boolean) => {
    const collect = (n: FileNode, out: any[]) => {
      if (!n.isFolder && n.file) out.push(n.file.id);
      n.children.forEach((c) => collect(c, out));
    };
    const ids: number[] = [];
    collect(node, ids);
    setSelectedFileIds((prev) => {
      const s = new Set(prev);
      ids.forEach((id) => (checked ? s.add(id) : s.delete(id)));
      return s;
    });
  };

  // 统计一个文件夹下的叶子文件数（用于 "勾选/取消" 判断）
  const folderLeafCount = (node: FileNode): number => {
    if (!node.isFolder) return 1;
    return node.children.reduce((a, c) => a + folderLeafCount(c), 0);
  };
  const folderSelectedCount = (node: FileNode): number => {
    if (!node.isFolder) return selectedFileIds.has(node.file!.id) ? 1 : 0;
    return node.children.reduce((a, c) => a + folderSelectedCount(c), 0);
  };

  // 加载任务
  const loadJobs = () => {
    let url = '/api/ocr/jobs';
    if (!isStandalone) url += `?case_id=${caseId}`;
    fetch(url, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setJobs(d.jobs || []))
      .catch(() => {});
  };
  useEffect(() => { loadJobs(); }, [caseId, isStandalone]);
  useEffect(() => {
    const hasActive = jobs.some((j) => j.status === 'processing');
    if (!hasActive) return;
    const t = setInterval(loadJobs, 2000);
    return () => clearInterval(t);
  }, [jobs]);

  const toggleFile = (id: number) => {
    setSelectedFileIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const createFromCaseFiles = async () => {
    if (selectedFileIds.size === 0) return;
    try {
      const files = currentCaseFiles
        .filter((f: any) => selectedFileIds.has(f.id))
        .map((f: any) => ({ file_id: f.id }));
      const r = await fetch('/api/ocr/jobs/from-file', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engine, ocr_format: format, files,
          compress_preset: compressEnabled ? compressPreset : null,
          case_id: isStandalone ? selectedCaseId : Number(caseId),
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      const d = await r.json();
      setSelectedFileIds(new Set());
      loadJobs();
      const ok = d.created ?? d.job_ids?.length ?? 0;
      const fail = d.errors?.length ?? 0;
      if (ok > 0 && fail > 0) {
        alert(`成功创建 ${ok} 个任务，${fail} 个失败（详见服务器日志）`);
      } else if (fail > 0 && ok === 0) {
        alert(`全部失败：${d.errors?.[0]?.error || d.error || '未知原因'}`);
      }
    } catch (e: any) {
      alert(`创建失败：${e.message || e}`);
    }
  };

  const submitPath = async () => {
    setPathError('');
    if (!pathInput.trim()) { setPathError('请输入路径'); return; }
    setPathSubmitting(true);
    try {
      const r = await fetch('/api/ocr/jobs/from-path', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_path: pathInput.trim(),
          is_dir: pathIsDir,
          output_dir: pathIsDir ? pathOutputDir.trim() : '',
          engine, ocr_format: format,
          compress_preset: compressEnabled ? compressPreset : null,
        }),
      });
      if (!r.ok) {
        const err = (await r.json()).error || '创建失败';
        setPathError(err.includes('不存在') ? '路径不存在，请检查' : err);
        return;
      }
      const data = await r.json();
      const msg = pathIsDir
        ? `已创建 ${data.count || 0} 个 OCR 任务，输出目录：${data.output_dir || '默认'}`
        : 'OCR 任务已创建';
      setPathInput(''); setPathOutputDir('');
      alert(msg);
      loadJobs();
    } catch (e: any) {
      setPathError(e.message);
    } finally {
      setPathSubmitting(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploadSubmitting(true);
    const form = new FormData();
    form.append('engine', engine);
    form.append('ocr_format', format);
    form.append('compress_preset', compressEnabled ? compressPreset : '');
    for (let i = 0; i < files.length; i++) form.append('files', files[i]);
    try {
      const r = await fetch('/api/ocr/upload', { method: 'POST', credentials: 'include', body: form });
      if (!r.ok) throw new Error((await r.json()).error || '上传失败');
      loadJobs();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setUploadSubmitting(false);
    }
    e.target.value = '';
  };

  const action = async (id: number, act: string) => {
    await fetch(`/api/ocr/jobs/${id}/${act}`, { method: 'POST', credentials: 'include' });
    loadJobs();
  };
  const removeJob = async (id: number) => {
    if (!confirm('确定删除该 OCR 任务？')) return;
    await fetch(`/api/ocr/jobs/${id}`, { method: 'DELETE', credentials: 'include' });
    loadJobs();
  };

  const totalOcrJobs = jobs.filter((j) => j.status === 'processing').length;
  const [resetting, setResetting] = useState(false);

  const handleResetScheduler = async () => {
    if (!confirm('⚠️ 重置 OCR 调度器？\n\n将执行：\n  • 强制 kill 所有 OCR Python 子进程\n  • 强制 kill 所有 ghostscript 压缩进程\n  • 清空所有内部队列\n  • processing / paused / failed 任务回退为 pending\n\n已完成的页面不会丢失（断点续做自动生效）。\n确定要重置吗？')) return;
    setResetting(true);
    try {
      const res = await fetch('/api/ocr/reset', {
        method: 'POST', credentials: 'include',
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || '重置失败');
      const summary = [
        d.killed_python ? `kill ${d.killed_python} 个 Python 进程` : null,
        d.killed_ghostscript ? `kill ${d.killed_ghostscript} 个 ghostscript 进程` : null,
        d.reset_jobs ? `reset ${d.reset_jobs} 个任务` : null,
        d.reset_pages ? `reset ${d.reset_pages} 个页面` : null,
      ].filter(Boolean).join('，');
      alert(`✅ 调度器已重置\n${summary || '无活跃进程'}\n\n任务回到 pending 状态，等待调度器自动恢复。`);
      loadJobs();
    } catch (e: any) {
      alert(`❌ 重置失败: ${e.message}`);
    } finally {
      setResetting(false);
    }
  };

  // === 渲染 ===
  return (
    <>
      {/* 左右两栏布局 */}
      <div className="flex gap-4 h-full min-h-0">
        {/* 左栏：创建任务 */}
        <div className="flex-1 min-w-0 flex flex-col gap-3 overflow-y-auto pr-1">
          {/* Step 1: 文件来源（独立页面才显示，弹窗固定 case） */}
          {isStandalone && (
            <div>
              <div className="text-xs text-slate-500 mb-2 font-medium">第一步：选择文件来源</div>
              <div className="grid grid-cols-3 gap-2">
                <SourceCard
                  active={source === 'case'}
                  onClick={() => setSource('case')}
                  icon={<Folder className="w-5 h-5" />}
                  title="案件文件"
                  desc="从已有案件的文书中选择"
                />
                <SourceCard
                  active={source === 'path'}
                  onClick={() => setSource('path')}
                  icon={<Monitor className="w-5 h-5" />}
                  title="本地路径直指定"
                  desc="服务器文件绝对路径，零上传（推荐大文件）"
                />
                <SourceCard
                  active={source === 'upload'}
                  onClick={() => setSource('upload')}
                  icon={<Cloud className="w-5 h-5" />}
                  title="浏览器上传"
                  desc="从本地上传文件，最大 10GB"
                />
              </div>
            </div>
          )}

          {/* Step 2+3: 根据来源显示选择器 + 引擎格式 + 创建按钮 */}
          <div className="bg-slate-50 rounded-lg p-4">
        {/* 案件文件 */}
        {(source === 'case' || !isStandalone) && (
          <div className="space-y-3">
            {isStandalone && (
              <div>
                <div className="text-xs text-slate-500 mb-1">选择案件</div>
                <select
                  value={selectedCaseId ?? ''}
                  onChange={(e) => {
                    setSelectedCaseId(e.target.value ? Number(e.target.value) : null);
                    setSelectedFileIds(new Set());
                  }}
                  className={`${INPUT} max-w-[360px]`}>
                  <option value="">请选择案件...</option>
                  {allCases.map((c: CaseBrief) => (
                    <option key={c.id} value={c.id}>{c.case_no} · {c.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs text-slate-500">
                  该案件下的可 OCR 文件
                  {visibleFiles.length > 0 && (
                    <span className="text-slate-400">
                      （筛选后 {visibleFiles.length} / 全部 {currentCaseFiles.length}，已选 {selectedFileIds.size}）
                    </span>
                  )}
                </div>
                {currentCaseFiles.length > 0 && (
                  <div className="flex gap-2 text-[11px]">
                    <button onClick={selectAllVisible}
                      className="text-amber-600 hover:underline">全选当前</button>
                    <button onClick={() => setSelectedFileIds(new Set())}
                      className="text-slate-400 hover:underline">清空</button>
                  </div>
                )}
              </div>

              {/* 类型筛选 */}
              {currentCaseFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {TYPE_BUCKETS.map((b) => {
                    const Icon = b.icon;
                    const active = typeFilter === b.label;
                    return (
                      <button key={b.label}
                        onClick={() => setTypeFilter(b.label)}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border transition-colors ${
                          active
                            ? 'bg-amber-50 border-amber-300 text-amber-700'
                            : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}>
                        <Icon className="w-3 h-3" />
                        {b.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* 树状文件列表 */}
              <div className="max-h-56 overflow-y-auto border border-slate-200 rounded bg-white">
                {currentCaseFiles.length === 0 ? (
                  <div className="text-xs text-slate-400 p-4 text-center">
                    {isStandalone
                      ? selectedCaseId
                        ? '该案件暂无可 OCR 的文书'
                        : '请先选择案件'
                      : '该案件暂无可 OCR 的文书'}
                  </div>
                ) : visibleFiles.length === 0 ? (
                  <div className="text-xs text-slate-400 p-4 text-center">
                    当前筛选条件下无可识别文件
                  </div>
                ) : (
                  <TreeNodeList
                    nodes={fileTree.children}
                    depth={0}
                    selectedFileIds={selectedFileIds}
                    expandedFolders={expandedFolders}
                    onToggleFolder={toggleFolder}
                    onToggleFile={toggleFile}
                    onSelectFolder={selectFolder}
                    folderLeafCount={folderLeafCount}
                    folderSelectedCount={folderSelectedCount}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {/* 本地路径 */}
        {source === 'path' && isStandalone && (
          <div className="space-y-3">
            <div className="text-xs text-slate-500">
              直接填写服务器上的绝对路径。几 GB 的大文件选这个，零上传开销。
            </div>

            {/* 类型切换 */}
            <div className="flex gap-3 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={pathIsDir} onChange={(e) => setPathIsDir(e.target.checked)}
                  className="rounded border-slate-300 text-amber-500 focus:ring-amber-400" />
                <span className="text-slate-600">这是一个文件夹（批量处理里面的文件）</span>
              </label>
            </div>

            {/* 路径输入 */}
            <div className="flex gap-2">
              <input value={pathInput} onChange={(e) => { setPathInput(e.target.value); setPathError(''); }}
                placeholder={pathIsDir ? '/Volumes/大硬盘/法律文书/待识别文件夹' : '/Volumes/大硬盘/法律文书/超大扫描件.pdf'}
                className="flex-1 border border-slate-300 rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-amber-400" />
            </div>

            {/* 输出目录（文件夹模式专属） */}
            {pathIsDir && (
              <div className="bg-white border border-slate-200 rounded p-3 space-y-2">
                <div className="text-xs text-slate-500">
                  结果输出目录（留空默认在源路径旁建
                  <code className="bg-slate-100 px-1 rounded mx-0.5">文件夹名_output</code>）
                </div>
                <input value={pathOutputDir} onChange={(e) => setPathOutputDir(e.target.value)}
                  placeholder="例如：/Volumes/大硬盘/法律文书/识别结果"
                  className="w-full border border-slate-300 rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-amber-400" />
                <div className="text-[11px] text-slate-400">
                  文件夹模式下，目录内每个文件会生成一个 OCR 任务，结果文件（Markdown/Word/JSON）都放到这个输出目录里，文件名与源文件对应。
                </div>
              </div>
            )}

            {pathError && <div className="text-xs text-red-500">{pathError}</div>}
          </div>
        )}

        {/* 浏览器上传 */}
        {source === 'upload' && isStandalone && (
          <div>
            <div
              className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-amber-400 hover:bg-amber-50/30 transition-colors cursor-pointer"
              onClick={() => document.getElementById('ocr-file-upload')?.click()}>
              <input id="ocr-file-upload" type="file" multiple
                accept=".pdf,.docx,.pptx,.xlsx,.jpg,.jpeg,.png,.tiff,.tif,.heic,.webp,.gif,.bmp"
                className="hidden" onChange={handleUpload} disabled={uploadSubmitting} />
              <Cloud className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <div className="text-xs text-slate-600">
                {uploadSubmitting ? '上传中...' : '点击选择文件 或 拖拽到此处'}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">PDF / Word / PPT / Excel / 图片，最大 10GB</div>
            </div>
          </div>
        )}

        {/* 引擎 + 格式（固定在配置区底部，所有来源都需要） */}
        <div className="mt-4 pt-3 border-t border-slate-200 grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-slate-500 mb-1">OCR 引擎</div>
            <select value={engine} onChange={(e) => setEngine(e.target.value)} className={INPUT}>
              <option value="rapidocr">RapidOCR — 极速，通用</option>
              <option value="paddleocr">PaddleOCR — 精度最高，扫描件最佳</option>
              <option value="vision">macOS Vision — 系统原生，图片专用</option>
              <option value="docling">Docling — 版面分析 + 表格 + 公式</option>
              <option value="mineru" disabled style={{ color: '#999' }}>MinerU — 云端 VLM（开发中，暂不可用）</option>
            </select>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">输出格式</div>
            <select value={format} onChange={(e) => setFormat(e.target.value)} className={INPUT}>
              <option value="markdown">Markdown（推荐）</option>
              <option value="docx">Word 文档（带排版）</option>
              <option value="json">JSON</option>
              <option value="plain">纯文本</option>
            </select>
          </div>
        </div>

        {/* PDF 预压缩（ghostscript） */}
        {compressAvailable !== false && (
          <div className="mt-3 bg-white border border-slate-200 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="compress-toggle"
                  checked={compressEnabled}
                  onChange={(e) => setCompressEnabled(e.target.checked)}
                  className="rounded border-slate-300 text-amber-500 focus:ring-amber-400"
                />
                <label htmlFor="compress-toggle" className="text-xs font-medium text-slate-700 cursor-pointer">
                  PDF 预压缩
                  {compressAvailable === null && <span className="ml-1 text-[10px] text-slate-400">检测中...</span>}
                  {compressAvailable === true && <span className="ml-1 text-[10px] text-green-600">✓ ghostscript 可用</span>}
                </label>
              </div>
              <span className="text-[10px] text-slate-400">仅 PDF 文件生效，不影响图片/Word</span>
            </div>

            {compressEnabled && (
              <div className="mt-2 space-y-2">
                <div className="text-[11px] text-slate-500">选择压缩档位：</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { key: 'printer', label: '保守', desc: '几乎不压' },
                    { key: 'ebook', label: '推荐', desc: '压 50-70%，无损' },
                    { key: 'screen', label: '激进', desc: '压 80-90%，可能有损失' },
                  ].map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setCompressPreset(p.key as any)}
                      className={`px-2 py-1.5 rounded text-[11px] border transition-colors text-left ${
                        compressPreset === p.key
                          ? 'bg-amber-50 border-amber-300 text-amber-700'
                          : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                      }`}>
                      <div className="font-medium">{p.label}</div>
                      <div className="text-[10px] text-slate-400">{p.desc}</div>
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-slate-400 leading-relaxed bg-slate-50 rounded px-2 py-1.5">
                  实测：223MB 扫描件 <code className="bg-white px-1 rounded">ebook</code> → 67MB（压 70%），OCR 识别率无损。<br />
                  压缩在 OCR 前自动执行，大文件（&gt;20MB）效果最明显；已高度压缩的 PDF 可能跳过。
                </div>
              </div>
            )}
          </div>
        )}

        {/* 底部大创建按钮：根据来源显示不同文案 */}
        <CreateButton
          source={isStandalone ? source : 'case'}
          caseSelected={selectedFileIds.size}
          caseTotal={currentCaseFiles.length}
          pathInput={pathInput}
          pathSubmitting={pathSubmitting}
          pathIsDir={pathIsDir}
          uploadSubmitting={uploadSubmitting}
          pathOutputDir={pathOutputDir}
          onCreateCase={createFromCaseFiles}
          onCreatePath={submitPath}
        />
      </div>
        </div>{/* /左栏 */}

        {/* 右栏：任务队列 */}
        <div className="w-[480px] shrink-0 flex flex-col bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50">
            <div className="text-sm font-medium text-slate-700">
              任务队列
              {totalOcrJobs > 0 && (
                <span className="ml-2 text-xs text-amber-600 animate-pulse">识别中 {totalOcrJobs}</span>
              )}
              {jobs.length > 0 && totalOcrJobs === 0 && (
                <span className="ml-2 text-xs text-slate-400">共 {jobs.length}</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={handleResetScheduler} disabled={resetting}
                title="强制重置：杀掉所有 OCR/ghostscript 进程，把卡住的任务回退为 pending"
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  resetting
                    ? 'text-slate-400 border-slate-200 cursor-not-allowed'
                    : 'text-slate-500 border-slate-200 hover:bg-slate-100 hover:text-slate-700'
                }`}>
                {resetting ? '重置中...' : '🔄 重置调度器'}
              </button>
              <button onClick={loadJobs} className="text-xs text-slate-400 hover:text-amber-600">刷新</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
        {jobs.length === 0 ? (
          <div className="text-center text-slate-400 text-sm py-8">暂无 OCR 任务</div>
        ) : (
          <div className="space-y-2">
            {jobs.map((j) => {
              const done = j.done_pages || 0;
              const total = j.total_pages || 1;
              const pct = j.status === 'done' ? 100 : Math.round((done / total) * 100);
              const st = STATUS_LABEL[j.status];
              return (
                <div key={j.id} className="bg-white border border-slate-200 rounded p-3">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-4 h-4 text-blue-500 shrink-0" />
                      <span className="truncate text-slate-800">{j.file_name}</span>
                      {isStandalone && j.case_no && (
                        <button onClick={() => navigate?.(`/cases/${j.case_id}`)}
                          className="text-[11px] text-slate-400 hover:text-amber-600 shrink-0 flex items-center gap-0.5">
                          <ExternalLink className="w-3 h-3" /> {j.case_no}
                        </button>
                      )}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded ${st.cls}`}>{st.text}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-1">
                    <span>{ENGINE_LABEL[j.engine] || j.engine}</span>
                    <span>{j.ocr_format}</span>
                    {j.total_pages > 1 && <span>{j.done_pages}/{j.total_pages} 页</span>}
                    {j.status === 'done' && j.started_at && j.finished_at && (() => {
                      const sec = Math.round(
                        (new Date(j.finished_at).getTime() - new Date(j.started_at).getTime()) / 1000
                      );
                      const t = sec < 60 ? `${sec}秒` : sec < 3600 ? `${Math.floor(sec / 60)}分${sec % 60}秒` : `${Math.floor(sec / 3600)}时${Math.floor((sec % 3600) / 60)}分`;
                      return <span className="text-green-600">用时 {t}</span>;
                    })()}
                    {j.status === 'failed' && j.error_msg && (
                      <span className="text-red-500 truncate max-w-[200px]" title={j.error_msg}>
                        {j.error_msg}
                      </span>
                    )}
                    {j.current_hint && j.status === 'processing' && (
                      <span className="text-amber-600 truncate max-w-[200px]" title={j.current_hint}>
                        {j.current_hint}
                      </span>
                    )}
                  </div>
                  {j.status !== 'pending' && j.status !== 'canceled' && (
                    <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${j.status === 'done' ? 'bg-green-500' : 'bg-amber-500'} transition-all`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-1 mt-2">
                    {j.status === 'pending' && (
                      <button onClick={() => action(j.id, 'start')}
                        className="flex items-center gap-1 text-xs text-amber-600 hover:bg-amber-50 px-2 py-1 rounded">
                        <Play className="w-3 h-3" /> 启动
                      </button>
                    )}
                    {j.status === 'processing' && (
                      <button onClick={() => action(j.id, 'pause')}
                        className="flex items-center gap-1 text-xs text-slate-600 hover:bg-slate-50 px-2 py-1 rounded">
                        <Pause className="w-3 h-3" /> 暂停
                      </button>
                    )}
                    {j.status === 'paused' && (
                      <button onClick={() => action(j.id, 'resume')}
                        className="flex items-center gap-1 text-xs text-amber-600 hover:bg-amber-50 px-2 py-1 rounded">
                        <Play className="w-3 h-3" /> 继续
                      </button>
                    )}
                    {(j.status === 'failed' || j.status === 'canceled') && (
                      <button onClick={() => action(j.id, 'retry')}
                        className="flex items-center gap-1 text-xs text-amber-600 hover:bg-amber-50 px-2 py-1 rounded">
                        <RotateCw className="w-3 h-3" /> 重试
                      </button>
                    )}
                    {j.status === 'done' && (
                      <>
                        {/* 打开预览：md/json/txt 浏览器可原生 inline，docx 不支持 */}
                        {j.ocr_format !== 'docx' && (
                          <button
                            onClick={async () => {
                              try {
                                const resp = await fetch(`/api/ocr/jobs/${j.id}/download?mode=open`, { credentials: 'include' });
                                if (!resp.ok) throw new Error('打开失败');
                                const blob = await resp.blob();
                                const url = URL.createObjectURL(blob);
                                window.open(url, '_blank');
                                // 窗口加载后释放 blob URL（延迟一些时间）
                                setTimeout(() => URL.revokeObjectURL(url), 30000);
                              } catch (err: any) { alert(err.message); }
                            }}
                            className="flex items-center gap-1 text-xs text-blue-600 hover:bg-blue-50 px-2 py-1 rounded">
                            <ExternalLink className="w-3 h-3" /> 打开预览
                          </button>
                        )}
                        {/* 下载（所有格式） */}
                        <button
                          onClick={async () => {
                            try {
                              const resp = await fetch(`/api/ocr/jobs/${j.id}/download`, { credentials: 'include' });
                              if (!resp.ok) throw new Error('下载失败');
                              const blob = await resp.blob();
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              const extMap: Record<string, string> = { markdown: 'md', json: 'json', plain: 'txt', docx: 'docx' };
                              const ext = extMap[j.ocr_format] || j.ocr_format;
                              const base = j.file_name.replace(/\.[^.]+$/, '');
                              a.download = `${base}_ocr.${ext}`;
                              document.body.appendChild(a); a.click(); document.body.removeChild(a);
                              URL.revokeObjectURL(url);
                            } catch (err: any) { alert(err.message); }
                          }}
                          className="flex items-center gap-1 text-xs text-green-600 hover:bg-green-50 px-2 py-1 rounded">
                          <FileText className="w-3 h-3" /> 下载
                        </button>
                        {/* 在 Finder 中显示（macOS） */}
                        <button
                          onClick={async () => {
                            try {
                              const resp = await fetch(`/api/ocr/jobs/${j.id}/reveal`, {
                                method: 'POST', credentials: 'include',
                              });
                              if (!resp.ok) {
                                const data = await resp.json().catch(() => ({}));
                                throw new Error(data.error || '打开 Finder 失败');
                              }
                            } catch (err: any) { alert(err.message); }
                          }}
                          className="flex items-center gap-1 text-xs text-slate-600 hover:bg-slate-100 px-2 py-1 rounded">
                          <Folder className="w-3 h-3" /> 在 Finder 显示
                        </button>
                      </>
                    )}
                    {(j.status === 'processing' || j.status === 'paused') && (
                      <button onClick={() => action(j.id, 'cancel')}
                        className="flex items-center gap-1 text-xs text-red-500 hover:bg-red-50 px-2 py-1 rounded">
                        取消
                      </button>
                    )}
                    <button onClick={() => removeJob(j.id)}
                      className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 hover:bg-red-50 px-2 py-1 rounded ml-auto">
                      <Trash2 className="w-3 h-3" /> 删除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
          </div>{/* /scroll */}
        </div>{/* /右栏 */}
      </div>{/* /flex */}

      {viewJob && <ResultModal job={viewJob} onClose={() => setViewJob(null)} />}

      {/* 设置弹窗（仅独立页面显示） */}
      {isStandalone && showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowSettings?.(false)}>
          <div className="bg-white rounded-lg w-[480px] max-w-[92vw]"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
              <h3 className="font-bold flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-amber-500" /> OCR 中心设置
              </h3>
              <button onClick={() => setShowSettings?.(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  OCR 结果存放目录
                </label>
                <input
                  type="text"
                  value={ocrSettings.ocr_results}
                  onChange={(e) => setOcrSettings((s) => ({ ...s, ocr_results: e.target.value }))}
                  placeholder={ocrSettings.ocr_results_default}
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                />
                <div className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  留空则使用默认目录 <code className="bg-slate-100 px-1 rounded">{ocrSettings.ocr_results_default}</code><br />
                  需输入服务器上的绝对路径（如 <code className="bg-slate-100 px-1 rounded">/Volumes/共享盘/OCR结果</code>）
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-slate-700">
                    MinerU Cloud API Token
                  </label>
                  {ocrSettings.mineru_api_token_configured ? (
                    <span className="text-[11px] text-green-600 bg-green-50 px-2 py-0.5 rounded">✓ 已配置</span>
                  ) : (
                    <span className="text-[11px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded">未配置</span>
                  )}
                </div>
                <input
                  type="password"
                  value={ocrSettings.mineru_api_token}
                  onChange={(e) => setOcrSettings((s) => ({ ...s, mineru_api_token: e.target.value }))}
                  placeholder={ocrSettings.mineru_api_token_configured ? '已保存，留空不改；填入则更新' : '粘贴 MinerU API Token（可选）'}
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500 font-mono"
                />
                <div className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  Token 可选：不填默认用 Agent Pipeline 轻量模型（免Token，≤10MB，≤20页）；<br />
                  配置 Token 后自动升级为 Precision VLM 精准模式（≤200MB，≤600页，每天2000页免费）<br />
                  前往 <a href="https://mineru.net" target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">mineru.net</a> 注册获取 Token
                </div>

                <label className="block text-[12px] text-slate-600 mt-2 mb-1">API Base URL（高级，默认不用改）</label>
                <input
                  type="text"
                  value={ocrSettings.mineru_api_base}
                  onChange={(e) => setOcrSettings((s) => ({ ...s, mineru_api_base: e.target.value }))}
                  placeholder="https://mineru.net"
                  className="w-full border border-slate-300 rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-100">
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  任务记录保留天数
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={ocrSettings.ocr_retention_days}
                    onChange={(e) => setOcrSettings((s) => ({ ...s, ocr_retention_days: Math.max(0, parseInt(e.target.value || '0', 10)) }))}
                    className="w-24 border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-amber-500"
                  />
                  <span className="text-xs text-slate-500">天</span>
                  {ocrSettings.ocr_retention_days === 0 && (
                    <span className="text-[11px] text-green-600 bg-green-50 px-2 py-0.5 rounded">永久保留</span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  默认 14 天。超过天数的已完成 / 失败 / 已取消任务，启动时和每小时自动删除记录并同步清理对应的结果文件夹<br />
                  设为 0 = 永久保留（不再自动清理）
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
              <button onClick={() => setShowSettings?.(false)}
                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800">
                取消
              </button>
              <button onClick={() => { saveSettings(); setShowSettings?.(false); }}
                disabled={savingSettings}
                className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white px-4 py-1.5 rounded text-sm disabled:opacity-50">
                <Save className="w-3.5 h-3.5" /> {savingSettings ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// 底部大创建按钮（三种来源共用，文案/点击/禁用态各不同）
function CreateButton(props: {
  source: 'case' | 'path' | 'upload';
  caseSelected: number;
  caseTotal: number;
  pathInput: string;
  pathSubmitting: boolean;
  pathIsDir: boolean;
  uploadSubmitting: boolean;
  pathOutputDir: string;
  onCreateCase: () => void;
  onCreatePath: () => void;
}) {
  const { source, caseSelected, caseTotal, pathInput, pathSubmitting, pathIsDir, uploadSubmitting, onCreateCase, onCreatePath } = props;

  let label = '';
  let disabled = false;
  let onClick: (() => void) | null = null;
  let hint: string | null = null;

  if (source === 'case') {
    if (caseTotal === 0) {
      label = '请先选择案件'; disabled = true;
    } else if (caseSelected === 0) {
      label = `已选 0 / ${caseTotal} 个文件`; disabled = true; hint = '☑ 左侧勾选文件后可创建';
    } else {
      label = `创建 OCR 任务（${caseSelected} 个文件）`; onClick = onCreateCase;
    }
  } else if (source === 'path') {
    if (!pathInput.trim()) {
      label = '请先填写服务器绝对路径'; disabled = true;
    } else if (pathSubmitting) {
      label = '提交中...'; disabled = true;
    } else {
      label = pathIsDir ? '批量创建任务（文件夹）' : '创建 OCR 任务'; onClick = onCreatePath;
    }
  } else { // upload
    if (uploadSubmitting) {
      label = '上传中...'; disabled = true;
    } else {
      label = '点击上方拖拽区或选择文件开始上传'; disabled = true; hint = '选文件即自动提交，不需要点此按钮';
    }
  }

  return (
    <div className="mt-3">
      <button
        onClick={() => onClick?.()}
        disabled={disabled || !onClick}
        className={`w-full text-sm py-2.5 rounded font-medium transition flex items-center justify-center gap-1.5 ${
          disabled || !onClick
            ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
            : 'bg-amber-500 hover:bg-amber-600 text-white shadow-sm'
        }`}>
        {pathSubmitting || uploadSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {label}
      </button>
      {hint && (
        <div className="mt-1 text-[11px] text-slate-400 text-center">{hint}</div>
      )}
    </div>
  );
}

// 文件来源选择卡片
function SourceCard({ active, onClick, icon, title, desc }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; title: string; desc: string;
}) {
  return (
    <button onClick={onClick}
      className={`text-left p-3 rounded-lg border-2 transition-all ${
        active
          ? 'border-amber-500 bg-amber-50 shadow-sm'
          : 'border-slate-200 bg-white hover:border-amber-300 hover:bg-slate-50'
      }`}>
      <div className={`mb-1 ${active ? 'text-amber-600' : 'text-slate-500'}`}>{icon}</div>
      <div className={`text-sm font-medium ${active ? 'text-amber-700' : 'text-slate-700'}`}>{title}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{desc}</div>
    </button>
  );
}

// ============ 引擎帮助弹窗 ============
function EngineHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={onClose}>
      <div className="bg-white rounded-xl w-[900px] max-w-[95vw] max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-amber-50 to-white rounded-t-xl">
          <h3 className="text-base font-bold flex items-center gap-2 text-slate-800">
            <HelpCircle className="w-5 h-5 text-amber-500" />
            OCR 引擎选择指南
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* 快速对比表 */}
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">快速对比</div>
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <table className="w-full text-[12px]">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">引擎</th>
                    <th className="px-3 py-2 text-left font-medium">精度</th>
                    <th className="px-3 py-2 text-left font-medium">速度</th>
                    <th className="px-3 py-2 text-left font-medium">模型</th>
                    <th className="px-3 py-2 text-left font-medium">最佳场景</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ENGINE_HELP.map((e) => {
                    const Icon = e.icon;
                    return (
                      <tr key={e.key} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium flex items-center gap-1.5">
                          <Icon className={`w-3.5 h-3.5 ${e.color}`} /> {e.name}
                        </td>
                        <td className="px-3 py-2 text-slate-700">{e.accuracy}</td>
                        <td className="px-3 py-2 text-slate-600">{e.speed}</td>
                        <td className="px-3 py-2 text-slate-600">{e.modelSize}</td>
                        <td className="px-3 py-2 text-slate-500 truncate max-w-[240px]" title={e.bestFor}>{e.bestFor}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 引擎详细卡片 */}
          <div className="space-y-3">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">详细说明</div>
            {ENGINE_HELP.map((e) => {
              const Icon = e.icon;
              return (
                <div key={e.key} className="rounded-lg border border-slate-200 p-4 hover:border-amber-300 hover:shadow-sm transition">
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-lg ${e.color.replace('text-', 'bg-').replace('500', '50')} flex items-center justify-center shrink-0`}>
                      <Icon className={`w-5 h-5 ${e.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-800">{e.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{e.tag}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 whitespace-pre-line">依赖: {e.prereq}</div>

                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3">
                        <div className="text-[11px] text-slate-500">
                          <span className="text-emerald-600 font-medium">✓ 优势</span>
                          <ul className="list-disc list-inside mt-0.5 space-y-0.5 text-slate-600">
                            {e.pros.map((p, i) => <li key={i}>{p}</li>)}
                          </ul>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          <span className="text-rose-500 font-medium">✗ 不足</span>
                          <ul className="list-disc list-inside mt-0.5 space-y-0.5 text-slate-600">
                            {e.cons.map((p, i) => <li key={i}>{p}</li>)}
                          </ul>
                        </div>
                      </div>

                      <div className="mt-2 text-[11px] text-slate-500">
                        <span className="text-amber-600 font-medium">★ 适用</span>
                        <span className="ml-1 text-slate-600">{e.bestFor}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 选择建议 */}
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
            <div className="text-xs font-semibold text-amber-800 mb-2">💡 快速选择建议</div>
            <div className="space-y-1 text-[12px] text-amber-900 leading-relaxed">
              <div>• <b>扫描件 / 手写 / 公章</b> → <b className="text-blue-700">PaddleOCR</b>（精度最高，自带方向矫正）</div>
              <div>• <b>电子 PDF / 纯打字</b> → <b className="text-emerald-700">RapidOCR</b>（极快，够用）</div>
              <div>• <b>合同表格 / 带公式</b> → <b className="text-purple-700">Docling</b>（版面分析 + 表格转 Markdown）</div>
              <div>• <b>截图 / 手机拍照</b> → <b className="text-indigo-700">macOS Vision</b>（系统原生，零依赖）</div>
              <div>• <b>大文件 / 超复杂版式</b> → <b className="text-amber-700">MinerU</b>（云端 VLM 大模型理解版面）</div>
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 rounded-b-xl flex justify-end">
          <button onClick={onClose} className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-4 py-1.5 rounded">我知道了</button>
        </div>
      </div>
    </div>
  );
}

// 结果查看弹窗
function ResultModal({ job, onClose }: { job: OcrJob; onClose: () => void }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/ocr/jobs/${job.id}/result`, { credentials: 'include' })
      .then((r) => r.text())
      .then(setText)
      .catch(() => setText('(加载失败)'))
      .finally(() => setLoading(false));
  }, [job.id]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]" onClick={onClose}>
      <div className="bg-white rounded-lg p-5 w-[640px] max-w-[90vw] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold flex items-center gap-2 min-w-0">
            <FileScan className="w-5 h-5 text-amber-500 shrink-0" />
            <span className="truncate">OCR 结果：{job.file_name}</span>
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" /> 加载中...
          </div>
        ) : (
          <pre className="flex-1 overflow-y-auto whitespace-pre-wrap break-words text-sm bg-slate-50 border border-slate-200 rounded p-3 leading-6 font-sans">
{text || '(无识别文本)'}
          </pre>
        )}
        <div className="flex justify-end mt-3">
          <button onClick={onClose}
            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded text-sm">
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
