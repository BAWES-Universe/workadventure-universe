import { readable } from "svelte/store";
import type { ChatMessage } from "../../../Connection/ChatConnection";
import type { ProximitySession } from "../../../Connection/Proximity/ProximitySessions";
import { ROOM_MESSAGES_SESSION_ID } from "../../../Connection/Proximity/ProximitySessions";
import type { PictureStore } from "../../../../Stores/PictureStore";

export interface ConversationPerson {
    id: string;
    name: string;
    pictureStore: PictureStore;
    /** Their chat account, for their colour from People. */
    chatId?: string;
}

/** A proximity chat that ended, as its details show it (#1615): who you were with and when it ended. */
export interface EndedConversation {
    /** The area's name, else the people's names as `names` puts them. */
    title: string;
    people: ConversationPerson[];
    endedAt: number | undefined;
    isArea: boolean;
}

/**
 * The conversation a proximity chat's details are about when it shows one that ended. Nothing for the live one, the
 * room messages, or the whole timeline: those keep the chat's own header.
 */
export function endedConversation(
    session: ProximitySession<ChatMessage> | undefined,
    names: (people: string[]) => string
): EndedConversation | undefined {
    if (!session || session.isLive || session.id === ROOM_MESSAGES_SESSION_ID) return undefined;
    const people = session.participants
        .map((name, index): ConversationPerson => {
            // Their woka and chat account from what they wrote, when they wrote something.
            const sender = session.messages.find(
                (message) => !message.isMyMessage && message.sender?.username === name
            )?.sender;
            const pictureStore =
                sender && "pictureStore" in sender && sender.pictureStore
                    ? sender.pictureStore
                    : readable<string | undefined>(undefined);
            return {
                id: session.participantIds[index] || name,
                name,
                pictureStore,
                chatId: sender?.chatId || undefined,
            };
        })
        .filter((person) => person.name.trim() !== "");
    return {
        title: (session.isArea && session.label) || names(people.map((person) => person.name)),
        people,
        endedAt: session.endedAt,
        isArea: session.isArea,
    };
}
