import type { AiRole, Message } from "@teamai/shared";

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

export async function generateRoleReply(_role: AiRole, _history: Message[]): Promise<string> {
  throw new Error("ai role engine not implemented yet");
}
