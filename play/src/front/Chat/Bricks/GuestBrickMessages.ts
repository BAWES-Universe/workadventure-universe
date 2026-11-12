import { readable } from "svelte/store";
import { MapStore } from "@workadventure/store-utils";
import { AvailabilityStatus } from "@workadventure/messages";
import type { TranslationFunctions } from "../../../i18n/i18n-types";
import type { AnyKindOfUser, ChatMessage, ChatMessageReaction, ChatUser } from "../Connection/ChatConnection";
import type { BotReplyLimit } from "../Bots/BotReplyLimit";
import type { BrickCard } from "./Brick";
import { GUEST_BRICK_ID, type GuestLine } from "./GuestBrick";
import { brickPicture } from "./BrickLookPicture";

/**
 * The messages of the Brick for guests (game #1997), and of the chat a guest brings along when they sign in. They are
 * drawn by the game from what this device holds: nothing was sent to a chat server, so there is nothing to react to,
 * reply to, edit, pin or delete (`local`).
 */

/** The Brick as a person in a chat: its own name and picture, never a chat address. */
export function guestBrickSender(brick: BrickCard, chatId: string = GUEST_BRICK_ID): ChatUser {
    return {
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
}

interface LocalMessage {
    id: string;
    /** The one who said it: undefined for the person's own words. */
    sender: AnyKindOfUser | undefined;
    mine: boolean;
    text: string;
    at: Date | null;
    replyLimit?: BotReplyLimit;
    guestKeep?: boolean;
}

/** A message of the chat as this device draws it. */
export function localMessage(one: LocalMessage): ChatMessage {
    return {
        id: one.id,
        sender: one.sender,
        content: readable({
            body: one.text,
            url: undefined,
            urls: undefined,
            filename: undefined,
            fileNames: undefined,
        }),
        isMyMessage: one.mine,
        isQuotedMessage: false,
        date: one.at,
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
        local: true,
        ...(one.replyLimit ? { replyLimit: one.replyLimit } : {}),
        ...(one.guestKeep ? { guestKeep: true } : {}),
    };
}

/** One line of a guest's chat, as a message: `index` keeps its id the same each time it is drawn. */
export function guestLineMessage(brick: BrickCard, line: GuestLine, index: number): ChatMessage {
    return localMessage({
        id: `guest-line:${line.at}:${index}`,
        sender: line.from === "brick" ? guestBrickSender(brick) : undefined,
        mine: line.from === "guest",
        text: line.text,
        at: new Date(line.at),
        guestKeep: line.needsAccount === true,
    });
}

/**
 * The messages of a chat with the chat a guest brought along drawn in: the one message that carries it becomes the lines
 * as they were said, each on its own, then the Brick's welcome in the person's language. Other messages are left as they are.
 * Done when the chat is drawn only: the message itself stays one message in the chat.
 */
export function expandGuestChats(
    messages: readonly ChatMessage[],
    ll: TranslationFunctions,
    personName: string | null | undefined
): ChatMessage[] {
    if (!messages.some((message) => message.guestChat?.length)) return messages as ChatMessage[];
    const name = personName?.trim();
    const expanded: ChatMessage[] = [];
    for (const message of messages) {
        const lines = message.guestChat;
        if (!lines?.length) {
            expanded.push(message);
            continue;
        }
        const sender = message.sender;
        lines.forEach((line, index) => {
            expanded.push(
                localMessage({
                    id: `${message.id}:line:${index}`,
                    sender: line.from === "brick" ? sender : undefined,
                    mine: line.from === "guest",
                    text: line.text,
                    at: line.at > 0 ? new Date(line.at) : message.date,
                })
            );
        });
        expanded.push(
            localMessage({
                id: `${message.id}:welcome`,
                sender,
                mine: false,
                text: name ? ll.chat.brick.guest.welcome({ name }) : ll.chat.brick.guest.welcomeNoName(),
                at: message.date,
            })
        );
    }
    return expanded;
}
