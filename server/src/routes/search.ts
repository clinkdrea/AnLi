import type { FastifyInstance } from 'fastify';
import { db } from '../db/schema.js';
import { isCaseMember } from '../plugins/auth.js';

export default async function searchRoutes(app: FastifyInstance) {
  // 全文搜索：仅搜索自己参与的案件
  app.get('/api/search', async (req) => {
    const { q } = req.query as { q: string };
    if (!q?.trim()) return { results: [] };

    const uid = req.user!.id;
    // 我参与的案件 ID 列表
    const myCaseIds = db.prepare(
      'SELECT case_id FROM case_members WHERE user_id = ?'
    ).all(uid).map((r: any) => r.case_id);
    if (myCaseIds.length === 0) return { results: [] };
    const placeholders = myCaseIds.map(() => '?').join(',');

    const results: any[] = [];

    // 1. 案件名称
    const cases = db.prepare(
      `SELECT id, case_no, name, type FROM cases WHERE id IN (${placeholders}) AND name LIKE ?`
    ).all(...myCaseIds, `%${q}%`);
    cases.forEach((c: any) => results.push({ type: 'case', id: c.id, title: c.name, sub: `${c.case_no}`, case_id: c.id }));

    // 2. 案情记录
    const notes = db.prepare(
      `SELECT n.id, n.content, n.case_id, c.name as case_name
       FROM case_notes n JOIN cases c ON n.case_id = c.id
       WHERE n.case_id IN (${placeholders}) AND n.content LIKE ?`
    ).all(...myCaseIds, `%${q}%`);
    notes.forEach((n: any) => results.push({ type: 'note', id: n.id, title: n.content.slice(0, 60), sub: n.case_name, case_id: n.case_id }));

    // 3. 评论
    const comments = db.prepare(
      `SELECT cm.id, cm.content, cm.case_id, c.name as case_name
       FROM comments cm JOIN cases c ON cm.case_id = c.id
       WHERE cm.case_id IN (${placeholders}) AND cm.content LIKE ?`
    ).all(...myCaseIds, `%${q}%`);
    comments.forEach((c: any) => results.push({ type: 'comment', id: c.id, title: c.content.slice(0, 60), sub: c.case_name, case_id: c.case_id }));

    // 4. 文件名 + OCR 文本
    const files = db.prepare(
      `SELECT f.id, f.file_name, f.ocr_text, f.case_id, c.name as case_name
       FROM file_records f JOIN cases c ON f.case_id = c.id
       WHERE f.case_id IN (${placeholders}) AND (f.file_name LIKE ? OR f.ocr_text LIKE ?)`
    ).all(...myCaseIds, `%${q}%`, `%${q}%`);
    files.forEach((f: any) => results.push({ type: 'file', id: f.id, title: f.file_name, sub: f.case_name, case_id: f.case_id }));

    return { results, total: results.length };
  });
}
