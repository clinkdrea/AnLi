// 法律 Skills 服务：扫描本地 legal-skills 仓库（cat-xierluo/legal-skills）
// 每个 skill 是 skills/<name>/SKILL.md（YAML frontmatter + Markdown 指令）
// skill 启用状态持久化在 data/ai_skills_config.json
// 默认仅启用 elements-complaint-generator（考虑本机性能）
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';

const execFileP = promisify(execFile);

export const SKILLS_REPO_URL = 'https://github.com/cat-xierluo/legal-skills.git';
const SKILLS_ROOT = path.join(config.LEGAL_SKILLS_DIR, 'skills');
const CONFIG_FILE = path.join(config.DATA_DIR, 'ai_skills_config.json');

// 默认启用（其他 skill 可手动打开）
const DEFAULT_ENABLED = ['elements-complaint-generator'];

// 注入给模型的单 skill 内容上限（字节），避免把超大 SKILL.md 全塞进去
const MAX_SKILL_BYTES = 24 * 1024;
// 所有启用 skill 注入总量上限
const MAX_TOTAL_SKILL_BYTES = 60 * 1024;

// 默认 skill 之外额外注入的参考文档（相对 skill 目录）
// elements-complaint-generator：SKILL.md 讲流程，extraction-prompt-template 是抽取纪律，体量小必带；
// case-routing.md（约 30KB）过大，不默认注入，需要案由路由时由模型向用户确认候选案由
const EXTRA_REFS: Record<string, string[]> = {
  'elements-complaint-generator': ['references/extraction-prompt-template.md'],
};

export interface SkillMeta {
  name: string;
  description: string;
  version: string;
  author: string;
  license: string;
  dir: string;
  enabled: boolean;
  isDefault: boolean;
}

interface SkillConfig {
  enabled: string[];
}

export function isReady(): boolean {
  return fs.existsSync(SKILLS_ROOT);
}

// 极简 YAML frontmatter 解析（只需 name/description/version/author/license 几个标量字段）
function parseFrontmatter(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return out;
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!mm) continue;
    let val = mm[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[mm[1]] = val;
  }
  return out;
}

function readConfig(): SkillConfig {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    if (Array.isArray(c.enabled)) return { enabled: c.enabled.map(String) };
  } catch { /* 首次使用或文件损坏 → 用默认 */ }
  return { enabled: [...DEFAULT_ENABLED] };
}

function writeConfig(c: SkillConfig) {
  if (!fs.existsSync(config.DATA_DIR)) fs.mkdirSync(config.DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2), 'utf-8');
}

