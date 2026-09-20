import type { Db } from "../../db.js";
import { randomId } from "../core/crypto.js";

export interface UsageInput {
  userId: string;
  model: string;
  providerId: string;
  tokensIn: number;
  tokensOut: number;
  estimated: boolean;
  cli?: string | null;
  taskId?: string | null;
}

export function insertUsage(db: Db, input: UsageInput): void {
  db.prepare(
    `INSERT INTO usage_records (id, user_id, model, provider_id, tokens_in, tokens_out, cost, estimated, cli, task_id, ts)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
  ).run(
    randomId(),
    input.userId,
    input.model,
    input.providerId,
    input.tokensIn,
    input.tokensOut,
    input.estimated ? 1 : 0,
    input.cli ?? null,
    input.taskId ?? null,
    Date.now(),
  );
}

export interface UsageQuery {
  from?: number;
  to?: number;
  userId?: string;
  model?: string;
}

function buildWhere(q: UsageQuery): { sql: string; params: Array<string | number> } {
  const conds: string[] = [];
  const params: Array<string | number> = [];
  if (q.from) {
    conds.push("ts >= ?");
    params.push(q.from);
  }
  if (q.to) {
    conds.push("ts <= ?");
    params.push(q.to);
  }
  if (q.userId) {
    conds.push("user_id = ?");
    params.push(q.userId);
  }
  if (q.model) {
    conds.push("model = ?");
    params.push(q.model);
  }
  return { sql: conds.length ? `WHERE ${conds.join(" AND ")}` : "", params };
}

export function querySummary(db: Db, q: UsageQuery) {
  const { sql, params } = buildWhere(q);
  const total = db
    .prepare(
      `SELECT COALESCE(SUM(tokens_in),0) AS tokensIn, COALESCE(SUM(tokens_out),0) AS tokensOut, COALESCE(SUM(cost),0) AS cost FROM usage_records ${sql}`,
    )
    .get(...params) as { tokensIn: number; tokensOut: number; cost: number };

  const byModelRows = db
    .prepare(
      `SELECT model, SUM(tokens_in) AS tokensIn, SUM(tokens_out) AS tokensOut FROM usage_records ${sql} GROUP BY model`,
    )
    .all(...params) as Array<{ model: string; tokensIn: number; tokensOut: number }>;

  const byUserRows = db
    .prepare(
      `SELECT user_id AS userId, SUM(tokens_in) AS tokensIn, SUM(tokens_out) AS tokensOut FROM usage_records ${sql} GROUP BY user_id`,
    )
    .all(...params) as Array<{ userId: string; tokensIn: number; tokensOut: number }>;

  return {
    totalTokensIn: total.tokensIn,
    totalTokensOut: total.tokensOut,
    totalCost: total.cost,
    byModel: Object.fromEntries(byModelRows.map((r) => [r.model, { tokensIn: r.tokensIn, tokensOut: r.tokensOut }])),
    byUser: Object.fromEntries(byUserRows.map((r) => [r.userId, { tokensIn: r.tokensIn, tokensOut: r.tokensOut }])),
  };
}

export function queryRecords(db: Db, q: UsageQuery & { limit: number; offset: number }) {
  const { sql, params } = buildWhere(q);
  return db
    .prepare(`SELECT * FROM usage_records ${sql} ORDER BY ts DESC LIMIT ? OFFSET ?`)
    .all(...params, q.limit, q.offset);
}

interface Bucket {
  tokensIn: number;
  tokensOut: number;
  cost: number;
  requests: number;
}

function queryBucket(db: Db, q: UsageQuery): Bucket {
  const { sql, params } = buildWhere(q);
  return db
    .prepare(
      `SELECT COALESCE(SUM(tokens_in),0) AS tokensIn, COALESCE(SUM(tokens_out),0) AS tokensOut, COALESCE(SUM(cost),0) AS cost, COUNT(*) AS requests FROM usage_records ${sql}`,
    )
    .get(...params) as unknown as Bucket;
}

export function queryStats(db: Db, q: UsageQuery) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfWeek = startOfToday - 6 * 86400000;

  const range = queryBucket(db, q);
  const today = queryBucket(db, { ...q, from: startOfToday, to: undefined });
  const week = queryBucket(db, { ...q, from: startOfWeek, to: undefined });

  const { sql, params } = buildWhere(q);

  const heatFrom = startOfToday - 118 * 86400000;
  const dayConds = ["ts >= ?"];
  const dayParams: Array<string | number> = [heatFrom];
  if (q.userId) {
    dayConds.push("user_id = ?");
    dayParams.push(q.userId);
  }
  const byDayRows = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime') AS day, SUM(tokens_in + tokens_out) AS tokens
       FROM usage_records WHERE ${dayConds.join(" AND ")} GROUP BY day`,
    )
    .all(...dayParams) as Array<{ day: string; tokens: number }>;

  const byModel = db
    .prepare(
      `SELECT model AS name, SUM(tokens_in) AS tokensIn, SUM(tokens_out) AS tokensOut FROM usage_records ${sql} GROUP BY model ORDER BY tokensIn + tokensOut DESC`,
    )
    .all(...params) as Array<{ name: string; tokensIn: number; tokensOut: number }>;

  const byUser = db
    .prepare(
      `SELECT u.id AS userId, COALESCE(u.name, u.email) AS name, SUM(r.tokens_in) AS tokensIn, SUM(r.tokens_out) AS tokensOut
       FROM usage_records r LEFT JOIN users u ON u.id = r.user_id ${sql} GROUP BY r.user_id ORDER BY tokensIn + tokensOut DESC`,
    )
    .all(...params) as Array<{ userId: string; name: string; tokensIn: number; tokensOut: number }>;

  const byCli = db
    .prepare(
      `SELECT COALESCE(cli, '网关') AS name, SUM(tokens_in) AS tokensIn, SUM(tokens_out) AS tokensOut FROM usage_records ${sql} GROUP BY COALESCE(cli, '网关') ORDER BY tokensIn + tokensOut DESC`,
    )
    .all(...params) as Array<{ name: string; tokensIn: number; tokensOut: number }>;

  return { range, today, week, byDay: byDayRows, byModel, byUser, byCli };
}
