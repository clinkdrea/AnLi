import { useEffect, useState } from 'react';
import { api } from '../api';
import { Settings2, FolderOpen, Save } from 'lucide-react';

// 系统设置（仅管理员）：配置所有案件的主文件夹根路径、文书模板路径
export default function Settings() {
  const [root, setRoot] = useState('');
  const [tplRoot, setTplRoot] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/settings')
      .then((d: any) => {
        setRoot(d.settings?.cases_root || '');
        setTplRoot(d.settings?.templates_root || '');
      })
      .catch((e: any) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true); setMsg(''); setErr('');
    try {
      await api('/settings', { method: 'PUT', body: JSON.stringify({ cases_root: root, templates_root: tplRoot }) });
      setMsg('已保存');
      setTimeout(() => setMsg(''), 3000);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const INPUT = 'flex-1 border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500';

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2"><Settings2 className="w-5 h-5 text-amber-500" /> 系统设置</h1>
        <p className="text-xs text-slate-400 mt-1">管理员配置，普通用户不可见。</p>
      </div>

      <div className="bg-white rounded-lg shadow p-5">
        <label className="text-sm font-medium text-slate-700 block mb-1">案件主文件夹根路径</label>
        <p className="text-xs text-slate-400 mb-2">
          所有案件的文书都存放在该路径下、以「案件编号-案件名」命名的子文件夹中。
          可填局域网共享网盘在本机的挂载路径（如 /Volumes/共享盘/案理）；留空则使用服务器默认目录。
        </p>
        <input value={root} onChange={(e) => setRoot(e.target.value)}
          disabled={loading}
          placeholder="留空使用默认目录，或填写绝对路径，如 /Volumes/共享盘/案理"
          className={`w-full ${INPUT}`} />

        <div className="mt-6 border-t pt-5">
          <label className="text-sm font-medium text-slate-700 block mb-1">文书模板路径</label>
          <p className="text-xs text-slate-400 mb-2">
            文书模板文件（Word / PDF / WPS 等）存放的根路径，子文件夹即模板分类。
            可填局域网共享网盘中的模板库挂载路径（如 /Volumes/共享盘/律师文书模板）；留空则使用服务器默认模板目录。
          </p>
          <input value={tplRoot} onChange={(e) => setTplRoot(e.target.value)}
            disabled={loading}
            placeholder="留空使用默认目录，或填写绝对路径，如 /Volumes/共享盘/律师文书模板"
            className={`w-full ${INPUT}`} />
        </div>

        <div className="flex items-center gap-3 mt-6">
          <button onClick={save} disabled={saving || loading}
            className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50">
            <Save className="w-4 h-4" /> {saving ? '保存中...' : '保存'}
          </button>
          {msg && <span className="text-green-600 text-sm">{msg}</span>}
          {err && <span className="text-red-500 text-sm">{err}</span>}
        </div>

        <div className="mt-5 border-t pt-3 text-xs text-slate-500 space-y-1.5">
          <div className="flex items-center gap-1 text-slate-600 font-medium">
            <FolderOpen className="w-3.5 h-3.5" /> 使用说明
          </div>
          <div>· 修改案件路径后，请把已有案件的文件夹移动到新根路径下的同名子文件夹；迁移完成前，系统会自动回退到原位置，文件仍可访问。</div>
          <div>· 修改模板路径后，请把已有模板文件按原目录结构移动到新路径（模板用相对路径索引），再到「文书模板」页点「扫描」刷新。</div>
          <div>· 网盘未挂载时，新建案件会提示路径不可用，不会在本机误建空目录；模板路径不可用时，扫描不会删除已有模板记录。</div>
          <div>· 在案件「文书资料」页可直接「打开文件夹」；在文件夹内增删改文件后，刷新列表即可同步。</div>
        </div>
      </div>
    </div>
  );
}
