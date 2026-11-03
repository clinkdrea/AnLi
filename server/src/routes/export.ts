import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { db, DATA_DIR } from '../db/schema.js';
import { config } from '../config.js';
import { isCaseMember } from '../plugins/auth.js';
import { logAudit } from '../services/audit.js';
import { caseDir } from '../services/settings.js';

const EXPORT_DIR = config.EXPORTS_DIR || path.join(DATA_DIR, 'exports');

export default async function exportRoutes(app: FastifyInstance) {
  // 导出案件（打包资料文件夹 + 完整元数据 JSON 为 zip）
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

    // ---- 任务（带处理人姓名 + 多处理人列表） ----
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

    // ---- 评论（带作者姓名 + 归属目标名称） ----
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

    // ---- 文书清单 + OCR 文本 ----
    const files = db.prepare(`
      SELECT fr.*, fo.ocr_status, fo.ocr_text,
        u.name AS uploader_name
      FROM file_records fr
      LEFT JOIN file_ocr_text fo ON fo.file_id = fr.id
      LEFT JOIN users u ON fr.uploaded_by = u.id
      WHERE fr.case_id = ?
      ORDER BY fr.rel_path
    `).all(cid);

    // 解析 mentions JSON 字符串为数组
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

    if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });

    const zipName = `${caseRow.case_no}-${caseRow.name}.zip`;
    const zipPath = path.join(EXPORT_DIR, zipName);

    // 写入元数据 JSON 到案件文件夹（临时）
    const dir = caseDir(caseRow.folder_path);
    const metaPath = path.join(dir, '_案件元数据.json');
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');

    // 使用系统 zip 命令打包
    try {
      execFileSync('zip', ['-r', zipPath, '.'], { cwd: dir, stdio: 'pipe' });
    } catch (err: any) {
      // 清理临时元数据
      if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
      const msg = err?.stderr?.toString() || err?.message || '';
      return reply.status(500).send({ error: `打包失败：${msg.slice(0, 200)}` });
    } finally {
      // 清理临时元数据文件
      if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
    }

    logAudit(req.user!.id, 'case_export', 'case', cid, `files=${files.length} comments=${comments.length} tasks=${tasks.length}`);

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(zipName)}"`);
    return reply.send(fs.createReadStream(zipPath));
  });
}
