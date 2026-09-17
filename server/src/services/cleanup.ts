import { db } from '../db/schema.js';

// 数据保留策略（天）
const AUDIT_RETENTION_DAYS = 90;   // 审计日志保留 90 天
const NOTIFICATION_RETENTION_DAYS = 30; // 已读通知保留 30 天

// 清理过期审计日志
export function cleanupAuditLogs() {
  const r = db.prepare(
    `DELETE FROM audit_logs WHERE created_at < datetime('now', ?)`
  ).run(`-${AUDIT_RETENTION_DAYS} days`);
  return r.changes;
}

// 清理已读且超过保留期的通知
export function cleanupNotifications() {
  const r = db.prepare(
    `DELETE FROM notifications WHERE is_read = 1 AND created_at < datetime('now', ?)`
  ).run(`-${NOTIFICATION_RETENTION_DAYS} days`);
  return r.changes;
}

// 启动时执行一次全量清理
export function runStartupCleanup() {
  const auditDeleted = cleanupAuditLogs();
  const notifDeleted = cleanupNotifications();
  return { auditDeleted, notifDeleted };
}
