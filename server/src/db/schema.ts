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
      pinned INTEGER NOT NULL DEFAULT 0,
      last_opened_at TEXT,
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
      case_id INTEGER REFERENCES cases(id) ON DELETE CASCADE,
      stage_id INTEGER REFERENCES case_stages(id),
      title TEXT NOT NULL,
      description TEXT,
      assignee_id INTEGER REFERENCES users(id),
      due_date TEXT,
      priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('high','medium','low')),
      status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done','expired')),
      kind TEXT,
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
      category TEXT NOT NULL DEFAULT 'file',
      uploaded_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- OCR 文本独立存储：避免大文本膨胀 file_records 主表，file_id 与 file_records 一对一
    CREATE TABLE IF NOT EXISTS file_ocr_text (
      file_id INTEGER PRIMARY KEY REFERENCES file_records(id) ON DELETE CASCADE,
      ocr_status TEXT NOT NULL DEFAULT 'pending' CHECK(ocr_status IN ('pending','processing','done','failed')),
      ocr_text TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS evidence_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evidence_id INTEGER NOT NULL REFERENCES evidences(id) ON DELETE CASCADE,
      file_id INTEGER NOT NULL REFERENCES file_records(id) ON DELETE CASCADE,
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

  // 老库迁移：case_members 补充置顶与近期打开字段
  const memberCols = db.prepare('PRAGMA table_info(case_members)').all() as { name: string }[];
  const memberColSet = new Set(memberCols.map((c) => c.name));
  if (!memberColSet.has('pinned')) {
    db.exec('ALTER TABLE case_members ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
  }
  if (!memberColSet.has('last_opened_at')) {
    db.exec('ALTER TABLE case_members ADD COLUMN last_opened_at TEXT');
  }

  // 老库迁移：tasks.case_id 改为可空（支持不关联案件的个人待办，需重建表）
  const taskCols = db.prepare('PRAGMA table_info(tasks)').all() as { name: string; notnull: number }[];
  const taskCaseCol = taskCols.find((c) => c.name === 'case_id');
  if (taskCaseCol && taskCaseCol.notnull === 1) {
    db.exec(`
      CREATE TABLE tasks_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER REFERENCES cases(id) ON DELETE CASCADE,
        stage_id INTEGER REFERENCES case_stages(id),
        title TEXT NOT NULL,
        description TEXT,
        assignee_id INTEGER REFERENCES users(id),
        due_date TEXT,
        priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('high','medium','low')),
        status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done','expired')),
        kind TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO tasks_new (id, case_id, stage_id, title, description, assignee_id, due_date, priority, status, created_at)
      SELECT id, case_id, stage_id, title, description, assignee_id, due_date, priority, status, created_at FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;
    `);
  }

  // 老库迁移：tasks 补充 kind 列（标记系统自动生成的待办，如 'hearing' 开庭）
  const taskCols2 = db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[];
  if (!taskCols2.some((c) => c.name === 'kind')) {
    db.exec('ALTER TABLE tasks ADD COLUMN kind TEXT');
  }

  // 老库迁移：tasks.status 增加 'expired' 状态（CHECK 约束变化需重建表）
  const tasksSqlRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'").get() as { sql: string } | undefined;
  if (tasksSqlRow?.sql && !tasksSqlRow.sql.includes("'expired'")) {
    db.exec(`
      CREATE TABLE tasks_new2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER REFERENCES cases(id) ON DELETE CASCADE,
        stage_id INTEGER REFERENCES case_stages(id),
        title TEXT NOT NULL,
        description TEXT,
        assignee_id INTEGER REFERENCES users(id),
        due_date TEXT,
        priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('high','medium','low')),
        status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done','expired')),
        kind TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO tasks_new2 (id, case_id, stage_id, title, description, assignee_id, due_date, priority, status, kind, created_at)
      SELECT id, case_id, stage_id, title, description, assignee_id, due_date, priority, status, kind, created_at FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_new2 RENAME TO tasks;
    `);
  }

  // 回填：已有案件的开庭时间自动生成开庭待办（负责人=主办律师，不重复生成）
  db.exec(`
    INSERT INTO tasks (case_id, title, assignee_id, due_date, priority, status, kind, created_at)
    SELECT c.id, '开庭', c.lead_id, c.hearing_date, 'high', 'todo', 'hearing', datetime('now')
    FROM cases c
    WHERE c.hearing_date IS NOT NULL AND c.hearing_date != ''
      AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.case_id = c.id AND t.kind = 'hearing')
  `);

  // 老库迁移：file_records 补充 category 列（区分普通资料与证据文件）
  const fileCols = db.prepare('PRAGMA table_info(file_records)').all() as { name: string }[];
  if (!fileCols.some((c) => c.name === 'category')) {
    db.exec("ALTER TABLE file_records ADD COLUMN category TEXT NOT NULL DEFAULT 'file'");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS evidence_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evidence_id INTEGER NOT NULL REFERENCES evidences(id) ON DELETE CASCADE,
      file_id INTEGER NOT NULL REFERENCES file_records(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // 历史数据：已通过 evidences.file_id 关联的单文件迁移到 evidence_files
  db.exec(`
    INSERT OR IGNORE INTO evidence_files (evidence_id, file_id)
    SELECT id, file_id FROM evidences WHERE file_id IS NOT NULL
  `);

  // 老库迁移：file_records 的 ocr_status/ocr_text 拆到 file_ocr_text 表
  // SQLite 不支持直接 DROP COLUMN，需重建表
  const oldFileCols = db.prepare('PRAGMA table_info(file_records)').all() as { name: string }[];
  if (oldFileCols.some((c) => c.name === 'ocr_text') || oldFileCols.some((c) => c.name === 'ocr_status')) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`
      CREATE TABLE file_records_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        rel_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT,
        size INTEGER NOT NULL,
        category TEXT NOT NULL DEFAULT 'file',
        uploaded_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec(`
      INSERT INTO file_records_new (id, case_id, rel_path, file_name, mime_type, size, category, uploaded_by, created_at)
      SELECT id, case_id, rel_path, file_name, mime_type, size, COALESCE(category, 'file'), uploaded_by, created_at
      FROM file_records
    `);
    // 把 OCR 数据搬到独立表（仅迁移有 OCR 状态或文本的记录）
    db.exec(`
      INSERT OR IGNORE INTO file_ocr_text (file_id, ocr_status, ocr_text)
      SELECT id, COALESCE(ocr_status, 'pending'), ocr_text FROM file_records
      WHERE ocr_status IS NOT NULL OR ocr_text IS NOT NULL
    `);
    db.exec('DROP TABLE file_records');
    db.exec('ALTER TABLE file_records_new RENAME TO file_records');
    db.exec('PRAGMA foreign_keys = ON');
  }
}

export { db, DATA_DIR, CASES_DIR, TEMPLATES_DIR };
