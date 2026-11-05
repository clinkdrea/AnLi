import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { db, DATA_DIR } from '../db/schema.js';
import { isCaseMember } from '../plugins/auth.js';
import { logAudit } from '../services/audit.js';

const EXPORT_DIR = path.join(DATA_DIR, 'exports');

export default async function exportRoutes(app: FastifyInstance) {
  // 导出案件元数据（纯 JSON，不碰文件系统）
  app.get('/api/cases/:id/export', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const caseRow = db.prepare('SELECT * FROM cases WHERE id = ?').get(cid) as any;
    if (!caseRow) return reply.status(404).send({ error: '案件不存在' });

    // ---- 当事人 ----
    const parties = db.prepare(`
      SELECT * FROM case_parties WHERE case_id = ? ORDER BY side, id
    `).all(cid);

    const legal = db.prepare('SELECT * FROM case_legal_info WHERE case_id = ?').get(cid);

    // 案件成员（带角色名）
    const members = db.prepare(`
      SELECT cm.user_id, cm.pinned, cm.joined_at,
        u.name, u.account, u.role
      FROM case_members cm JOIN users u ON cm.user_id = u.id
      WHERE cm.case_id = ? ORDER BY cm.pinned DESC, cm.joined_at
    `).all(cid);

    // ---- 阶段 ----
    const stages = db.prepare('SELECT * FROM case_stages WHERE case_id = ? ORDER BY sort_order').all(cid);

    // ---- 任务 ----
    const tasks = db.prepare(`
      SELECT t.*, u.name AS assignee_name, s.name AS stage_name
      FROM tasks t
      LEFT JOIN users u ON t.assignee_id = u.id
      LEFT JOIN case_stages s ON t.stage_id = s.id
      WHERE t.case_id = ?
      ORDER BY t.stage_id IS NULL, t.stage_id, t.sort_order, t.id
    `).all(cid);

    const taskAssignees = db.prepare(`
      SELECT ta.task_id, ta.user_id, u.name AS user_name
      FROM task_assignees ta JOIN users u ON ta.user_id = u.id
      WHERE ta.task_id IN (SELECT id FROM tasks WHERE case_id = ?)
      ORDER BY ta.task_id, ta.user_id
    `).all(cid);

    // ---- 笔记 ----
    const notes = db.prepare(`
      SELECT n.*, u.name AS author_name, s.name AS stage_name
      FROM case_notes n
      LEFT JOIN users u ON n.author_id = u.id
      LEFT JOIN case_stages s ON n.stage_id = s.id
      WHERE n.case_id = ?
      ORDER BY n.stage_id IS NULL, n.stage_id, n.sort_order, n.created_at
    `).all(cid);

    // ---- 评论 ----
    const comments = db.prepare(`
      SELECT c.*, u.name AS author_name,
        s.name AS stage_name, t.title AS task_title
      FROM comments c
      JOIN users u ON c.author_id = u.id
      LEFT JOIN case_stages s ON c.target_type = 'stage' AND c.target_id = s.id
      LEFT JOIN tasks t ON c.target_type = 'task' AND c.target_id = t.id
      WHERE c.case_id = ?
      ORDER BY c.created_at
    `).all(cid);

    // ---- 期限 ----
    const deadlines = db.prepare('SELECT * FROM deadlines WHERE case_id = ? ORDER BY due_at').all(cid);

    // ---- 利益冲突报告 ----
    const conflicts = db.prepare('SELECT * FROM conflict_reports WHERE case_id = ? ORDER BY created_at DESC').all(cid);

    // ---- 文书清单（只拿元信息，不拿 OCR 文本 —— 用户说文书资料不需要）----
    const files = db.prepare(`
      SELECT fr.id, fr.case_id, fr.rel_path, fr.file_name, fr.mime_type, fr.size,
        fr.category, fr.uploaded_by, fr.created_at,
        u.name AS uploader_name
      FROM file_records fr
      LEFT JOIN users u ON fr.uploaded_by = u.id
      WHERE fr.case_id = ?
      ORDER BY fr.rel_path
    `).all(cid);

    // 解析 mentions JSON
    for (const c of comments) {
      if (typeof c.mentions === 'string') {
        try { c.mentions = JSON.parse(c.mentions); } catch { c.mentions = null; }
      }
    }

    const metadata = {
      case: caseRow,
      members,
      parties,
      legal,
      stages,
      tasks,
      task_assignees: taskAssignees,
      notes,
      comments,
      deadlines,
      conflicts,
      files,
      export_time: new Date().toISOString(),
      exported_by: req.user!.name,
      exported_by_id: req.user!.id,
    };

    // 清理 caseRow 中不想暴露的内部字段（比如 folder_path 可能含敏感路径）
    const exportCase = { ...caseRow };
    delete exportCase.folder_path;
    metadata.case = exportCase;

    if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });

    const baseName = `${caseRow.case_no}-${caseRow.name}`.replace(/[\\/:*?"<>|]/g, '_');
    const jsonPath = path.join(EXPORT_DIR, `${baseName}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2), 'utf-8');

    logAudit(req.user!.id, 'case_export', 'case', cid, `tasks=${tasks.length} notes=${notes.length} comments=${comments.length} files=${files.length}`);

    reply.header('Content-Type', 'application/json; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(baseName)}.json"`);
    return reply.send(fs.createReadStream(jsonPath));
  });
}
