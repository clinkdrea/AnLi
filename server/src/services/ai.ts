// AI 助手服务：兼容 ollama 本地 / OpenAI 兼容外部接口
import { db } from '../db/schema.js';
import { config } from '../config.js';

// 配置：优先使用 OLLAMA_URL，否则使用 OPENAI_BASE_URL
const OLLAMA_URL = config.OLLAMA_URL;
const OPENAI_BASE_URL = config.OPENAI_BASE_URL;
const OPENAI_API_KEY = config.OPENAI_API_KEY;
const MODEL = config.AI_MODEL;

interface Msg { role: 'system' | 'user' | 'assistant'; content: string; }

// 构建带案情上下文的系统提示
function buildSystemPrompt(caseData?: any): string {
  let prompt = '你是案理平台的法律办案助手。请基于以下案件信息协助律师工作，回答应简洁专业。';
  if (caseData) {
    prompt += `\n\n【案件信息】\n编号：${caseData.case_no}\n名称：${caseData.name}\n类型：${caseData.type}`;
    if (caseData.legal?.cause) prompt += `\n案由：${caseData.legal.cause}`;
    if (caseData.parties?.length) {
      prompt += '\n当事人：';
      for (const p of caseData.parties) {
        prompt += `\n  ${p.side === 'our' ? '我方' : p.side === 'opponent' ? '对方' : '第三人'}：${p.name}`;
      }
    }
    if (caseData.recentNotes?.length) {
      prompt += '\n近期案情记录：';
      for (const n of caseData.recentNotes.slice(0, 10)) {
        prompt += `\n  - ${n.content.slice(0, 200)}`;
      }
    }
  }
  return prompt;
}

async function callLLM(messages: Msg[]): Promise<string> {
  // 优先 ollama
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages, stream: false }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.message?.content || '';
    }
  } catch {
    // ollama 不可用，尝试外部接口
  }

  // 外部 OpenAI 兼容接口
  if (OPENAI_BASE_URL) {
    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: MODEL, messages }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    }
    throw new Error(`AI 接口返回 ${res.status}`);
  }

  throw new Error('未配置可用的 AI 服务（需启动 ollama 或配置 OPENAI_BASE_URL）');
}

export async function chat(caseId: number, userMessage: string, history?: Msg[]): Promise<string> {
  const caseRow = db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId) as any;
  if (!caseRow) throw new Error('案件不存在');

  const parties = db.prepare('SELECT side, name FROM case_parties WHERE case_id = ?').all(caseId);
  const legal = db.prepare('SELECT * FROM case_legal_info WHERE case_id = ?').get(caseId);
  const recentNotes = db.prepare('SELECT content FROM case_notes WHERE case_id = ? ORDER BY created_at DESC LIMIT 10').all(caseId);

  const systemPrompt = buildSystemPrompt({
    ...caseRow, parties, legal, recentNotes,
  });

  const messages: Msg[] = [
    { role: 'system', content: systemPrompt },
    ...(history || []),
    { role: 'user', content: userMessage },
  ];

  const reply = await callLLM(messages);

  // 保存对话
  const existing = db.prepare('SELECT messages FROM ai_conversations WHERE case_id = ?').get(caseId) as any;
  const allMsgs = existing ? JSON.parse(existing.messages) : [];
  allMsgs.push({ role: 'user', content: userMessage });
  allMsgs.push({ role: 'assistant', content: reply });
  if (existing) {
    db.prepare('UPDATE ai_conversations SET messages = ?, updated_at = datetime(\'now\') WHERE case_id = ?')
      .run(JSON.stringify(allMsgs.slice(-50)), caseId);
  } else {
    db.prepare('INSERT INTO ai_conversations (case_id, model, messages) VALUES (?, ?, ?)')
      .run(caseId, MODEL, JSON.stringify(allMsgs.slice(-50)));
  }

  return reply;
}

export function getConversation(caseId: number): Msg[] {
  const row = db.prepare('SELECT messages FROM ai_conversations WHERE case_id = ?').get(caseId) as any;
  return row ? JSON.parse(row.messages) : [];
}
