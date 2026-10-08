import type { ModelRoute } from "@teamai/shared";

const ROUTES: ModelRoute[] = [
  { model: "kimi-for-coding", cli: "kimi", providerType: "openai-compatible" },
  { model: "claude-sonnet-4-5", cli: "claude", providerType: "anthropic" },
  { model: "gpt-5-codex", cli: "codex", providerType: "openai-compatible" },
  { model: "gemini-2.5-pro", cli: "gemini", providerType: "gemini" },
  { model: "qwen3-coder-plus", cli: "qwen", providerType: "openai-compatible" },
];

export function listModelRoutes(): ModelRoute[] {
  return ROUTES;
}

export function resolveRoute(model: string): ModelRoute | undefined {
  return ROUTES.find((r) => r.model === model);
}

export function gatewayEnvForCli(
  cli: string,
  baseUrl: string,
  key: string,
): Record<string, string> | null {
  const route = ROUTES.find((r) => r.cli === cli);
  if (cli === "claude") {
    return {
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_AUTH_TOKEN: key,
      ...(route ? { ANTHROPIC_MODEL: route.model } : {}),
    };
  }
  if (cli === "codex" || cli === "qwen") {
    return {
      OPENAI_BASE_URL: `${baseUrl}/v1`,
      OPENAI_API_KEY: key,
      ...(route ? { OPENAI_MODEL: route.model } : {}),
    };
  }
  return null;
}
