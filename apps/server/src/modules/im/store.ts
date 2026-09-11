import type { Db } from "../../db.js";
import type { Message } from "@teamai/shared";
import { randomId } from "../core/crypto.js";

export interface ChannelRow {
  id: string;
  type: "dm" | "group";
  name: string;
  owner_id: string;
  created_at: number;
}

export interface MessageRow {
  id: string;
  channel_id: string;
  sender_user_id: string | null;
  sender_role_id: string | null;
  type: string;
  content: string;
  payload_json: string | null;
  created_at: number;
}

export interface AiRoleRow {
  id: string;
  channel_id: string;
  name: string;
  persona_prompt: string;
  model: string;
  trigger_kind: string;
  enabled: number;
  created_at: number;
}

export function toMessageView(db: Db, row: MessageRow): Message & { senderName: string } {
  let senderName = "";
  if (row.sender_user_id) {
    const u = db.prepare("SELECT name FROM users WHERE id = ?").get(row.sender_user_id) as
      | { name: string }
      | undefined;
    senderName = u?.name ?? "?";
  } else if (row.sender_role_id) {
    const r = db.prepare("SELECT name FROM ai_roles WHERE id = ?").get(row.sender_role_id) as
      | { name: string }
      | undefined;
    senderName = r?.name ?? "AI";
  }
  return {
    id: row.id,
    channelId: row.channel_id,
    senderUserId: row.sender_user_id,
    senderRoleId: row.sender_role_id,
    type: row.type as Message["type"],
    content: row.content,
    payload: row.payload_json ? (JSON.parse(row.payload_json) as Record<string, unknown>) : undefined,
    createdAt: row.created_at,
    senderName,
  };
}

export function isMember(db: Db, channelId: string, userId: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?")
    .get(channelId, userId);
}

export function channelMembers(db: Db, channelId: string): string[] {
  return (
    db.prepare("SELECT user_id FROM channel_members WHERE channel_id = ?").all(channelId) as unknown as Array<{
      user_id: string;
    }>
  ).map((r) => r.user_id);
}

export function createChannel(
  db: Db,
  input: { type: "dm" | "group"; name?: string; ownerId: string; memberIds: string[] },
): ChannelRow {
  if (input.type === "dm") {
    const other = input.memberIds.find((id) => id !== input.ownerId);
    if (!other) throw new Error("dm requires another member");
    const rows = db
      .prepare(
        `SELECT c.* FROM channels c
         WHERE c.type = 'dm'
           AND EXISTS (SELECT 1 FROM channel_members m WHERE m.channel_id = c.id AND m.user_id = ?)
           AND EXISTS (SELECT 1 FROM channel_members m WHERE m.channel_id = c.id AND m.user_id = ?)`,
      )
      .all(input.ownerId, other) as unknown as ChannelRow[];
    if (rows[0]) return rows[0];
  }
  const row: ChannelRow = {
    id: randomId(),
    type: input.type,
    name: input.name ?? "",
    owner_id: input.ownerId,
    created_at: Date.now(),
  };
  db.prepare("INSERT INTO channels (id, type, name, owner_id, created_at) VALUES (?, ?, ?, ?, ?)").run(
    row.id,
    row.type,
    row.name,
    row.owner_id,
    row.created_at,
  );
  const memberSet = new Set([input.ownerId, ...input.memberIds]);
  for (const uid of memberSet) {
    db.prepare("INSERT OR IGNORE INTO channel_members (channel_id, user_id) VALUES (?, ?)").run(row.id, uid);
  }
  return row;
}

export function insertMessage(
  db: Db,
  input: {
    channelId: string;
    senderUserId?: string | null;
    senderRoleId?: string | null;
    type?: string;
    content: string;
    payload?: Record<string, unknown>;
  },
): MessageRow {
  const row: MessageRow = {
    id: randomId(),
    channel_id: input.channelId,
    sender_user_id: input.senderUserId ?? null,
    sender_role_id: input.senderRoleId ?? null,
    type: input.type ?? "text",
    content: input.content,
    payload_json: input.payload ? JSON.stringify(input.payload) : null,
    created_at: Date.now(),
  };
  db.prepare(
    "INSERT INTO messages (id, channel_id, sender_user_id, sender_role_id, type, content, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    row.id,
    row.channel_id,
    row.sender_user_id,
    row.sender_role_id,
    row.type,
    row.content,
    row.payload_json,
    row.created_at,
  );
  return row;
}

export function listMessages(
  db: Db,
  channelId: string,
  opts: { before?: number; limit: number },
): MessageRow[] {
  const rows = (
    opts.before
      ? db
          .prepare(
            "SELECT * FROM messages WHERE channel_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?",
          )
          .all(channelId, opts.before, opts.limit)
      : db
          .prepare("SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?")
          .all(channelId, opts.limit)
  ) as unknown as MessageRow[];
  return rows.reverse();
}

export function listMyChannels(db: Db, userId: string) {
  const rows = db
    .prepare(
      `SELECT c.* FROM channels c JOIN channel_members m ON m.channel_id = c.id WHERE m.user_id = ? ORDER BY c.created_at DESC`,
    )
    .all(userId) as unknown as ChannelRow[];
  return rows.map((c) => {
    const last = db
      .prepare("SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(c.id) as MessageRow | undefined;
    const member = db
      .prepare("SELECT last_read_at FROM channel_members WHERE channel_id = ? AND user_id = ?")
      .get(c.id, userId) as { last_read_at: number };
    const unread = db
      .prepare(
        "SELECT COUNT(*) AS n FROM messages WHERE channel_id = ? AND created_at > ? AND (sender_user_id IS NULL OR sender_user_id != ?)",
      )
      .get(c.id, member.last_read_at, userId) as { n: number };
    let displayName = c.name;
    if (c.type === "dm") {
      const otherId = channelMembers(db, c.id).find((id) => id !== userId);
      const other = otherId
        ? (db.prepare("SELECT name FROM users WHERE id = ?").get(otherId) as { name: string } | undefined)
        : undefined;
      displayName = other?.name ?? "未知用户";
    }
    return {
      id: c.id,
      type: c.type,
      name: displayName,
      ownerId: c.owner_id,
      createdAt: c.created_at,
      unread: unread.n,
      lastMessage: last ? toMessageView(db, last) : null,
    };
  });
}

export function markRead(db: Db, channelId: string, userId: string): void {
  db.prepare("UPDATE channel_members SET last_read_at = ? WHERE channel_id = ? AND user_id = ?").run(
    Date.now(),
    channelId,
    userId,
  );
}

export function listRoles(db: Db, channelId: string): AiRoleRow[] {
  return db
    .prepare("SELECT * FROM ai_roles WHERE channel_id = ? ORDER BY created_at ASC")
    .all(channelId) as unknown as AiRoleRow[];
}

export function createRole(
  db: Db,
  input: { channelId: string; name: string; personaPrompt: string; model: string; trigger?: string },
): AiRoleRow {
  const row: AiRoleRow = {
    id: randomId(),
    channel_id: input.channelId,
    name: input.name,
    persona_prompt: input.personaPrompt,
    model: input.model,
    trigger_kind: input.trigger ?? "mention",
    enabled: 1,
    created_at: Date.now(),
  };
  db.prepare(
    "INSERT INTO ai_roles (id, channel_id, name, persona_prompt, model, trigger_kind, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
  ).run(row.id, row.channel_id, row.name, row.persona_prompt, row.model, row.trigger_kind, row.created_at);
  return row;
}

export function deleteRole(db: Db, id: string): boolean {
  return db.prepare("DELETE FROM ai_roles WHERE id = ?").run(id).changes > 0;
}
