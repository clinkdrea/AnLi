import type { FastifyInstance } from 'fastify';
import { db } from '../db/schema.js';
import { logAudit } from '../services/audit.js';

interface Hit {
  case_id: number;
  case_no: string;
  case_name: string;
  matched_name: string;
  side: string;
  cause: string | null;
  court_case_no: string | null;
  status: string;
  close_date: string | null;
  lead_name: string | null;
}

// 判定风险等级
function judgeRisk(hit: Hit, query: any): { level: 'forbidden' | 'consent' | 'caution' | 'safe'; reason: string } {
  const now = new Date();
  const closeDate = hit.close_date ? new Date(hit.close_date) : null;
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

  // 🚫 禁止代理：同一案件后续程序（案号相同且对方身份）
  if (query.court_case_no && hit.court_case_no === query.court_case_no && hit.side === 'opponent') {
    return { level: 'forbidden', reason: '同一案件后续审理或处理中接受对方当事人委托（规范第50条第7项）' };
  }

  // 🚫 同所同时代理争议双方（对方当事人在其他在办案件中作为我方）
  if (hit.side === 'our' && hit.status === 'active' && hit.case_id !== query.case_id) {
    return { level: 'forbidden', reason: '同所律师正在代理该对方当事人的其他在办案件（规范第50条第5项）' };
  }

  // ⚠️ 终止后一年内就同一法律事务接受对方委托
  if (hit.side === 'opponent' && closeDate && closeDate > oneYearAgo) {
    const sameCause = query.cause && hit.cause && (query.cause === hit.cause || hit.cause!.includes(query.cause) || query.cause.includes(hit.cause!));
    if (sameCause) {
      return { level: 'consent', reason: '委托关系终止后一年内，就同一法律事务接受对方当事人委托（规范第51条第5项）' };
    }
    return { level: 'consent', reason: '委托关系终止后一年内接受对方当事人委托，需核查是否为同一法律事务（规范第51条第5项）' };
  }

  // 👁 审慎评估：一年以上但可能利用保密信息；或关联主体
  if (hit.side === 'opponent' && closeDate && closeDate <= oneYearAgo) {
    return { level: 'caution', reason: '委托终止一年以上，需评估是否可能利用原委托人保密信息（《律师法》第38条）' };
  }

  // 👁 对方关联主体出现在本所其他案件
  if (hit.side === 'related') {
    return { level: 'caution', reason: '对方关联主体出现在本所其他案件中（规范第50条第8项兜底）' };
  }

  return { level: 'safe', reason: '未发现冲突' };
}

