// AI 助手 Agent 服务：
// - 可选挂载某个案件作为上下文（基本信息/当事人/案情记录/任务/文件与 OCR 文本）
// - 可选注入启用的 legal-skills 指令
// - 默认本地 ollama（qwen3:8b），可切换其他模型；ollama 不可用时回退 OpenAI 兼容接口
import { db } from '../db/schema.js';
import { config } from '../config.js';
import { buildSkillsPrompt } from './legal-skills.js';

export interface AgentMsg { role: 'system' | 'user' | 'assistant'; content: string }

// 上下文预算（字节，粗略控制，避免撑爆本地模型窗口）
const NOTE_BUDGET = 8 * 1024;        // 案情记录总量
const OCR_BUDGET = 20 * 1024;       // OCR 文本总量
const NOTE_EACH_CLIP = 600;         // 单条案情记录截断
const HISTORY_LIMIT = 20;           // 携带的历史消息条数

interface OllamaModel {
  name: string;
  size?: number;
  modified_at?: string;
}

// 检测本地 ollama 在线状态与已安装模型
export async function getOllamaStatus(): Promise<{ online: boolean; models: OllamaModel[]; error?: string }> {
  try {
    const res = await fetch(`${config.OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { online: false, models: [], error: `HTTP ${res.status}` };
    const data = await res.json() as { models?: any[] };
    return {
      online: true,
      models: (data.models || []).map((m) => ({ name: m.name, size: m.size, modified_at: m.modified_at })),
    };
  } catch (e: any) {
    return { online: false, models: [], error: e?.message || '连接失败' };
  }
}

// 聚合案件上下文（调用方需先做案件成员权限校验）
export function buildCaseContext(caseId: number): string {
  const c = db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId) as any;
  if (!c) throw new Error('案件不存在');

  const lines: string[] = [];
  lines.push(`【案件档案】`);
  lines.push(`案件编号：${c.case_no}`);
  lines.push(`案件名称：${c.name}`);
  lines.push(`案件类型：${c.type}`);
  if (c.current_stage) lines.push(`当前阶段：${c.current_stage}`);
  const statusLabel: Record<string, string> = { active: '进行中', closed: '已结案', archived: '已归档' };
  lines.push(`状态：${statusLabel[c.status] || c.status}`);
  if (c.created_at) lines.push(`立案/创建时间：${c.created_at}`);

  const legal = db.prepare('SELECT * FROM case_legal_info WHERE case_id = ?').get(caseId) as any;
  if (legal) {
    if (legal.cause) lines.push(`案由：${legal.cause}`);
    if (legal.court_case_no) lines.push(`法院案号：${legal.court_case_no}`);
    if (legal.amount != null) lines.push(`标的金额：${legal.amount}`);
    if (legal.entrust_start) lines.push(`委托开始：${legal.entrust_start}`);
    if (legal.close_date) lines.push(`结案日期：${legal.close_date}`);
  }

  const parties = db.prepare(
    'SELECT side, party_type, name, organization, role, id_number, phone, address, contact, relation, remark FROM case_parties WHERE case_id = ? ORDER BY side'
  ).all(caseId) as any[];
  if (parties.length) {
    const sideLabel: Record<string, string> = {
      our: '我方', opponent: '对方', third: '第三人', court: '法院/仲裁', contact: '联系人',
    };
    lines.push('\n【当事人/相关方】');
    for (const p of parties) {
      const segs = [`${sideLabel[p.side] || p.side}：${p.name}`];
      if (p.party_type === 'legal' && p.organization) segs.push(`机构：${p.organization}`);
      if (p.role) segs.push(`身份/角色：${p.role}`);
      if (p.id_number) segs.push(`证件号：${p.id_number}`);
      if (p.phone || p.contact) segs.push(`电话：${p.phone || p.contact}`);
      if (p.address) segs.push(`地址：${p.address}`);
      if (p.relation) segs.push(`关系：${p.relation}`);
      if (p.remark) segs.push(`备注：${p.remark}`);
      lines.push('  - ' + segs.join('；'));
    }
  }

  // 案情记录（按时间倒序取后再反转为正序展示），总量控制
  const notes = db.prepare(
    'SELECT content, created_at FROM case_notes WHERE case_id = ? ORDER BY created_at DESC LIMIT 30'
  ).all(caseId) as any[];
  if (notes.length) {
    lines.push('\n【案情记录】（按时间顺序）');
    let used = 0;
    for (const n of [...notes].reverse()) {
      let text = String(n.content || '').replace(/\s+/g, ' ').trim();
      if (text.length > NOTE_EACH_CLIP) text = text.slice(0, NOTE_EACH_CLIP) + '…';
      const item = `  - [${n.created_at}] ${text}`;
      if (used + item.length > NOTE_BUDGET) { lines.push('  - …（更早记录已省略）'); break; }
      lines.push(item);
      used += item.length;
    }
  }

  // 任务：未完成优先
  const tasks = db.prepare(
    `SELECT title, description, status, priority, due_date FROM tasks
     WHERE case_id = ? ORDER BY CASE WHEN status = 'done' THEN 1 ELSE 0 END,
       CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, due_date LIMIT 50`
  ).all(caseId) as any[];
  if (tasks.length) {
    const stLabel: Record<string, string> = { todo: '待办', doing: '进行中', done: '已完成', expired: '已过期' };
    lines.push('\n【任务】');
    for (const t of tasks) {
      const segs = [`[${stLabel[t.status] || t.status}] ${t.title}`];
      if (t.due_date) segs.push(`截止：${t.due_date}`);
      if (t.description) segs.push(String(t.description).slice(0, 120));
      lines.push('  - ' + segs.join('；'));
    }
  }

  // 文件清单 + 已完成 OCR 的图片文本（OCR 总量控制）
  const files = db.prepare(
    `SELECT f.id, f.file_name, f.mime_type, f.size, f.created_at,
            COALESCE(o.ocr_status, 'pending') as ocr_status, o.ocr_text
     FROM file_records f
     LEFT JOIN file_ocr_text o ON o.file_id = f.id
     WHERE f.case_id = ?
     ORDER BY f.created_at DESC`
  ).all(caseId) as any[];
  if (files.length) {
    lines.push('\n【文书资料文件】');
    for (const f of files) {
      const sizeKb = f.size ? `${Math.round(f.size / 1024)}KB` : '';
      lines.push(`  - ${f.file_name}（${f.mime_type || '未知类型'}${sizeKb ? '，' + sizeKb : ''}，OCR：${f.ocr_status}）`);
    }
    const ocrBlocks: string[] = [];
    let used = 0;
    for (const f of files) {
      if (f.ocr_status !== 'done' || !f.ocr_text) continue;
      let text = String(f.ocr_text).trim();
      if (!text) continue;
      const budgetLeft = OCR_BUDGET - used;
      if (budgetLeft <= 100) break;
      if (text.length > budgetLeft - 200) text = text.slice(0, budgetLeft - 200) + '…';
      const block = `  ▼ 文件「${f.file_name}」OCR 识别内容：\n${text.split('\n').map((l) => '    ' + l).join('\n')}`;
      ocrBlocks.push(block);
      used += block.length;
    }
    if (ocrBlocks.length) {
      lines.push('\n【图片文件 OCR 文本】');
      lines.push(...ocrBlocks);
    }
  }

  return lines.join('\n');
}

async function callOllama(messages: AgentMsg[], model: string, timeoutMs = 300_000): Promise<string> {
  const res = await fetch(`${config.OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // think:false 关闭 qwen3 系列（含 qwen3.6:27b）的思维链：
    // 否则生成内容会落在 message.thinking，message.content 为空，导致 JSON 抽取失败
    body: JSON.stringify({ model, messages, stream: false, think: false }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // 模型未拉取等场景给出可操作提示
    if (text.includes('not found') || text.includes('model')) {
      throw new Error(`ollama 模型「${model}」调用失败（${res.status}）：${text.slice(0, 200)}。请先在终端执行 ollama pull ${model}`);
    }
    throw new Error(`ollama 返回 ${res.status}：${text.slice(0, 200)}`);
  }
  const data = await res.json() as any;
  const content: string = data.message?.content || '';
  if (content.trim()) return content;
  // 兜底：个别模型/参数组合下 content 为空，尝试从 thinking 字段取
  const thinking: string = data.message?.thinking || '';
  if (thinking.trim()) return thinking;
  return '';
}

async function callOpenAICompat(messages: AgentMsg[], model: string): Promise<string> {
  const res = await fetch(`${config.OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.OPENAI_API_KEY}` },
    body: JSON.stringify({ model, messages }),
  });
  if (!res.ok) throw new Error(`AI 接口返回 ${res.status}`);
  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content || '';
}

// 通用 LLM 调用（供其他服务复用，如起诉状要素抽取）
// 优先本地 ollama；不可用且配置了外部接口时回退
export async function callLLM(messages: AgentMsg[], model?: string, timeoutMs?: number): Promise<string> {
  const m = model || config.AI_MODEL;
  try {
    return await callOllama(messages, m, timeoutMs);
  } catch (ollamaErr: any) {
    if (config.OPENAI_BASE_URL) {
      return await callOpenAICompat(messages, config.AI_MODEL);
    }
    throw ollamaErr;
  }
}

export interface AgentChatInput {
  caseId?: number | null;
  message: string;
  history?: AgentMsg[];
  model?: string;
  skills?: string[]; // 指定本次启用的 skill 名称；不传则用服务端开关配置
}

export async function agentChat(input: AgentChatInput): Promise<{ reply: string; model: string }> {
  const model = input.model?.trim() || config.AI_MODEL;

  // 系统提示：律师 Agent 定位 + 案件上下文 + skill 指令
  const sysParts: string[] = [
    '你是「案理」平台内置的律师专用 AI Agent，服务对象是中国执业律师与律师团队。',
    '要求：',
    '1. 回答专业、简洁、可执行，使用中国法律语境；不确定的内容明确标注「需核实」，不得编造法条编号、案号或司法解释名称。',
    '2. 若提供了【案件档案】，所有分析必须基于档案材料，材料未提及的事实标注「档案未提及」，不得自行假设。',
    '3. 引用材料时注明来源（如案情记录、OCR 文本）。',
    '4. 涉及具体法律文书产出时，遵循已加载 skill 的流程与格式；无匹配 skill 时给出专业草稿并提示律师复核。',
  ];
  if (input.caseId) {
    sysParts.push('\n' + buildCaseContext(input.caseId));
  } else {
    sysParts.push('\n当前未选择具体案件，按通用法律咨询/办案助手模式回答；如问题需要个案信息，请提示用户先选择案件。');
  }
  const skillsPrompt = buildSkillsPrompt(input.skills);
  if (skillsPrompt) sysParts.push('\n' + skillsPrompt);

  const history = (input.history || []).filter((m) => m && m.content).slice(-HISTORY_LIMIT);
  const messages: AgentMsg[] = [
    { role: 'system', content: sysParts.join('\n') },
    ...history,
    { role: 'user', content: input.message },
  ];

  // 默认本地 ollama；不可用且配置了外部接口时回退
  let reply = '';
  let usedModel = model;
  try {
    reply = await callLLM(messages, model);
    usedModel = model;
  } catch (ollamaErr: any) {
    if (config.OPENAI_BASE_URL) {
      reply = await callOpenAICompat(messages, config.AI_MODEL);
      usedModel = config.AI_MODEL;
    } else {
      throw ollamaErr;
    }
  }
  return { reply, model: usedModel };
}

// ---------------- 聊天线程持久化 ----------------

const THREAD_RETENTION_DAYS = 30;

// 清理超过保留期未使用的线程（返回清理条数）
export function cleanupOldThreads(): number {
  const r = db.prepare(
    `DELETE FROM ai_threads WHERE last_used_at < datetime('now', ?)`
  ).run(`-${THREAD_RETENTION_DAYS} days`);
  return Number(r.changes);
}

export function listThreads(userId: number): any[] {
  cleanupOldThreads();
  return db.prepare(
    `SELECT id, case_id, title, model, created_at, last_used_at
     FROM ai_threads WHERE user_id = ? ORDER BY last_used_at DESC`
  ).all(userId);
}

export function createThread(userId: number, opts: { case_id?: number | null; title?: string; model?: string }): any {
  const info = db.prepare(
    `INSERT INTO ai_threads (user_id, case_id, title, model) VALUES (?, ?, ?, ?)`
  ).run(userId, opts.case_id ?? null, opts.title?.trim() || '新对话', opts.model || null);
  const id = Number(info.lastInsertRowid);
  return db.prepare('SELECT * FROM ai_threads WHERE id = ?').get(id);
}

export function deleteThread(userId: number, threadId: number): boolean {
  const t = db.prepare('SELECT user_id FROM ai_threads WHERE id = ?').get(threadId) as any;
  if (!t) return false;
  if (t.user_id !== userId) return false;
  db.prepare('DELETE FROM ai_threads WHERE id = ?').run(threadId);
  return true;
}

export function getThread(userId: number, threadId: number): any | undefined {
  return db.prepare(
    'SELECT id, user_id, case_id, title, model FROM ai_threads WHERE id = ? AND user_id = ?'
  ).get(threadId, userId) as any | undefined;
}

export function updateThread(userId: number, threadId: number, patch: { case_id?: number | null; title?: string; model?: string }): any | undefined {
  const t = getThread(userId, threadId);
  if (!t) return undefined;
  const sets: string[] = [];
  const params: any[] = [];
  if (patch.case_id !== undefined) { sets.push('case_id = ?'); params.push(patch.case_id); }
  if (patch.title !== undefined) { sets.push('title = ?'); params.push(patch.title); }
  if (patch.model !== undefined) { sets.push('model = ?'); params.push(patch.model); }
  if (sets.length) {
    params.push(threadId, userId);
    db.prepare(`UPDATE ai_threads SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  }
  db.prepare('UPDATE ai_threads SET last_used_at = datetime(\'now\') WHERE id = ?').run(threadId);
  return getThread(userId, threadId);
}

export function getThreadMessages(threadId: number): AgentMsg[] {
  const rows = db.prepare(
    'SELECT role, content FROM ai_thread_messages WHERE thread_id = ? ORDER BY id ASC'
  ).all(threadId) as { role: string; content: string }[];
  return rows.map((r) => ({ role: r.role as any, content: r.content }));
}

export function appendThreadMessage(threadId: number, role: 'user' | 'assistant', content: string) {
  db.prepare(
    'INSERT INTO ai_thread_messages (thread_id, role, content) VALUES (?, ?, ?)'
  ).run(threadId, role, content);
  db.prepare('UPDATE ai_threads SET last_used_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?').run(threadId);
}

// 线程内对话：读取历史 → 调用 agent → 写入双方消息 → 返回回复
export async function chatInThread(
  userId: number,
  threadId: number,
  message: string,
  opts: { model?: string; skills?: string[] } = {},
): Promise<{ reply: string; model: string }> {
  const thread = getThread(userId, threadId);
  if (!thread) throw new Error('线程不存在');

  const history = getThreadMessages(threadId);
  // 首条用户消息用于派生线程标题
  const firstUser = history.find((m) => m.role === 'user');
  if (!firstUser) {
    const title = message.slice(0, 20) || '新对话';
    updateThread(userId, threadId, { title });
  }

  appendThreadMessage(threadId, 'user', message);

  const result = await agentChat({
    caseId: thread.case_id,
    message,
    history,
    model: opts.model || thread.model || undefined,
    skills: opts.skills,
  });

  appendThreadMessage(threadId, 'assistant', result.reply);
  return result;
}
