import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import { db, CASES_DIR } from '../db/schema.js';
import { STAGE_TEMPLATES } from '../db/seed.js';
import { logAudit } from '../services/audit.js';

const CASE_TYPES = Object.keys(STAGE_TEMPLATES);

function genCaseNo(type: string, year: number): string {
  const prefix = type.toUpperCase().slice(0, 3);
  const row = db.prepare("SELECT COUNT(*) as c FROM cases WHERE case_no LIKE ?").get(`${year}-${prefix}-%`) as { c: number };
  const seq = String(row.c + 1).padStart(3, '0');
  return `${year}-${prefix}-${seq}`;
}

export default async function importRoutes(app: FastifyInstance) {
  // 下载导入模板（CSV 格式，前端可转 Excel）
  app.get('/api/import/template', async (req, reply) => {
    const csv = '\uFEFF案件名称,案件类型,我方当事人,对方当事人,案由,法院案号,承办人账号,委托开始日,结案日\n';
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename=case_import_template.csv');
    return csv;
  });

  // 批量导入历史案件
  app.post('/api/import/cases', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.status(403).send({ error: '仅管理员可导入' });

    const parts = req.parts();
    let content = '';
    for await (const part of parts) {
      if (part.type === 'file') {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk as Buffer);
        content = Buffer.concat(chunks).toString('utf-8').replace(/^\uFEFF/, '');
      }
    }
    if (!content) return reply.status(400).send({ error: '文件为空' });

    const lines = content.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return reply.status(400).send({ error: '无有效数据' });

    const header = lines[0].split(',').map((h) => h.trim());
    const results: { success: boolean; name: string; error?: string }[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim());
      const row: any = {};
      header.forEach((h, idx) => { row[h] = cols[idx] || ''; });

      const name = row['案件名称'];
      const type = row['案件类型'];
      const our = row['我方当事人'];
      const opponent = row['对方当事人'];
      if (!name || !our || !opponent) {
        results.push({ success: false, name: name || `第${i + 1}行`, error: '缺少必填字段' });
        continue;
      }

      // 类型映射
      let typeKey = 'other';
      const typeMap: Record<string, string> = {
        '民事': 'civil', '刑事': 'criminal', '行政': 'administrative', '仲裁': 'arbitration',
        '执行': 'enforcement', '非诉': 'nonlitigation', '顾问': 'legal_advisor',
      };
      for (const [k, v] of Object.entries(typeMap)) {
        if (type.includes(k)) { typeKey = v; break; }
      }

      try {
        const year = row['委托开始日'] ? new Date(row['委托开始日']).getFullYear() : new Date().getFullYear();
        const caseNo = genCaseNo(typeKey, year);
        const folderPath = path.join(CASES_DIR, `${caseNo}-${name}`);
        fs.mkdirSync(folderPath, { recursive: true });

        const caseInfo = db.prepare(
          'INSERT INTO cases (case_no, name, type, lead_id, folder_path, status, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(caseNo, name, typeKey, req.user!.id, folderPath, 'closed', row['结案日'] || null);
        const cid = Number(caseInfo.lastInsertRowid);

        db.prepare('INSERT INTO case_parties (case_id, side, name, party_type) VALUES (?, ?, ?, ?)').run(cid, 'our', our, 'natural');
        db.prepare('INSERT INTO case_parties (case_id, side, name, party_type) VALUES (?, ?, ?, ?)').run(cid, 'opponent', opponent, 'natural');
        db.prepare('INSERT INTO case_legal_info (case_id, cause, court_case_no, entrust_start, close_date) VALUES (?, ?, ?, ?, ?)')
          .run(cid, row['案由'] || null, row['法院案号'] || null, row['委托开始日'] || null, row['结案日'] || null);

        // 阶段
        const stages = STAGE_TEMPLATES[typeKey] || STAGE_TEMPLATES.other;
        const insStage = db.prepare('INSERT INTO case_stages (case_id, name, sort_order) VALUES (?, ?, ?)');
        stages.forEach((s, idx) => insStage.run(cid, s, idx));

        db.prepare('INSERT INTO case_members (case_id, user_id) VALUES (?, ?)').run(cid, req.user!.id);
        results.push({ success: true, name });
      } catch (e: any) {
        results.push({ success: false, name, error: e.message });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    logAudit(req.user!.id, 'cases_import', 'cases', null, `成功${successCount}条，共${results.length}条`);
    return { results, success: successCount, total: results.length };
  });
}