export default async function conflictRoutes(app: FastifyInstance) {
  // 执行冲突检索（可对已有案件，也可独立检索）
  app.post('/api/conflicts/check', async (req, reply) => {
    const { our_party, opponent_name, related_parties, cause, court_case_no, case_id } = req.body as any;
    if (!opponent_name?.trim()) return reply.status(400).send({ error: '对方当事人为必填' });

    const hits: Hit[] = [];
    const seen = new Set<string>();

    // 检索对方当事人：在全所案件的我方/对方/第三人中匹配
    const partyRows = db.prepare(
      `SELECT cp.case_id, cp.side, cp.name, c.case_no, c.name as case_name, c.status, c.lead_id,
              cli.cause, cli.court_case_no, cli.close_date, u.name as lead_name
       FROM case_parties cp
       JOIN cases c ON cp.case_id = c.id
       LEFT JOIN case_legal_info cli ON cli.case_id = c.id
       LEFT JOIN users u ON c.lead_id = u.id
       WHERE cp.name = ? OR cp.name LIKE ?`
    ).all(opponent_name.trim(), `%${opponent_name.trim()}%`) as any[];

    for (const r of partyRows) {
      if (case_id && r.case_id === case_id) continue;
      const key = `${r.case_id}-${r.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        case_id: r.case_id, case_no: r.case_no, case_name: r.case_name,
        matched_name: r.name, side: r.side, cause: r.cause, court_case_no: r.court_case_no,
        status: r.status, close_date: r.close_date, lead_name: r.lead_name,
      });
    }

    // 检索关联主体
    if (related_parties?.length) {
      for (const rp of related_parties) {
        if (!rp.name?.trim()) continue;
        const relRows = db.prepare(
          `SELECT cp.case_id, cp.side, cp.name, c.case_no, c.name as case_name, c.status,
                  cli.cause, cli.court_case_no, cli.close_date, u.name as lead_name
           FROM case_parties cp
           JOIN cases c ON cp.case_id = c.id
           LEFT JOIN case_legal_info cli ON cli.case_id = c.id
           LEFT JOIN users u ON c.lead_id = u.id
           WHERE cp.name = ? OR cp.name LIKE ?`
        ).all(rp.name.trim(), `%${rp.name.trim()}%`) as any[];
        for (const r of relRows) {
          if (case_id && r.case_id === case_id) continue;
          const key = `${r.case_id}-${r.name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          hits.push({
            case_id: r.case_id, case_no: r.case_no, case_name: r.case_name,
            matched_name: r.name, side: 'related', cause: r.cause, court_case_no: r.court_case_no,
            status: r.status, close_date: r.close_date, lead_name: r.lead_name,
          });
        }
      }
    }

    // 逐条判定风险
    const query = { cause, court_case_no, case_id };
    const judged = hits.map((h) => ({ ...h, ...judgeRisk(h, query) }));

    // 汇总风险等级（取最高级别）
    const order = { safe: 0, caution: 1, consent: 2, forbidden: 3 } as const;
    let overall: 'forbidden' | 'consent' | 'caution' | 'safe' = 'safe';
    for (const h of judged) {
      if (order[h.level] > order[overall]) overall = h.level;
    }

    // 引用规则
    const rules = db.prepare('SELECT * FROM conflict_rules WHERE enabled = 1').all();

    // 保存报告
    const report = db.prepare(
      `INSERT INTO conflict_reports (case_id, query_json, hits_json, risk_level, rule_refs, operator_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      case_id || null,
      JSON.stringify({ our_party, opponent_name, related_parties, cause, court_case_no }),
      JSON.stringify(judged),
      overall,
      JSON.stringify(rules),
      req.user!.id
    );
    const reportId = Number(report.lastInsertRowid);
    logAudit(req.user!.id, 'conflict_check', 'conflict_report', reportId, `opponent=${opponent_name}, risk=${overall}`);

    return reply.status(201).send({ report_id: reportId, overall, hits: judged, rules });
  });

  // 获取冲突报告
  app.get('/api/conflicts/:id', async (req, reply) => {
    const rid = Number((req.params as any).id);
    const report = db.prepare('SELECT * FROM conflict_reports WHERE id = ?').get(rid) as any;
    if (!report) return reply.status(404).send({ error: '报告不存在' });
    report.hits = JSON.parse(report.hits_json);
    report.query = JSON.parse(report.query_json);
    report.rule_refs = report.rule_refs ? JSON.parse(report.rule_refs) : [];
    return { report };
  });

  // 案件的冲突报告列表
  app.get('/api/cases/:id/conflicts', async (req) => {
    const cid = Number((req.params as any).id);
    const reports = db.prepare(
      `SELECT cr.*, u.name as operator_name FROM conflict_reports cr
       LEFT JOIN users u ON cr.operator_id = u.id
       WHERE cr.case_id = ? ORDER BY cr.created_at DESC`
    ).all(cid);
    return { reports };
  });

  // 填写处理结论（主办律师必选）
  app.post('/api/conflicts/:id/conclusion', async (req, reply) => {
    const rid = Number((req.params as any).id);
    const { conclusion, remark } = req.body as any;
    const valid = ['accept_no_conflict', 'accept_with_consent', 'decline'];
    if (!valid.includes(conclusion)) return reply.status(400).send({ error: '处理结论无效' });
    const report = db.prepare('SELECT * FROM conflict_reports WHERE id = ?').get(rid) as any;
    if (!report) return reply.status(404).send({ error: '报告不存在' });
    if (report.risk_level === 'forbidden' && conclusion === 'accept_no_conflict' && !remark) {
      return reply.status(400).send({ error: '存在禁止代理情形，必须填写处理说明' });
    }
    db.prepare('UPDATE conflict_reports SET conclusion = ? WHERE id = ?').run(
      conclusion + (remark ? `|${remark}` : ''), rid
    );
    logAudit(req.user!.id, 'conflict_conclusion', 'conflict_report', rid, conclusion);
    return { ok: true };
  });
}
