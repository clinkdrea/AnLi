import { useEffect, useRef, useState } from 'react';
import {
  Bot, Send, Sparkles, Briefcase, X, RefreshCw, DownloadCloud,
  CircleDot, AlertTriangle, User, Plus, Trash2, MessageSquare, FileText, Loader2,
} from 'lucide-react';
import { api } from '../api';

interface Msg { role: 'user' | 'assistant'; content: string }
interface Skill {
  name: string; description: string; version: string; author: string;
  enabled: boolean; isDefault: boolean;
}
interface Thread {
  id: number; case_id: number | null; title: string; model: string | null;
  created_at: string; last_used_at: string;
}
interface CaseOpt { id: number; case_no: string; name: string }

export default function AIAssistant() {
  const [caseOpts, setCaseOpts] = useState<CaseOpt[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [installedModels, setInstalledModels] = useState<string[]>([]);
  const [ollamaOnline, setOllamaOnline] = useState<boolean | null>(null);
  const [complaintReady, setComplaintReady] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [showSkills, setShowSkills] = useState(false);

  // 线程
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [threadCaseId, setThreadCaseId] = useState<number | ''>('');
  const [threadModel, setThreadModel] = useState('');

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [complaintResult, setComplaintResult] = useState<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const enabledSkills = skills.filter((s) => s.enabled);

  // 初始化
  useEffect(() => {
    refreshStatus();
    api('/cases/select').then((d) => setCaseOpts(d.cases || [])).catch(() => {});
    loadThreads();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const refreshStatus = async () => {
    try {
      const d = await api('/ai/status');
      setOllamaOnline(d.ollama?.online ?? false);
      setInstalledModels((d.ollama?.models || []).map((m: any) => m.name));
      const merged = Array.from(new Set([...(d.models || []), ...(d.ollama?.models || []).map((m: any) => m.name)]));
      setModels(merged);
      setComplaintReady(d.complaintReady);
    } catch { /* ignore */ }
    try {
      const s = await api('/ai/skills');
      setSkills(s.skills || []);
    } catch { /* ignore */ }
  };

  const loadThreads = async () => {
    try {
      const d = await api('/ai/threads');
      setThreads(d.threads || []);
    } catch { /* ignore */ }
  };

  const switchThread = async (tid: number) => {
    setActiveId(tid);
    setError('');
    setComplaintResult(null);
    try {
      const d = await api(`/ai/threads/${tid}/messages`);
      setMessages(d.messages || []);
      setThreadCaseId(d.thread?.case_id ?? '');
      setThreadModel(d.thread?.model || '');
    } catch (e: any) {
      setError(e.message || '加载线程失败');
    }
  };

  const newThread = async () => {
    try {
      const d = await api('/ai/threads', { method: 'POST', body: JSON.stringify({}) });
      setThreads((arr) => [d.thread, ...arr]);
      setActiveId(d.thread.id);
      setMessages([]);
      setThreadCaseId('');
      setThreadModel('');
      setError('');
      setComplaintResult(null);
    } catch (e: any) {
      setError(e.message || '新建线程失败');
    }
  };

  const removeThread = async (tid: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('确认删除该对话线程？')) return;
    try {
      await api(`/ai/threads/${tid}`, { method: 'DELETE' });
      setThreads((arr) => arr.filter((t) => t.id !== tid));
      if (activeId === tid) {
        setActiveId(null);
        setMessages([]);
      }
    } catch (e: any) {
      setError(e.message || '删除失败');
    }
  };

  // 切换线程绑定的案件
  const changeCase = async (val: number | '') => {
    if (!activeId) return;
    setThreadCaseId(val);
    try {
      const d = await api(`/ai/threads/${activeId}`, {
        method: 'PATCH', body: JSON.stringify({ case_id: val || null }),
      });
      setThreads((arr) => arr.map((t) => t.id === activeId ? d.thread : t));
    } catch (e: any) {
      setError(e.message || '更新失败');
    }
  };

  // 切换线程模型
  const changeModel = async (val: string) => {
    if (!activeId) return;
    setThreadModel(val);
    try {
      const d = await api(`/ai/threads/${activeId}`, {
        method: 'PATCH', body: JSON.stringify({ model: val }),
      });
      setThreads((arr) => arr.map((t) => t.id === activeId ? d.thread : t));
    } catch (e: any) {
      setError(e.message || '更新失败');
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending || !activeId) return;
    setError('');
    setMessages((arr) => [...arr, { role: 'user', content: text }]);
    setInput('');
    setSending(true);
    try {
      const d = await api(`/ai/threads/${activeId}/chat`, {
        method: 'POST',
        body: JSON.stringify({
          message: text,
          model: threadModel || undefined,
          skills: enabledSkills.map((s) => s.name),
        }),
      });
      setMessages((arr) => [...arr, { role: 'assistant', content: d.reply || '（无回复）' }]);
      // 刷新线程列表以更新标题/排序
      loadThreads();
    } catch (e: any) {
      setError(e.message || '请求失败');
      setMessages((arr) => arr.slice(0, -1)); // 移除用户占位
    } finally {
      setSending(false);
    }
  };

  const generateComplaint = async () => {
    if (!activeId || generating) return;
    setError('');
    setComplaintResult(null);
    setGenerating(true);
    try {
      const d = await api('/ai/agent/generate-complaint', {
        method: 'POST',
        body: JSON.stringify({
          case_id: threadCaseId || null,
          model: threadModel || undefined,
        }),
      });
      setComplaintResult(d);
      setMessages((arr) => [...arr, {
        role: 'assistant',
        content: `已生成要素式起诉状（案由：${d.case_type}）。\n请复核抽取要素后下载 docx。\n下载链接见下方。`,
      }]);
    } catch (e: any) {
      setError(e.message || '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const toggleSkill = async (s: Skill) => {
    const next = !s.enabled;
    setSkills((arr) => arr.map((x) => x.name === s.name ? { ...x, enabled: next } : x));
    try {
      const d = await api(`/ai/skills/${encodeURIComponent(s.name)}`, {
        method: 'PATCH', body: JSON.stringify({ enabled: next }),
      });
      setSkills(d.skills || []);
    } catch (e: any) {
      setError(e.message || '切换失败');
      setSkills((arr) => arr.map((x) => x.name === s.name ? { ...x, enabled: s.enabled } : x));
    }
  };

  const modelInstalled = installedModels.includes(threadModel);

  return (
    <div className="h-full flex">
      {/* 左侧线程列表 */}
      <aside className="w-60 shrink-0 bg-slate-50 border-r flex flex-col">
        <div className="p-3">
          <button onClick={newThread}
            className="w-full flex items-center justify-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded py-2 text-sm">
            <Plus className="w-4 h-4" /> 新建对话
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
          {threads.length === 0 && (
            <div className="text-xs text-slate-400 text-center py-6">暂无对话，点击上方新建</div>
          )}
          {threads.map((t) => (
            <div key={t.id}
              onClick={() => switchThread(t.id)}
              className={`group flex items-center gap-1.5 rounded px-2 py-2 cursor-pointer text-sm ${
                activeId === t.id ? 'bg-amber-100 text-amber-900' : 'hover:bg-slate-100 text-slate-700'
              }`}>
              <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-60" />
              <span className="flex-1 truncate">{t.title || '新对话'}</span>
              <button onClick={(e) => removeThread(t.id, e)}
                className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 shrink-0"
                title="删除线程">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* 右侧主区域 */}
      <div className="flex-1 flex flex-col min-w-0 p-4">
        {/* 顶部工具栏 */}
        <div className="bg-white rounded shadow px-4 py-2.5 mb-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 font-bold text-slate-800">
            <Bot className="w-5 h-5 text-amber-500" /> AI 律师助手
          </div>

          <div className="flex items-center gap-1.5">
            <Briefcase className="w-4 h-4 text-slate-400" />
            <select value={threadCaseId} onChange={(e) => changeCase(e.target.value ? Number(e.target.value) : '')}
              disabled={!activeId}
              className="border border-slate-300 rounded px-2 py-1.5 text-sm max-w-[240px] disabled:opacity-50">
              <option value="">不选案件（通用）</option>
              {caseOpts.map((c) => (
                <option key={c.id} value={c.id}>{c.case_no} · {c.name}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-slate-400" />
            <select value={threadModel} onChange={(e) => changeModel(e.target.value)}
              disabled={!activeId}
              className="border border-slate-300 rounded px-2 py-1.5 text-sm disabled:opacity-50">
              {!threadModel && <option value="">默认模型</option>}
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-1 text-xs"
            title={ollamaOnline ? `ollama 在线，已安装 ${installedModels.length} 个模型` : 'ollama 不在线'}>
            {ollamaOnline === null ? <span className="text-slate-400">检测中…</span>
              : ollamaOnline ? <span className="flex items-center gap-1 text-green-600"><CircleDot className="w-3.5 h-3.5" /> ollama</span>
              : <span className="flex items-center gap-1 text-red-500"><AlertTriangle className="w-3.5 h-3.5" /> ollama 未启动</span>}
          </div>

          <div className="flex-1" />

          <button onClick={generateComplaint} disabled={!activeId || !complaintReady || generating}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50"
            title="基于当前案件上下文生成要素式起诉状 docx">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            生成要素式起诉状
          </button>

          <button onClick={() => { setShowSkills(true); refreshStatus(); }}
            className="flex items-center gap-1.5 border border-slate-300 rounded px-3 py-1.5 text-sm hover:bg-slate-50">
            <Sparkles className="w-4 h-4 text-amber-500" />
            技能
            <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-1.5">{enabledSkills.length}</span>
          </button>
        </div>

        {/* 模型未安装提示 */}
        {ollamaOnline && threadModel && !modelInstalled && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded px-3 py-1.5 mb-2">
            本地未安装「{threadModel}」，请执行 <code className="bg-white px-1 rounded">ollama pull {threadModel}</code>
          </div>
        )}

        {/* 起诉状生成结果 */}
        {complaintResult && (
          <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-3 text-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-blue-800">要素式起诉状已生成（案由：{complaintResult.case_type}）</span>
              <button onClick={() => setComplaintResult(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            <a href={complaintResult.download_url}
              className="inline-flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded text-xs hover:bg-blue-700">
              <DownloadCloud className="w-3.5 h-3.5" /> 下载 docx（{(complaintResult.file_size / 1024).toFixed(1)} KB）
            </a>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-blue-700 hover:underline">查看抽取的要素（供复核）</summary>
              <pre className="mt-2 bg-white p-2 rounded text-xs overflow-auto max-h-60 whitespace-pre-wrap">
                {JSON.stringify(complaintResult.elements, null, 2)}
              </pre>
            </details>
          </div>
        )}

        {/* 对话区 */}
        <div ref={scrollRef} className="flex-1 bg-white rounded shadow overflow-y-auto p-5 space-y-4 min-h-[200px]">
          {!activeId ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
              <MessageSquare className="w-10 h-10 text-slate-300" />
              <div className="text-sm">请在左侧选择或新建一个对话线程</div>
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 gap-2 py-10">
              <Bot className="w-12 h-12 text-amber-300" />
              <div className="text-sm font-medium text-slate-500">律师专用 AI Agent</div>
              <div className="text-xs max-w-md">
                {threadCaseId
                  ? <>已挂载案件上下文（档案、当事人、案情记录、任务、文书资料与 OCR）</>
                  : '当前为通用模式，不携带案件数据；可在上方选择具体案件。'}
              </div>
              <div className="text-xs">
                当前模型：<span className="text-slate-600">{threadModel || '默认'}</span>；
                已启用技能：<span className="text-slate-600">{enabledSkills.length ? enabledSkills.map((s) => s.name).join('、') : '无'}</span>
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  m.role === 'user' ? 'bg-slate-700 text-white' : 'bg-amber-100 text-amber-700'}`}>
                  {m.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>
                <div className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
                  m.role === 'user' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-800'}`}>
                  {m.content}
                </div>
              </div>
            ))
          )}
          {sending && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="bg-slate-100 rounded-lg px-4 py-3 text-sm text-slate-400 flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> 思考中…
              </div>
            </div>
          )}
        </div>

        {error && <div className="text-xs text-red-600 mt-2">{error}</div>}

        {/* 输入区 */}
        <div className="bg-white rounded shadow mt-3 p-3 flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={2}
            disabled={!activeId}
            placeholder={activeId ? '输入问题…（Enter 发送，Shift+Enter 换行）' : '请先选择或新建对话线程'}
            className="flex-1 border border-slate-300 rounded px-3 py-2 text-sm resize-none focus:outline-none focus:border-amber-400 disabled:opacity-50"
          />
          <button onClick={send} disabled={sending || !input.trim() || !activeId}
            className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded text-sm flex items-center gap-1 disabled:opacity-50 shrink-0">
            <Send className="w-4 h-4" /> 发送
          </button>
        </div>
      </div>

      {/* 技能抽屉 */}
      {showSkills && (
        <div className="fixed inset-0 bg-black/40 z-40 flex justify-end" onClick={() => setShowSkills(false)}>
          <div className="bg-white w-[480px] max-w-full h-full flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div className="font-bold flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-500" /> 法律技能库
              </div>
              <button onClick={() => setShowSkills(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 py-3 border-b bg-slate-50 text-xs text-slate-500">
              技能来自 cat-xierluo/legal-skills，作为系统指令注入模型。默认仅启用「elements-complaint-generator」（要素式起诉状），其余可手动打开。
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {skills.map((s) => (
                <label key={s.name} className="block border rounded-lg p-3 hover:border-amber-300 cursor-pointer">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-slate-800">{s.name}</span>
                        {s.isDefault && <span className="text-[10px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">默认</span>}
                        {s.version && <span className="text-[10px] text-slate-400">v{s.version}</span>}
                      </div>
                      <div className="text-xs text-slate-500 mt-1 line-clamp-3">{s.description || '（无描述）'}</div>
                    </div>
                    <input type="checkbox" checked={s.enabled} onChange={() => toggleSkill(s)}
                      className="w-4 h-4 mt-1 accent-amber-500 shrink-0" />
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
