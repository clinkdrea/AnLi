import { db } from '../db/schema.js';

export function logAudit(
  userId: number | null,
  action: string,
  objectType?: string,
  objectId?: string | number,
  detail?: string
) {
  db.prepare(
    'INSERT INTO audit_logs (user_id, action, object_type, object_id, detail) VALUES (?, ?, ?, ?, ?)'
  ).run(
    userId ?? null,
    action,
    objectType ?? null,
    objectId != null ? String(objectId) : null,
    detail ?? null
  );
}
