// 统一配置：优先读环境变量，支持从 server/.env 文件加载（无需额外依赖）
import fs from 'node:fs';
import path from 'node:path';

// 简易 .env 加载（存在则解析，不覆盖已有环境变量）
const envFile = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

// 相对路径基于服务端工作目录（server/）解析
function resolvePath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

export const config = {
  // 数据根目录：数据库、案件资料、导出、备份
  DATA_DIR: resolvePath(process.env.ANLI_DATA_DIR || './data'),
  // 案件资料文件夹
  CASES_DIR: process.env.ANLI_CASES_DIR ? resolvePath(process.env.ANLI_CASES_DIR) : '',
  // 文书模板文件夹（仅本地留档，不上传 GitHub；可指向任意外部模板库）
  TEMPLATES_DIR: process.env.ANLI_TEMPLATES_DIR ? resolvePath(process.env.ANLI_TEMPLATES_DIR) : '',
  // 案件导出文件夹
  EXPORTS_DIR: process.env.ANLI_EXPORTS_DIR ? resolvePath(process.env.ANLI_EXPORTS_DIR) : '',
  JWT_SECRET: process.env.JWT_SECRET || 'anli-local-secret-change-me',
  PORT: Number(process.env.PORT || 3000),
  // AI 配置
  OLLAMA_URL: process.env.OLLAMA_URL || 'http://localhost:11434',
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  AI_MODEL: process.env.AI_MODEL || 'qwen3:8b',
};
