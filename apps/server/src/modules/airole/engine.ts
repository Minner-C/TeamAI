import type { FastifyInstance } from "fastify";
import type { AiRole, Message } from "@teamai/shared";
import type { ProviderRow } from "../../types.js";
import { findProviderForModel, providerApiKey } from "../gateway/store.js";
import { providerStyle, upstreamHeaders, upstreamUrl } from "../gateway/providers.js";
import { insertMessage, listMessages, listRoles, toMessageView, type AiRoleRow } from "../im/store.js";
import { broadcastToChannel } from "../im/hub.js";
import { insertUsage } from "../usage/store.js";

function toSharedRole(row: AiRoleRow): AiRole {
  return {
    id: row.id,
    channelId: row.channel_id,
    name: row.name,
    personaPrompt: row.persona_prompt,
    model: row.model,
    trigger: row.trigger_kind as AiRole["trigger"],
    enabled: !!row.enabled,
  };
}

export function shouldTrigger(role: AiRole, message: Message): boolean {
  if (!role.enabled || message.senderRoleId) return false;
  switch (role.trigger) {
    case "mention":
      return message.content.includes(`@${role.name}`);
    case "keyword":
      return false;
    case "auto":
      return false;
  }
}

async function callModel(
  app: FastifyInstance,
  provider: ProviderRow,
  model: string,
  messages: Array<{ role: string; content: string }>,
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const apiKey = providerApiKey(provider, app.config.jwtSecret);
  const style = providerStyle(provider);
  const body =
    style === "anthropic"
      ? {
          model,
          max_tokens: 4096,
          system: messages.find((m) => m.role === "system")?.content ?? "",
          messages: messages.filter((m) => m.role !== "system"),
          stream: false,
        }
      : { model, messages, stream: false };
  const res = await fetch(upstreamUrl(provider, style), {
    method: "POST",
    headers: upstreamHeaders(provider, apiKey),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  if (style === "anthropic") {
    const content = (json.content as Array<{ type: string; text?: string }>) ?? [];
    const u = (json.usage as { input_tokens?: number; output_tokens?: number }) ?? {};
    return {
      text: content.filter((c) => c.type === "text").map((c) => c.text ?? "").join(""),
      tokensIn: u.input_tokens ?? 0,
      tokensOut: u.output_tokens ?? 0,
    };
  }
  const choices = (json.choices as Array<{ message?: { content?: string } }>) ?? [];
  const u = (json.usage as { prompt_tokens?: number; completion_tokens?: number }) ?? {};
  return {
    text: choices[0]?.message?.content ?? "",
    tokensIn: u.prompt_tokens ?? 0,
    tokensOut: u.completion_tokens ?? 0,
  };
}

export async function triggerRolesForMessage(app: FastifyInstance, messageRowId: string): Promise<void> {
  const db = app.db;
  const msgRow = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageRowId) as
    | import("../im/store.js").MessageRow
    | undefined;
  if (!msgRow || msgRow.sender_role_id) return;
  const msg = toMessageView(db, msgRow);
  const roles = listRoles(db, msgRow.channel_id).map(toSharedRole);

  for (const role of roles) {
    if (!shouldTrigger(role, msg)) continue;
    const provider = findProviderForModel(db, role.model);
    if (!provider) continue;

    const history = listMessages(db, msgRow.channel_id, { limit: 30 }).map((r) => {
      const v = toMessageView(db, r);
      return {
        role: r.sender_role_id === role.id ? "assistant" : "user",
        content: `${v.senderName}: ${v.content}`,
      };
    });

    let replyText: string;
    try {
      const result = await callModel(app, provider, role.model, [
        { role: "system", content: `你是群聊中的 AI 角色「${role.name}」。${role.personaPrompt}\n用中文简洁回复，直接输出回复内容。` },
        ...history,
      ]);
      replyText = result.text;
      insertUsage(db, {
        userId: msg.senderUserId ?? "system",
        model: role.model,
        providerId: provider.id,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        estimated: result.tokensIn === 0 && result.tokensOut === 0,
        cli: "ai-role",
        taskId: msgRow.channel_id,
      });
    } catch (err) {
      app.log.error(err, `ai role ${role.name} reply failed`);
      continue;
    }
    if (!replyText.trim()) continue;

    const out = insertMessage(db, {
      channelId: msgRow.channel_id,
      senderRoleId: role.id,
      type: "markdown",
      content: replyText,
    });
    broadcastToChannel(db, msgRow.channel_id, { type: "message:new", message: toMessageView(db, out) });
  }
}
