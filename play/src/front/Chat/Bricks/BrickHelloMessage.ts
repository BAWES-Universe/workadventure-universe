import { readable } from "svelte/store";
import { MapStore } from "@workadventure/store-utils";
import { AvailabilityStatus } from "@workadventure/messages";
import type { ChatMessage, ChatMessageReaction, ChatUser } from "../Connection/ChatConnection";
import type { BrickCard } from "./Brick";
import { brickPicture } from "./MyBricksStore";

/**
 * A Brick's hello as a message of its chat (game #1995), so it is drawn exactly as its other messages are. It exists on
 * this screen only: nothing was sent, so there is nothing to reply to, react to, pin or delete.
 */
export function brickHelloMessage(
    roomId: string,
    brick: BrickCard,
    chatId: string,
    text: string,
    at: Date
): ChatMessage {
    const sender: ChatUser = {
        chatId,
        uuid: undefined,
        availabilityStatus: readable(AvailabilityStatus.ONLINE),
        username: brick.name,
        pictureStore: brickPicture(brick.characterTextureId),
        roomName: undefined,
        playUri: undefined,
        isBot: true,
        color: undefined,
        spaceUserId: undefined,
    };
    return {
        id: `brick-hello:${roomId}`,
        sender,
        content: readable({ body: text, url: undefined, urls: undefined, filename: undefined, fileNames: undefined }),
        isMyMessage: false,
        isQuotedMessage: false,
        date: at,
        quotedMessage: undefined,
        type: "text",
        reactions: new MapStore<string, ChatMessageReaction>(),
        remove: () => undefined,
        edit: () => Promise.resolve(),
        isDeleted: readable(false),
        isModified: readable(false),
        addReaction: () => Promise.resolve(),
        canDelete: readable(false),
        canReact: readable(false),
        canReply: readable(false),
    };
}
