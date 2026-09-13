import bcrypt from 'bcryptjs';
import { db } from './schema.js';

export const STAGE_TEMPLATES: Record<string, string[]> = {
  civil: ['接案立项', '诉前准备', '立案受理', '庭前程序', '开庭审理', '裁判结果', '判后工作'],
  civil_appeal: ['上诉', '二审立案', '庭前准备', '开庭/书面审理', '裁判', '执行衔接'],
  civil_retrial: ['申请再审', '审查/听证', '再审审理', '裁判'],
  criminal: ['侦查阶段', '审查起诉', '一审', '二审/复核', '申诉'],
  administrative: ['行政复议', '行政诉讼一审', '二审', '申请执行'],
  arbitration: ['申请仲裁', '组庭', '证据交换', '开庭', '裁决', '申请执行'],
  enforcement: ['申请执行', '立案', '财产查控', '处置变现', '款项发放', '结案'],
  nonlitigation: ['立项', '尽职调查', '方案设计', '实施推进', '成果交付', '结案'],
  legal_advisor: ['签约', '日常咨询', '合同审查', '培训/专项支持', '年度续约评估'],
  other: ['自定义阶段'],
};

export const CASE_TYPE_LABELS: Record<string, string> = {
  civil: '民事', civil_appeal: '民事二审', civil_retrial: '民事再审', criminal: '刑事',
  administrative: '行政', arbitration: '仲裁', enforcement: '执行',
  nonlitigation: '非诉专项', legal_advisor: '常年法律顾问', other: '其他',
};

const DEFAULT_CONFLICT_RULES = [
  { level: 'forbidden', title: '同一案件双方代理', clause: '《律师法》第39条；规范第50条第1项' },
  { level: 'forbidden', title: '近亲属为对方法代/代理人', clause: '规范第50条第2项' },
  { level: 'forbidden', title: '转任律师后办理原经办案件', clause: '规范第50条第3项' },
  { level: 'forbidden', title: '同所代理刑案被害人与被告人', clause: '规范第50条第4项' },
  { level: 'forbidden', title: '同所代理争议双方（民诉/行诉/仲裁）', clause: '规范第50条第5项' },
  { level: 'forbidden', title: '同所代理非诉利害关系各方', clause: '规范第50条第6项' },
  { level: 'forbidden', title: '终止后同一案件后续程序接受对方委托', clause: '规范第50条第7项' },
  { level: 'consent', title: '同所律师为对方近亲属（民诉/仲裁）', clause: '规范第51条第1项' },
  { level: 'consent', title: '同所律师为被害人近亲属（刑案）', clause: '规范第51条第2项' },
  { level: 'consent', title: '同所接受在办案件对方其他业务', clause: '规范第51条第3项' },
  { level: 'consent', title: '终止后一年内就同一法律事务接受对方委托', clause: '规范第51条第5项' },
  { level: 'caution', title: '终止一年以上可能利用保密信息', clause: '《律师法》第38条保密义务' },
  { level: 'caution', title: '对方关联主体出现在本所其他案件', clause: '规范第50条第8项兜底' },
];

export function seed() {
  const adminExists = db.prepare('SELECT id FROM users WHERE account = ?').get('admin');
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare("INSERT INTO users (name, account, password_hash, role) VALUES (?, ?, ?, 'admin')")
      .run('系统管理员', 'admin', hash);
  }
  const ruleCount = db.prepare('SELECT COUNT(*) as c FROM conflict_rules').get() as { c: number };
  if (ruleCount.c === 0) {
    const insert = db.prepare('INSERT INTO conflict_rules (level, title, clause) VALUES (?, ?, ?)');
    for (const r of DEFAULT_CONFLICT_RULES) insert.run(r.level, r.title, r.clause);
  }
}
