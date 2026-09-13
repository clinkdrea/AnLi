import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { db, DATA_DIR } from '../db/schema.js';
import { config } from '../config.js';
import { isCaseMember } from '../plugins/auth.js';
import { logAudit } from '../services/audit.js';

const EXPORT_DIR = config.EXPORTS_DIR || path.join(DATA_DIR, 'exports');

export default async function exportRoutes(app: FastifyInstance) {
  // 导出案件（打包资料文件夹 + 元数据 JSON 为 zip）
  app.get('/api/cases/:id/export', async (req, reply) => {
    const cid = Number((req.params as any).id);
    if (req.user!.role !== 'admin' && !isCaseMember(req.user!.id, cid)) {
      return reply.status(403).send({ error: '无权访问' });
    }
    const caseRow = db.prepare('SELECT * FROM cases WHERE id = ?').get(cid) as any;
    if (!caseRow) return reply.status(404).send({ error: '案件不存在' });

    const parties = db.prepare('SELECT * FROM case_parties WHERE case_id = ? ORDER BY side').all(cid);
    const legal = db.prepare('SELECT * FROM case_legal_info WHERE case_id = ?').get(cid);
    const stages = db.prepare('SELECT * FROM case_stages WHERE case_id = ? ORDER BY sort_order').all(cid);
    const notes = db.prepare('SELECT n.content, n.created_at, u.name as author FROM case_notes n LEFT JOIN users u ON n.author_id = u.id WHERE n.case_id = ? ORDER BY n.created_at').all(cid);
    const evidences = db.prepare('SELECT * FROM evidences WHERE case_id = ?').all(cid);
    const tasks = db.prepare('SELECT * FROM tasks WHERE case_id = ?').all(cid);
    const files = db.prepare('SELECT * FROM file_records WHERE case_id = ?').all(cid);

    const metadata = {
      case: caseRow, parties, legal, stages, notes, evidences, tasks,
      export_time: new Date().toISOString(),
      exported_by: req.user!.name,
    };

    if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });

    const zipName = `${caseRow.case_no}-${caseRow.name}.zip`;
    const zipPath = path.join(EXPORT_DIR, zipName);

    // 写入元数据 JSON 到案件文件夹
    const metaPath = path.join(caseRow.folder_path, '_案件元数据.json');
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');

    // 使用系统 zip 命令打包
    try {
      execFileSync('zip', ['-r', zipPath, '.'], { cwd: caseRow.folder_path, stdio: 'pipe' });
    } catch {
      // 如果没有 zip 命令，用 node 内置方式（简单打包）
      return reply.status(500).send({ error: '系统缺少 zip 命令' });
    } finally {
      // 清理临时元数据文件
      if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
    }

    logAudit(req.user!.id, 'case_export', 'case', cid, zipName);

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(zipName)}"`);
    return reply.send(fs.createReadStream(zipPath));
  });
}
