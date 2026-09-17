import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Pencil, X, Paperclip, Download, Check } from 'lucide-react';
import OcrActions, { isImageFile } from './OcrActions';
import { RenameFileButton } from './RenameFile';

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

export default function EvidencesTab({ caseId }: { caseId: string }) {
  const [evidences, setEvidences] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [uploadingId, setUpUploadingId] = useState<number | null>(null);
  const [tip, setTip] = useState('');

  const load = () =>
    fetch(`/api/cases/${caseId}/evidences`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setEvidences(d.evidences || []));
  useEffect(() => { load(); }, [caseId]);

  // 有证据图片正在后台识别时，每 3 秒轮询刷新
  const hasProcessing = evidences.some((e) =>
    (e.files || []).some((f: any) => isImageFile(f.file_name) && f.ocr_status === 'processing'));
  useEffect(() => {
    if (!hasProcessing) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [hasProcessing]);

  // 已有分组（供新证据的 datalist 选择）
  const groups = Array.from(new Set(evidences.map((e) => e.group_name).filter(Boolean))) as string[];

  // 按分组聚合，无分组归入"未分组"并排在最后
  const grouped = (() => {
    const map = new Map<string, any[]>();
    for (const e of evidences) {
      const key = e.group_name || '未分组';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    const entries = Array.from(map.entries());
    entries.sort((a, b) => {
      if (a[0] === '未分组') return 1;
      if (b[0] === '未分组') return -1;
      return a[0].localeCompare(b[0], 'zh');
    });
    return entries;
  })();

  const del = async (id: number, name: string) => {
    if (!confirm(`确认删除证据「${name}」及其文件？`)) return;
    await fetch(`/api/evidences/${id}`, { method: 'DELETE', credentials: 'include' });
    load();
  };

  const delFile = async (eid: number, fid: number, name: string) => {
    if (!confirm(`确认删除文件「${name}」？`)) return;
    await fetch(`/api/evidences/${eid}/files/${fid}`, { method: 'DELETE', credentials: 'include' });
    load();
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
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-slate-500">证据按分组管理，支持一次选择多个文件上传；图片附件可点扫描图标 OCR 识别并查看文本</p>
        <button onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded text-sm">
          <Plus className="w-4 h-4" /> 添加证据
        </button>
      </div>

      {tip && <div className="text-sm text-amber-600 mb-2">{tip}</div>}

      {showForm && (
        <EvidenceForm caseId={caseId} groups={groups}
          onCancel={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }} />
      )}

      {grouped.length === 0 && !showForm && (
        <div className="bg-white rounded shadow p-10 text-center text-slate-400 text-sm">
          暂无证据，点击右上角"添加证据"开始登记
        </div>
      )}

      <div className="space-y-6">
        {grouped.map(([groupName, list]) => (
          <div key={groupName}>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-sm font-bold text-slate-700">{groupName}</h3>
              <span className="text-xs text-slate-400">{list.length} 项</span>
              <div className="flex-1 border-b border-slate-200 ml-2" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {list.map((e) => (
                <div key={e.id} className="bg-white rounded shadow p-4">
                  {editingId === e.id ? (
                    <EvidenceEditForm evidence={e} groups={groups}
                      onCancel={() => setEditingId(null)}
                      onSaved={() => { setEditingId(null); load(); }} />
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-sm">{e.name}</div>
                        <div className="flex gap-1 shrink-0">
                          <button onClick={() => setEditingId(e.id)} title="编辑证据信息"
                            className="text-slate-300 hover:text-amber-600">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => del(e.id, e.name)} title="删除证据"
                            className="text-slate-300 hover:text-red-500">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <dl className="text-xs text-slate-500 mt-1.5 space-y-0.5">
                        {e.source && <div><dt className="inline text-slate-400">来源：</dt><dd className="inline">{e.source}</dd></div>}
                        {e.purpose && <div><dt className="inline text-slate-400">证明目的：</dt><dd className="inline">{e.purpose}</dd></div>}
                        {e.remark && <div><dt className="inline text-slate-400">备注：</dt><dd className="inline">{e.remark}</dd></div>}
                      </dl>

                      {/* 文件列表 */}
                      <div className="mt-3 pt-3 border-t border-slate-100 space-y-1">
                        {e.files.length === 0 && <p className="text-xs text-slate-300">暂无附件</p>}
                        {e.files.map((f: any) => (
                          <div key={f.id} className="flex items-center gap-2 text-xs group">
                            <Paperclip className="w-3 h-3 text-slate-300 shrink-0" />
                            <button onClick={() => openLocal(f.id, f.file_name)}
                              title={`用本地应用打开 ${f.file_name}`}
                              className="text-slate-600 hover:text-amber-600 hover:underline truncate flex-1 text-left">
                              {f.file_name}
                            </button>
                            <span className="text-slate-300 shrink-0">{formatSize(f.size)}</span>
                            <RenameFileButton file={f} onRenamed={load}
                              className="text-slate-300 hover:text-amber-600 shrink-0" />
                            <OcrActions file={f} size="inline" onChanged={load} />
                            <a href={`/api/files/${f.id}/download`} title="下载"
                              className="text-slate-300 hover:text-blue-600 shrink-0">
                              <Download className="w-3.5 h-3.5" />
                            </a>
                            <button onClick={() => delFile(e.id, f.id, f.file_name)} title="删除文件"
                              className="text-slate-300 hover:text-red-500 shrink-0">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                        <AppendFilesButton evidenceId={e.id}
                          uploading={uploadingId === e.id}
                          onStart={() => setUpUploadingId(e.id)}
                          onDone={() => { setUpUploadingId(null); load(); }} />
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 追加文件（多选）
function AppendFilesButton({ evidenceId, uploading, onStart, onDone }: any) {
  const ref = useRef<HTMLInputElement>(null);
  const pick = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const list = ev.target.files;
    if (!list || list.length === 0) return;
    onStart();
    const fd = new FormData();
    for (let i = 0; i < list.length; i++) fd.append('file', list[i]);
    try {
      await fetch(`/api/evidences/${evidenceId}/files`, { method: 'POST', body: fd, credentials: 'include' });
      onDone();
    } finally {
      if (ref.current) ref.current.value = '';
    }
  };
  return (
    <>
      <button onClick={() => ref.current?.click()} disabled={uploading}
        className="flex items-center gap-1 text-xs text-amber-600 hover:underline disabled:opacity-50">
        <Plus className="w-3 h-3" /> {uploading ? '上传中...' : '追加文件（可多选）'}
      </button>
      <input ref={ref} type="file" multiple className="hidden" onChange={pick} />
    </>
  );
}

const INPUT = 'border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-400';

// 添加证据表单：元信息 + 多文件
function EvidenceForm({ caseId, groups, onCancel, onSaved }: any) {
  const [form, setForm] = useState({ name: '', group_name: '', source: '', purpose: '', remark: '' });
  const [files, setFiles] = useState<FileList | null>(null);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.name.trim()) { setErr('证据名称必填'); return; }
    setSaving(true); setErr('');
    const fd = new FormData();
    fd.append('name', form.name.trim());
    fd.append('group_name', form.group_name.trim());
    fd.append('source', form.source);
    fd.append('purpose', form.purpose);
    fd.append('remark', form.remark);
    if (files) for (let i = 0; i < files.length; i++) fd.append('file', files[i]);
    try {
      const r = await fetch(`/api/cases/${caseId}/evidences`, {
        method: 'POST', body: fd, credentials: 'include',
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || '保存失败');
      }
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded shadow p-4 mb-5">
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="text-slate-600 block mb-1">证据名称 <span className="text-red-500">*</span></span>
          <input className={`w-full ${INPUT}`} value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="text-sm">
          <span className="text-slate-600 block mb-1">分组（可选择已有分组或输入新分组）</span>
          <input className={`w-full ${INPUT}`} value={form.group_name} list="evidence-groups"
            onChange={(e) => setForm({ ...form, group_name: e.target.value })} placeholder="如：合同类证据、转账记录" />
          <datalist id="evidence-groups">
            {groups.map((g: string) => <option key={g} value={g} />)}
          </datalist>
        </label>
        <label className="text-sm">
          <span className="text-slate-600 block mb-1">证据来源</span>
          <input className={`w-full ${INPUT}`} value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })} />
        </label>
        <label className="text-sm">
          <span className="text-slate-600 block mb-1">证明目的</span>
          <input className={`w-full ${INPUT}`} value={form.purpose}
            onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
        </label>
        <label className="text-sm col-span-2">
          <span className="text-slate-600 block mb-1">备注</span>
          <input className={`w-full ${INPUT}`} value={form.remark}
            onChange={(e) => setForm({ ...form, remark: e.target.value })} />
        </label>
        <label className="text-sm col-span-2">
          <span className="text-slate-600 block mb-1">证据文件（可多选，也可保存后追加）</span>
          <input type="file" multiple className="text-sm"
            onChange={(e) => setFiles(e.target.files)} />
          {files && files.length > 0 && (
            <span className="text-xs text-slate-400 mt-1 block">已选 {files.length} 个文件</span>
          )}
        </label>
      </div>
      {err && <div className="text-red-500 text-sm mt-3">{err}</div>}
      <div className="flex gap-2 mt-4">
        <button onClick={submit} disabled={saving}
          className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white px-4 py-2 rounded text-sm flex items-center gap-1">
          {saving ? '保存中...' : <><Check className="w-4 h-4" /> 保存</>}
        </button>
        <button onClick={onCancel} className="border px-4 py-2 rounded text-sm">取消</button>
      </div>
    </div>
  );
}

// 编辑证据元信息
function EvidenceEditForm({ evidence, groups, onCancel, onSaved }: any) {
  const [form, setForm] = useState({
    name: evidence.name || '', group_name: evidence.group_name || '',
    source: evidence.source || '', purpose: evidence.purpose || '', remark: evidence.remark || '',
  });
  const [err, setErr] = useState('');
  const submit = async () => {
    if (!form.name.trim()) { setErr('证据名称必填'); return; }
    const r = await fetch(`/api/evidences/${evidence.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify(form),
    });
    if (!r.ok) { setErr('保存失败'); return; }
    onSaved();
  };
  return (
    <div className="space-y-2">
      <input className={`w-full ${INPUT}`} placeholder="证据名称 *" value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <input className={`w-full ${INPUT}`} placeholder="分组" list="evidence-groups-edit" value={form.group_name}
        onChange={(e) => setForm({ ...form, group_name: e.target.value })} />
      <datalist id="evidence-groups-edit">
        {groups.map((g: string) => <option key={g} value={g} />)}
      </datalist>
      <input className={`w-full ${INPUT}`} placeholder="证据来源" value={form.source}
        onChange={(e) => setForm({ ...form, source: e.target.value })} />
      <input className={`w-full ${INPUT}`} placeholder="证明目的" value={form.purpose}
        onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
      <input className={`w-full ${INPUT}`} placeholder="备注" value={form.remark}
        onChange={(e) => setForm({ ...form, remark: e.target.value })} />
      {err && <p className="text-xs text-red-500">{err}</p>}
      <div className="flex gap-2 pt-1">
        <button onClick={submit} className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded text-xs">保存</button>
        <button onClick={onCancel} className="border px-3 py-1.5 rounded text-xs">取消</button>
      </div>
    </div>
  );
}
