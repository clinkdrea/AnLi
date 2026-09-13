import { useEffect, useRef, useState } from 'react';
import { Upload, Download, Trash2, FileText, Image, FileArchive } from 'lucide-react';

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

export default function FilesTab({ caseId }: { caseId: string }) {
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    fetch(`/api/cases/${caseId}/files`, { credentials: 'include' })
      .then((r) => r.json()).then((d) => setFiles(d.files || []));
  };
  useEffect(() => { load(); }, [caseId]);

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    setLoading(true);
    const fd = new FormData();
    for (let i = 0; i < list.length; i++) fd.append('file', list[i]);
    try {
      await fetch(`/api/cases/${caseId}/files`, { method: 'POST', body: fd, credentials: 'include' });
      load();
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const del = async (id: number, name: string) => {
    if (!confirm(`确认删除文件「${name}」？`)) return;
    await fetch(`/api/files/${id}`, { method: 'DELETE', credentials: 'include' });
    load();
  };

  const ocrStatusLabel = (s: string) => ({
    pending: '待识别', processing: '识别中', done: '已识别', failed: '失败',
  }[s] || s);
  const ocrColor = (s: string) => ({
    pending: 'text-slate-400', processing: 'text-amber-500', done: 'text-green-600', failed: 'text-red-500',
  }[s] || '');

  const doOCR = async (id: number) => {
    await fetch(`/api/files/${id}/ocr`, { method: 'POST', credentials: 'include' });
    setTimeout(load, 2000);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">文件存放在案件文件夹中，支持 PDF / Word / Excel / 图片等</p>
        <button onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded text-sm">
          <Upload className="w-4 h-4" /> 上传文件
        </button>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={upload} />
      </div>
      {loading && <div className="text-sm text-amber-600 mb-2">上传中...</div>}
      <div className="bg-white rounded shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3">文件名</th>
              <th className="text-left px-4 py-3">大小</th>
              <th className="text-left px-4 py-3">上传人</th>
              <th className="text-left px-4 py-3">上传时间</th>
              <th className="text-left px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id} className="border-t hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <FileIcon name={f.file_name} />
                    <span>{f.file_name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-500">{formatSize(f.size)}</td>
                <td className="px-4 py-3 text-slate-500">{f.uploader_name}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs ${ocrColor(f.ocr_status)}`}>{ocrStatusLabel(f.ocr_status)}</span>
                  {['pending', 'failed'].includes(f.ocr_status) && (
                    <button onClick={() => doOCR(f.id)} className="ml-2 text-xs text-blue-600 hover:underline">识别</button>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <a href={`/api/files/${f.id}/download`} className="text-blue-600 hover:underline flex items-center gap-1">
                      <Download className="w-3 h-3" /> 下载
                    </a>
                    <button onClick={() => del(f.id, f.file_name)} className="text-red-500 hover:underline flex items-center gap-1">
                      <Trash2 className="w-3 h-3" /> 删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {files.length === 0 && <div className="p-8 text-center text-slate-400">暂无文件</div>}
      </div>
    </div>
  );
}
