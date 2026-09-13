import { useEffect, useState, useRef } from 'react';
import { Send, Bot, User } from 'lucide-react';

export default function AITab({ caseId }: { caseId: string }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = () => fetch(`/api/cases/${caseId}/ai/history`, { credentials: 'include' })
    .then((r) => r.json()).then((d) => setMessages(d.messages || []));
  useEffect(() => { load(); }, [caseId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setMessages((m) => [...m, { role: 'user', content: userMsg }]);
    setInput('');
    setLoading(true);
    try {
      const r = await fetch(`/api/cases/${caseId}/ai/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ message: userMsg }),
      }).then((res) => res.json());
      if (r.error) setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${r.error}` }]);
      else setMessages((m) => [...m, { role: 'assistant', content: r.reply }]);
    } catch (e: any) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ 请求失败：${e.message}` }]);
    } finally { setLoading(false); }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto bg-white rounded shadow p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-slate-400 py-12">
            <Bot className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>AI 办案助手已就绪，可为您提供：</p>
            <p className="text-sm mt-1">· 案情摘要 · 法律分析 · 文书起草建议 · 争议焦点梳理</p>
            <p className="text-xs mt-2 text-slate-400">需启动 ollama 或配置 OPENAI_BASE_URL 环境变量</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${m.role === 'user' ? 'bg-amber-500' : 'bg-slate-600'}`}>
              {m.role === 'user' ? <User className="w-4 h-4 text-white" /> : <Bot className="w-4 h-4 text-white" />}
            </div>
            <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-amber-500 text-white' : 'bg-slate-100'}`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && <div className="text-sm text-slate-400 pl-10">AI 思考中...</div>}
        <div ref={endRef} />
      </div>
      <div className="flex gap-2 mt-3">
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="向 AI 提问..." className="flex-1 border border-slate-300 rounded px-4 py-2 text-sm" />
        <button onClick={send} disabled={loading}
          className="bg-amber-500 text-white px-4 py-2 rounded text-sm disabled:opacity-50 flex items-center gap-1">
          <Send className="w-4 h-4" /> 发送
        </button>
      </div>
    </div>
  );
}
