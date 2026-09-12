import type { Db } from "../../db.js";
import { randomId } from "../core/crypto.js";

export interface AuditRow {
  id: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  target: string;
  detail: string;
  ip: string;
  ts: number;
}

export interface AuditView {
  id: string;
  userId: string | null;
  userEmail: string | null;
  action: string;
  target: string;
  detail: string;
  ip: string;
  ts: number;
}

function toView(r: AuditRow): AuditView {
  return {
    id: r.id,
    userId: r.user_id,
    userEmail: r.user_email,
    action: r.action,
    target: r.target,
    detail: r.detail,
    ip: r.ip,
    ts: r.ts,
  };
}

export function recordAudit(
  db: Db,
  entry: { userId?: string | null; userEmail?: string | null; action: string; target?: string; detail?: string; ip?: string },
) {
  db.prepare(
    "INSERT INTO audit_logs (id, user_id, user_email, action, target, detail, ip, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    randomId(),
    entry.userId ?? null,
    entry.userEmail ?? null,
    entry.action,
    entry.target ?? "",
    entry.detail ?? "",
    entry.ip ?? "",
    Date.now(),
  );
}

export function listAudit(db: Db, opts: { limit?: number; action?: string; userId?: string }): AuditView[] {
  const limit = Math.min(opts.limit ?? 100, 500);
  const conds: string[] = [];
  const args: (string | number)[] = [];
  if (opts.action) {
    conds.push("action LIKE ?");
    args.push(`${opts.action}%`);
  }
  if (opts.userId) {
    conds.push("user_id = ?");
    args.push(opts.userId);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM audit_logs ${where} ORDER BY ts DESC LIMIT ?`)
    .all(...args, limit) as unknown as AuditRow[];
  return rows.map(toView);
}
