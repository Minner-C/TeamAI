import type { ProviderRow } from "../../types.js";

export type ApiStyle = "openai" | "anthropic";

export function providerStyle(row: ProviderRow): ApiStyle {
  return row.type === "anthropic" ? "anthropic" : "openai";
}

export function upstreamUrl(row: ProviderRow, style: ApiStyle): string {
  const base = row.base_url.replace(/\/+$/, "");
  if (style === "anthropic") {
    if (base.endsWith("/v1/messages")) return base;
    return `${base.replace(/\/v1$/, "")}/v1/messages`;
  }
  if (base.endsWith("/chat/completions")) return base;
  return `${base.endsWith("/v1") ? base : `${base}/v1`}/chat/completions`;
}

export function modelsUrl(row: ProviderRow): string {
  const base = row.base_url.replace(/\/+$/, "");
  const isAnthropic = row.type === "anthropic";
  const stripped = base
    .replace(/\/chat\/completions$/, "")
    .replace(/\/messages$/, "");
  if (isAnthropic) return `${stripped.replace(/\/v1$/, "")}/v1/models`;
  return `${stripped.endsWith("/v1") ? stripped : `${stripped}/v1`}/models`;
}

export function upstreamHeaders(row: ProviderRow, apiKey: string): Record<string, string> {
  if (providerStyle(row) === "anthropic") {
    return {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
  }
  return {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };
}

export interface ChatMessage {
  role: string;
  content: string;
}

export function openaiToAnthropic(body: Record<string, unknown>): Record<string, unknown> {
  const messages = (body.messages as ChatMessage[]) ?? [];
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const rest = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));
  const out: Record<string, unknown> = {
    model: body.model,
    messages: rest,
    max_tokens: (body.max_tokens as number) ?? 8192,
    stream: false,
  };
  if (system) out.system = system;
  if (body.temperature != null) out.temperature = body.temperature;
  return out;
}

export function anthropicToOpenai(body: Record<string, unknown>): Record<string, unknown> {
  const messages = (body.messages as ChatMessage[]) ?? [];
  const mapped: ChatMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
  if (typeof body.system === "string" && body.system) {
    mapped.unshift({ role: "system", content: body.system });
  }
  return {
    model: body.model,
    messages: mapped,
    max_tokens: body.max_tokens,
    temperature: body.temperature,
    stream: false,
  };
}

export function anthropicResponseToOpenai(resp: Record<string, unknown>): Record<string, unknown> {
  const content = (resp.content as Array<{ type: string; text?: string }>) ?? [];
  const text = content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
  const usage = (resp.usage as { input_tokens?: number; output_tokens?: number }) ?? {};
  return {
    id: resp.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: resp.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: resp.stop_reason === "end_turn" ? "stop" : ((resp.stop_reason as string) ?? "stop"),
      },
    ],
    usage: {
      prompt_tokens: usage.input_tokens ?? 0,
      completion_tokens: usage.output_tokens ?? 0,
      total_tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
    },
  };
}

export function openaiResponseToAnthropic(resp: Record<string, unknown>): Record<string, unknown> {
  const choices = (resp.choices as Array<{ message?: { content?: string } }>) ?? [];
  const text = choices[0]?.message?.content ?? "";
  const usage = (resp.usage as { prompt_tokens?: number; completion_tokens?: number }) ?? {};
  return {
    id: resp.id,
    type: "message",
    role: "assistant",
    model: resp.model,
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: {
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
    },
  };
}
