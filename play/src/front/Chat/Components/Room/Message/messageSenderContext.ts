/** Lets a message's file card say who sent the file ("From Sara") without every message part passing it along. */
export const MESSAGE_SENDER_CONTEXT = "chat-message-sender";

export interface MessageSenderInfo {
    name: string | undefined;
    isMine: boolean;
}
