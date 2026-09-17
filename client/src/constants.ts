// 案件类型：与后端 server/src/db/seed.ts 的 CASE_TYPE_LABELS / STAGE_TEMPLATES 保持一致
// 修改类型时需前后端同步
export const CASE_TYPE_LABELS: Record<string, string> = {
  civil: '民事',
  civil_appeal: '民事二审',
  civil_retrial: '民事再审',
  criminal: '刑事',
  administrative: '行政',
  arbitration: '仲裁',
  enforcement: '执行',
  nonlitigation: '非诉专项',
  legal_advisor: '常年法律顾问',
  other: '其他',
};

export const CASE_TYPES = Object.entries(CASE_TYPE_LABELS).map(([v, l]) => ({ v, l }));

export const CASE_STATUS_LABELS: Record<string, string> = {
  active: '办理中',
  closed: '已结案',
  archived: '已归档',
};

export const typeLabel = (v?: string | null) => (v ? CASE_TYPE_LABELS[v] || v : '');
export const statusLabel = (v?: string | null) => (v ? CASE_STATUS_LABELS[v] || v : '');