// 扫描仓库内所有 skill（不做启用状态合并）
function scanAll(): Omit<SkillMeta, 'enabled' | 'isDefault'>[] {
  if (!isReady()) return [];
  const result: Omit<SkillMeta, 'enabled' | 'isDefault'>[] = [];
  for (const entry of fs.readdirSync(SKILLS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMd = path.join(SKILLS_ROOT, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;
    const raw = fs.readFileSync(skillMd, 'utf-8');
    const fm = parseFrontmatter(raw);
    result.push({
      name: fm.name || entry.name,
      description: fm.description || '',
      version: fm.version || '',
      author: fm.author || '',
      license: fm.license || '',
      dir: entry.name,
    });
  }
  // 默认 skill 排最前，其余按名称
  return result.sort((a, b) => {
    const da = DEFAULT_ENABLED.includes(a.name) ? 0 : 1;
    const db = DEFAULT_ENABLED.includes(b.name) ? 0 : 1;
    return da - db || a.name.localeCompare(b.name);
  });
}

// 列表 + 启用状态
export function listSkills(): SkillMeta[] {
  const cfg = readConfig();
  return scanAll().map((s) => ({
    ...s,
    enabled: cfg.enabled.includes(s.name),
    isDefault: DEFAULT_ENABLED.includes(s.name),
  }));
}

// 开关某个 skill
export function setSkillEnabled(name: string, enabled: boolean): SkillMeta[] {
  const all = scanAll();
  if (!all.some((s) => s.name === name)) {
    throw new Error('skill 不存在');
  }
  const cfg = readConfig();
  const set = new Set(cfg.enabled);
  if (enabled) set.add(name); else set.delete(name);
  writeConfig({ enabled: [...set] });
  return listSkills();
}

// 去掉 SKILL.md 的 frontmatter，取正文
function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
}

// 构造注入给模型的技能提示。
// mode：
//  - 'summary'（默认，普通聊天）：只给「名称 + 一句话描述 + 触发边界」，
//    不注入 SKILL.md 正文/参考文档，避免文档生成流水线（索要材料、{{占位符}}、套模板）
//    污染正常的案件咨询问答。
//  - 'full'：注入完整 SKILL.md + EXTRA_REFS 参考文档，供真正执行某技能的专用流程使用。
export function buildSkillsPrompt(names?: string[], mode: 'summary' | 'full' = 'summary'): string {
  const wanted = names && names.length > 0 ? names : readConfig().enabled;
  if (wanted.length === 0) return '';
  const all = scanAll();
  const byName = new Map(all.map((s) => [s.name, s]));
  const picked = wanted
    .map((n) => byName.get(n))
    .filter((s): s is NonNullable<typeof s> => !!s);
  if (picked.length === 0) return '';

  if (mode === 'summary') {
    const lines = picked.map((s) => {
      const desc = s.description || '律师工作技能';
      return `- 「${s.name}」：${desc}`;
    });
    return [
      '你具备以下律师工作技能（skill）：',
      ...lines,
      '',
      '使用边界：',
      '1. 普通咨询、案情了解、法律分析类问题，直接基于已提供的【案件档案】作答，不要套用任何技能的文书模板，不要输出 {{占位符}} 之类的模板字段，也不要以“请提供材料”为由拒绝回答——档案里已有的信息直接引用。',
      '2. 仅当用户明确要求产出某技能对应的正式文书（例如明确要求“生成要素式起诉状 Word/docx”）时，才引导其使用对应的生成入口（如页面上的「生成要素式起诉状」按钮，由后端专用流程完成渲染）；不要在对话里自行拼接该文书模板。',
    ].join('\n');
  }

  const blocks: string[] = [];
  let total = 0;
  for (const meta of picked) {
    const skillMd = path.join(SKILLS_ROOT, meta.dir, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;
    let body = stripFrontmatter(fs.readFileSync(skillMd, 'utf-8'));
    if (body.length > MAX_SKILL_BYTES) {
      body = body.slice(0, MAX_SKILL_BYTES) + '\n\n（内容过长已截断，完整文档见本地 skill 仓库）';
    }
    const refs: string[] = [];
    for (const rel of EXTRA_REFS[meta.name] || []) {
      const p = path.join(SKILLS_ROOT, meta.dir, rel);
      if (fs.existsSync(p)) {
        let ref = fs.readFileSync(p, 'utf-8');
        if (ref.length > MAX_SKILL_BYTES) ref = ref.slice(0, MAX_SKILL_BYTES) + '\n（已截断）';
        refs.push(`### 参考文档：${rel}\n\n${ref}`);
      }
    }
    let block = `## Skill：${meta.name}${meta.version ? `（v${meta.version}）` : ''}\n\n${body}`;
    if (refs.length) block += '\n\n' + refs.join('\n\n');
    if (total + block.length > MAX_TOTAL_SKILL_BYTES) {
      blocks.push(`（以下 skill「${meta.name}」因启用 skill 总内容超限未注入，可关闭其他 skill 后重试）`);
      break;
    }
    blocks.push(block);
    total += block.length;
  }

  if (blocks.length === 0) return '';
  return [
    '你已加载以下律师工作技能（skill）。处理用户请求时，若匹配某个 skill 的适用场景，必须严格遵循该 skill 的工作流程、产出格式与纪律要求；不匹配时按普通律师助手回答。',
    '',
    ...blocks,
  ].join('\n\n');
}

// 首次安装：git clone 仓库到数据目录
export async function initSkills(): Promise<{ ok: boolean; output: string }> {
  if (isReady()) return { ok: true, output: '已存在，跳过克隆' };
  const parent = path.dirname(config.LEGAL_SKILLS_DIR);
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
  try {
    const { stdout, stderr } = await execFileP(
      'git', ['clone', '--depth', '1', SKILLS_REPO_URL, config.LEGAL_SKILLS_DIR],
      { timeout: 180_000 },
    );
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (e: any) {
    throw new Error(`克隆失败：${e.stderr || e.message}`);
  }
}

// 更新：git pull
export async function updateSkills(): Promise<{ ok: boolean; output: string }> {
  if (!isReady()) throw new Error('skills 库尚未初始化');
  try {
    const { stdout, stderr } = await execFileP(
      'git', ['pull', '--ff-only'],
      { cwd: config.LEGAL_SKILLS_DIR, timeout: 120_000 },
    );
    return { ok: true, output: (stdout + stderr).trim() || '已是最新' };
  } catch (e: any) {
    throw new Error(`更新失败：${e.stderr || e.message}`);
  }
}
