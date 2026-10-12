// 联系人/当事人角色字典
// 按 side（我方/对方/第三人/法院/其他联系人）分组，前端据此渲染下拉。
// 每个角色 code 为稳定英文标识，label 为中文显示名。
// 保留 role 字段为自由文本，前端可选"其他"自行输入，便于覆盖字典外的特殊身份。

export interface PartyRole {
  code: string;
  label: string;
}

// 各 side 下常用的候选角色
export const PARTY_ROLES: Record<string, PartyRole[]> = {
  // 我方（律师代理的一方）
  our: [
    { code: 'client', label: '委托人' },
    { code: 'plaintiff', label: '原告' },
    { code: 'defendant', label: '被告' },
    { code: 'appellant', label: '上诉人' },
    { code: 'appellee', label: '被上诉人' },
    { code: 'applicant', label: '申请人' },
    { code: 'respondent', label: '被申请人' },
    { code: 'execution_applicant', label: '申请执行人' },
    { code: 'executee', label: '被执行人' },
    { code: 'legal_rep', label: '法定代表人' },
    { code: 'principal', label: '负责人' },
    { code: 'statutory_agent', label: '法定代理人' },
    { code: 'litigation_agent', label: '委托诉讼代理人' },
    { code: 'lawyer', label: '律师' },
    { code: 'intern_lawyer', label: '实习律师' },
    { code: 'paralegal', label: '律师助理' },
  ],
  // 对方
  opponent: [
    { code: 'plaintiff', label: '原告' },
    { code: 'defendant', label: '被告' },
    { code: 'appellant', label: '上诉人' },
    { code: 'appellee', label: '被上诉人' },
    { code: 'third_party', label: '第三人' },
    { code: 'applicant', label: '申请人' },
    { code: 'respondent', label: '被申请人' },
    { code: 'legal_rep', label: '法定代表人' },
    { code: 'statutory_agent', label: '法定代理人' },
    { code: 'litigation_agent', label: '委托诉讼代理人' },
    { code: 'opposing_lawyer', label: '对方律师' },
  ],
  // 第三人
  third: [
    { code: 'third_party_independent', label: '有独立请求权第三人' },
    { code: 'third_party_dependent', label: '无独立请求权第三人' },
    { code: 'legal_rep', label: '法定代表人' },
    { code: 'statutory_agent', label: '法定代理人' },
    { code: 'litigation_agent', label: '委托诉讼代理人' },
  ],
  // 法院/仲裁
  court: [
    { code: 'chief_judge', label: '审判长' },
    { code: 'judge', label: '审判员' },
    { code: 'acting_judge', label: '代理审判员' },
    { code: 'people_assessor', label: '人民陪审员' },
    { code: 'clerk', label: '书记员' },
    { code: 'judge_assistant', label: '法官助理' },
    { code: 'executor', label: '执行员' },
    { code: 'arbitrator', label: '仲裁员' },
    { code: 'chief_arbitrator', label: '首席仲裁员' },
    { code: 'arbitration_secretary', label: '仲裁秘书' },
  ],
  // 其他联系人（诉讼参与人 / 案外相关人）
  contact: [
    { code: 'witness', label: '证人' },
    { code: 'expert_witness', label: '鉴定人' },
    { code: 'inspector', label: '勘验人' },
    { code: 'interpreter', label: '翻译人员' },
    { code: 'expert_helper', label: '专家辅助人' },
    { code: 'testifier', label: '见证人' },
    { code: 'guarantor', label: '担保人' },
    { code: 'third_person', label: '案外人' },
    { code: 'interested_party', label: '利害关系人' },
    { code: 'contact', label: '其他联系人' },
  ],
};

// side 中文标签（与前端 CATEGORIES 保持一致）
export const SIDE_LABELS: Record<string, string> = {
  our: '我方当事人',
  opponent: '对方当事人',
  third: '第三人',
  court: '法院人员',
  contact: '其他联系人',
};
