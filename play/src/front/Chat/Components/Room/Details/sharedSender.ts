import type { ChatMessage } from "../../../Connection/ChatConnection";

/** Who sent a shared item, as its row says it: "You" for your own. */
export function sharedSender(message: ChatMessage, you: string): string {
    return message.isMyMessage ? you : message.sender?.username ?? "";
}
