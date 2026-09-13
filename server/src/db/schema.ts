import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';

// 所有数据路径均由环境变量控制（见 server/.env），默认在 server/data 下
const DATA_DIR = config.DATA_DIR;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CASES_DIR = config.CASES_DIR || path.join(DATA_DIR, 'cases');
if (!fs.existsSync(CASES_DIR)) fs.mkdirSync(CASES_DIR, { recursive: true });

const TEMPLATES_DIR = config.TEMPLATES_DIR || path.join(DATA_DIR, 'templates');
if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'anli.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      account TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','lead','co','assistant')),
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_no TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      lead_id INTEGER REFERENCES users(id),
      current_stage TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed','archived')),
      folder_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at TEXT,
      close_method TEXT
    );
    CREATE TABLE IF NOT EXISTS case_parties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      side TEXT NOT NULL CHECK(side IN ('our','opponent','third','court','contact')),
      name TEXT NOT NULL,
      party_type TEXT NOT NULL CHECK(party_type IN ('natural','legal')),
      id_number TEXT,
      phone TEXT,
      address TEXT,
      organization TEXT,
      role TEXT,
      remark TEXT,
      contact TEXT,
      relation TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS related_parties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS case_legal_info (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL UNIQUE REFERENCES cases(id) ON DELETE CASCADE,
      cause TEXT,
      court_case_no TEXT,
      amount REAL,
      entrust_start TEXT,
      close_date TEXT
    );
    CREATE TABLE IF NOT EXISTS case_members (
      case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (case_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS case_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      is_custom INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      stage_id INTEGER REFERENCES case_stages(id),
      title TEXT NOT NULL,
      description TEXT,
      assignee_id INTEGER REFERENCES users(id),
      due_date TEXT,
      priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('high','medium','low')),
      status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS deadlines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      due_at TEXT NOT NULL,
      remind_days TEXT NOT NULL DEFAULT '7,3,1',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS case_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      stage_id INTEGER REFERENCES case_stages(id),
      sort_order INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL,
      author_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES comments(id),
      content TEXT NOT NULL,
      mentions TEXT,
      author_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS evidences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      group_name TEXT,
      name TEXT NOT NULL,
      source TEXT,
      purpose TEXT,
      file_id INTEGER,
      remark TEXT
    );
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      content TEXT NOT NULL DEFAULT '',
      placeholders TEXT,
      file_path TEXT,
      category_path TEXT,
      is_file INTEGER NOT NULL DEFAULT 0,
      creator_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS file_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      rel_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER NOT NULL,
      ocr_status TEXT NOT NULL DEFAULT 'pending' CHECK(ocr_status IN ('pending','processing','done','failed')),
      ocr_text TEXT,
      uploaded_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS conflict_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER REFERENCES cases(id),
      query_json TEXT NOT NULL,
      hits_json TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      rule_refs TEXT,
      ai_opinion TEXT,
      conclusion TEXT,
      operator_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS conflict_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL CHECK(level IN ('forbidden','consent','caution')),
      title TEXT NOT NULL,
      clause TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS knowledge_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS knowledge_docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category_id INTEGER REFERENCES knowledge_categories(id),
      tags TEXT,
      content TEXT,
      file_path TEXT,
      visibility TEXT NOT NULL DEFAULT 'shared' CHECK(visibility IN ('shared','private')),
      creator_id INTEGER NOT NULL REFERENCES users(id),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      object_type TEXT,
      object_id TEXT,
      detail TEXT
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      ref_type TEXT,
      ref_id TEXT,
      content TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      model TEXT NOT NULL,
      messages TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_cases USING fts5(name, content='', tokenize='trigram');
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_notes USING fts5(content, content='', tokenize='trigram');
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_comments USING fts5(content, content='', tokenize='trigram');
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_files USING fts5(ocr_text, content='', tokenize='trigram');
  `);

  // 老库迁移：templates 表补充文件型模板字段，并放开 creator_id 非空约束
  const cols = db.prepare('PRAGMA table_info(templates)').all() as { name: string; notnull: number }[];
  const colNames = new Set(cols.map((c) => c.name));
  const creatorNotNull = cols.find((c) => c.name === 'creator_id')?.notnull === 1;
  const needRebuild = !colNames.has('file_path') || creatorNotNull;
  if (needRebuild) {
    db.exec(`
      CREATE TABLE templates_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT,
        content TEXT NOT NULL DEFAULT '',
        placeholders TEXT,
        file_path TEXT,
        category_path TEXT,
        is_file INTEGER NOT NULL DEFAULT 0,
        creator_id INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO templates_new (id, name, category, content, placeholders, file_path, category_path, is_file, creator_id, created_at)
      SELECT id, name, category, COALESCE(content, ''), placeholders, NULL, NULL, 0, creator_id, created_at FROM templates;
      DROP TABLE templates;
      ALTER TABLE templates_new RENAME TO templates;
    `);
  }

  // 老库迁移：cases 补充法院/开庭时间/案情简介
  const caseCols = db.prepare('PRAGMA table_info(cases)').all() as { name: string }[];
  const caseColSet = new Set(caseCols.map((c) => c.name));
  if (!caseColSet.has('court')) db.exec("ALTER TABLE cases ADD COLUMN court TEXT");
  if (!caseColSet.has('hearing_date')) db.exec("ALTER TABLE cases ADD COLUMN hearing_date TEXT");
  if (!caseColSet.has('summary')) db.exec("ALTER TABLE cases ADD COLUMN summary TEXT");

  // 老库迁移：case_notes 补充排序字段
  const noteCols = db.prepare('PRAGMA table_info(case_notes)').all() as { name: string }[];
  if (!noteCols.some((c) => c.name === 'sort_order')) {
    db.exec('ALTER TABLE case_notes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
  }

  // 老库迁移：case_parties 扩展分类与结构化字段（CHECK 约束变更需重建表）
  const partyCols = db.prepare('PRAGMA table_info(case_parties)').all() as { name: string }[];
  const partyColSet = new Set(partyCols.map((c) => c.name));
  const needPartyRebuild = !partyColSet.has('id_number') || !partyColSet.has('organization');
  if (needPartyRebuild) {
    db.exec(`
      CREATE TABLE case_parties_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        side TEXT NOT NULL CHECK(side IN ('our','opponent','third','court','contact')),
        name TEXT NOT NULL,
        party_type TEXT NOT NULL CHECK(party_type IN ('natural','legal')),
        id_number TEXT,
        phone TEXT,
        address TEXT,
        organization TEXT,
        role TEXT,
        remark TEXT,
        contact TEXT,
        relation TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO case_parties_new (id, case_id, side, name, party_type, phone, contact, relation, created_at)
      SELECT id, case_id, side, name, party_type, contact, contact, relation, created_at FROM case_parties;
      DROP TABLE case_parties;
      ALTER TABLE case_parties_new RENAME TO case_parties;
    `);
  }
}

export { db, DATA_DIR, CASES_DIR, TEMPLATES_DIR };
