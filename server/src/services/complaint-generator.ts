// 要素式起诉状生成服务：
// 1) 调用 LLM 按 elements-complaint-generator skill 的抽取纪律产出 elements.json
// 2) 调用 skill 的 fill_template.py 渲染 docx
// 3) 返回 docx 路径与抽取的要素（供律师复核）
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { config } from '../config.js';
import { buildCaseContext, callLLM } from './ai-agent.js';

const execFileP = promisify(execFile);

const SKILL_DIR = path.join(config.LEGAL_SKILLS_DIR, 'skills', 'elements-complaint-generator');
const FILL_SCRIPT = path.join(SKILL_DIR, 'scripts', 'fill_template.py');
const EXTRACTION_PROMPT = path.join(SKILL_DIR, 'references', 'extraction-prompt-template.md');
const CASE_ROUTING = path.join(SKILL_DIR, 'references', 'case-routing.md');
const COMMON_ELEMENTS = path.join(SKILL_DIR, 'references', 'common-elements.md');

export function isReady(): boolean {
  return fs.existsSync(FILL_SCRIPT) && fs.existsSync(CASE_ROUTING);
}

// 从 LLM 输出中提取第一个 ```json``` 代码块（或裸 JSON 对象）
function extractJson(text: string): any | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : text;
  // 取第一个 { 到最后一个 } 的片段
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  try {
    return JSON.parse(candidate.slice(first, last + 1));
  } catch {
    return null;
  }
}

