// 系统设置读写：管理员可配置「所有案件的主文件夹根路径」「文书模板路径」
import fs from 'node:fs';
import path from 'node:path';
import { db, CASES_DIR, TEMPLATES_DIR } from '../db/schema.js';

export const CASES_ROOT_KEY = 'cases_root';
export const TEMPLATES_ROOT_KEY = 'templates_root';

export function getSetting(key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? '';
}

export function setSetting(key: string, value: string) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value);
}

// 案件主文件夹根路径：管理员设置优先，否则回退到默认存放目录（CASES_DIR）
export function resolveCasesRoot(): string {
  return getSetting(CASES_ROOT_KEY).trim() || CASES_DIR;
}

// 根路径是否可用（存在/已挂载）。不存在时不允许 mkdir，避免在未挂载的网盘路径下建出本地空目录
export function casesRootAvailable(): boolean {
  return fs.existsSync(resolveCasesRoot());
}

// 解析某案件的实际文件夹：
// - 主文件夹根路径下的同名子文件夹存在 → 用新路径
// - 否则回退到原始 folder_path（避免切换根路径后、旧文件夹尚未迁移时老文件立即失联）
// 读与写统一走此函数，保证路径一致
export function caseDir(folderPath: string): string {
  const target = path.join(resolveCasesRoot(), path.basename(folderPath));
  if (fs.existsSync(target)) return target;
  if (folderPath && fs.existsSync(folderPath)) return folderPath;
  return target;
}

// 写盘路径：确保案件文件夹存在。根路径不可用（未挂载）时抛错，避免在网盘路径下建出本地空目录
export function ensureCaseDir(folderPath: string): string {
  const dir = caseDir(folderPath);
  if (!fs.existsSync(dir)) {
    if (!casesRootAvailable()) throw new Error('案件文件夹不可用：主文件夹根路径不存在或未挂载');
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// 文书模板路径：管理员设置优先，否则回退到默认模板目录（TEMPLATES_DIR）。
// 模板记录中的 file_path 为相对路径，切换路径后只要把模板文件按原结构迁移过去即可继续可用
export function resolveTemplatesRoot(): string {
  return getSetting(TEMPLATES_ROOT_KEY).trim() || TEMPLATES_DIR;
}

// 文书模板路径是否可用（存在/已挂载）。不可用时扫描不删除任何记录，避免误清空模板库
export function templatesRootAvailable(): boolean {
  return fs.existsSync(resolveTemplatesRoot());
}