// 案由路由表：仅取「民事起诉状」行，提取 编号 / 案由 / case-type key / 关键词
// case-type key 形如 09-private-lending（NN-英文，不含中文）；模板树名含中文，需区分
function buildRoutingSnippet(): string {
  const raw = fs.readFileSync(CASE_ROUTING, 'utf-8');
  const rows: string[] = [];
  for (const line of raw.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim().replace(/`/g, ''));
    if (cells.length < 8) continue;
    if (cells[1] === '编号' || cells[1].startsWith('---')) continue;
    // 只取民事起诉状（不含答辩状/申请书）
    if (!cells[4] || !cells[4].includes('民事起诉状')) continue;
    const no = cells[1];
    const cause = cells[2];
    // case-type key：匹配 NN-英文（不含中文）的单元格
    const keyCell = cells.find((c) => /^\d{2}-[a-z][\w-]*$/.test(c)) || '';
    const kw = cells[cells.length - 1];
    rows.push(`| ${no} | ${cause} | ${keyCell} | ${kw} |`);
  }
  return ['| 编号 | 案由 | case-type key | 识别关键词 |', '|---|---|---|---|', ...rows].join('\n');
}

// 通用要素字段 schema（L1 自然人 / L2 法人 / L3 代理人 / L5 调解 / L6 具状）
// 引导模型使用正确的中文键名结构（当事人.原告.姓名 等）
function buildCommonElementsSchema(): string {
  if (!fs.existsSync(COMMON_ELEMENTS)) return '';
  const raw = fs.readFileSync(COMMON_ELEMENTS, 'utf-8');
  const blocks: string[] = [];
  const re = /```yaml\s*\n([\s\S]*?)\n```/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    blocks.push(m[1]);
    if (blocks.length >= 4) break;
  }
  return blocks.join('\n\n');
}

interface ExtractionInput {
  caseId?: number | null;
  description?: string;
  model?: string;
}

// 调用 LLM 抽取要素，返回 { case_type, elements } 结构
async function extractElements(input: ExtractionInput): Promise<any> {
  const contextParts: string[] = [];
  if (input.caseId) {
    try {
      contextParts.push('【案件档案】\n' + buildCaseContext(input.caseId));
    } catch { /* ignore */ }
  }
  if (input.description?.trim()) {
    contextParts.push('【用户补充描述】\n' + input.description.trim());
  }
  if (contextParts.length === 0) {
    throw new Error('请提供案件或案情描述，无法生成要素式起诉状');
  }

  const routingSnippet = buildRoutingSnippet();
  const commonSchema = buildCommonElementsSchema();
  const extractionDiscipline = fs.existsSync(EXTRACTION_PROMPT)
    ? fs.readFileSync(EXTRACTION_PROMPT, 'utf-8')
    : '';

  const system = [
    '你是要素式起诉状要素抽取器。任务：根据用户提供的案件材料，抽取要素并输出 JSON。',
    '严格纪律：',
    '1. case_type 必须是「案由路由表」中的 case-type key（纯英文短横线格式，如 09-private-lending），绝对不能用模板树名（含中文）。',
    '2. elements 的键名必须严格使用下方「通用要素 Schema」中的中文键名，结构为嵌套对象（如 {"当事人": {"原告": {"姓名": "..."}}}）。',
    '3. 材料中没有的字段填空字符串 ""；布尔字段未明确主张填 false；禁止编造。',
    '4. 日期统一 YYYY-MM-DD；金额保留原文数字字符串。',
    '5. 勾选项只能用模板选项原文。',
    '',
    '输出要求：只输出一个 JSON 代码块，格式为 {"case_type": "XX-xxx", "elements": {...}}，不要任何解释文字。',
    '',
    '【案由路由表】（只取民事起诉状）',
    routingSnippet,
    '',
    '【通用要素 Schema】（elements 必须用这些中文键名）',
    commonSchema,
    '',
    '【抽取纪律参考】',
    extractionDiscipline.slice(0, 2000),
  ].join('\n');

  const user = contextParts.join('\n\n');
  // 要素 JSON 较长，27b 生成较慢，给 10 分钟超时
  const reply = await callLLM([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], input.model, 600_000);

  const parsed = extractJson(reply);
  if (!parsed) {
    const snippet = reply.replace(/\s+/g, ' ').slice(0, 200);
    throw new Error(`模型未能输出有效的 elements.json（原始输出前 200 字：${snippet || '（空）'}）。请重试或补充案情描述`);
  }
  if (!parsed.case_type || !parsed.elements || typeof parsed.elements !== 'object') {
    throw new Error('模型输出缺少 case_type 或 elements 字段，请重试');
  }
  return parsed;
}

export interface GenerateResult {
  case_type: string;
  elements: any;
  docxPath: string;
  fileSize: number;
  warnings: string[];
}

// 执行生成：抽要素 → 渲染 docx
export async function generateComplaint(input: ExtractionInput): Promise<GenerateResult> {
  if (!isReady()) {
    throw new Error('要素式起诉状生成器未就绪（legal-skills 未初始化）');
  }

  const elementsObj = await extractElements(input);
  const caseType = elementsObj.case_type;

  // 写临时 elements.json
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecg-'));
  const elementsPath = path.join(tmpDir, 'elements.json');
  const outputPath = path.join(tmpDir, '要素式起诉状.docx');
  fs.writeFileSync(elementsPath, JSON.stringify(elementsObj, null, 2), 'utf-8');

  const warnings: string[] = [];
  try {
    await execFileP('python3', [
      FILL_SCRIPT,
      '--case-type', caseType,
      '--elements', elementsPath,
      '--output', outputPath,
      '--layout-check', 'off', // 本机未装 LibreOffice，跳过真实渲染门禁
    ], { timeout: 120_000, cwd: path.dirname(FILL_SCRIPT) });
  } catch (e: any) {
    const stderr = e.stderr || e.message || '';
    throw new Error(`渲染失败：${stderr.slice(0, 500)}`);
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error('渲染未生成 docx 文件，请检查案由是否正确');
  }
  const fileSize = fs.statSync(outputPath).size;

  return {
    case_type: caseType,
    elements: elementsObj.elements,
    docxPath: outputPath,
    fileSize,
    warnings,
  };
}
