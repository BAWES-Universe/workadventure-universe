import { derived, get, readable, type Readable } from "svelte/store";
import { MapStore } from "@workadventure/store-utils";
import { AvailabilityStatus } from "@workadventure/messages";
import type { TranslationFunctions } from "../../../i18n/i18n-types";
import type {
    AnyKindOfUser,
    ChatMessage,
    ChatMessageContent,
    ChatMessageReaction,
    ChatMessageType,
    ChatUser,
} from "../Connection/ChatConnection";
import type { NoteTranscript } from "../Bots/BotTranscript";
import type { BotReplyLimit } from "../Bots/BotReplyLimit";
import type { BrickCard } from "./Brick";
import { GUEST_BRICK_ID, guestBrickCard, type GuestLine, type GuestMedia } from "./GuestBrick";
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
    /** A picture, file or voice note: drawn by the same bubbles as every chat's. */
    type?: ChatMessageType;
    media?: Partial<ChatMessageContent>;
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
            ...(one.media ?? {}),
        }),
        isMyMessage: one.mine,
        isQuotedMessage: false,
        date: one.at,
        quotedMessage: undefined,
        type: one.type ?? "text",
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

/** The bubble a file is drawn with, from its link and its type, as the nearby chat tells them. */
function bubbleOf(one: GuestMedia): ChatMessageType {
    if (one.kind === "note") return "audio";
    // A picture or file that is gone has nothing to show: its file card says so
    if (one.gone) return "file";
    const ext = one.url.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
    if (one.type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext))
        return "image";
    if (one.type.startsWith("audio/")) return "audio";
    if (one.type.startsWith("video/")) return "video";
    return "file";
}

/**
 * One line of a guest's chat as the messages it is drawn with: its pictures (together when there are several), files and voice
 * note in the same bubbles as every chat, then its words. `transcript` is what is shown for a note being heard right now.
 */
export function guestLineMessages(
    brick: BrickCard,
    line: GuestLine,
    index: number,
    transcript?: NoteTranscript,
    idOf: string = `guest-line:${line.at}:${index}`
): ChatMessage[] {
    const media = line.media ?? [];
    if (media.length === 0) return [guestLineMessage(brick, line, index)];
    const base = { sender: undefined, mine: true, at: new Date(line.at) };
    const id = idOf;
    const messages: ChatMessage[] = [];
    const pictures = media.filter((one) => bubbleOf(one) === "image" && !one.gone);
    if (pictures.length > 1) {
        messages.push(
            localMessage({
                ...base,
                id: `${id}:pictures`,
                text: "",
                type: "gallery",
                media: {
                    url: pictures[0].url,
                    urls: pictures.map((one) => one.url),
                    fileNames: pictures.map((one) => one.name),
                },
            })
        );
    }
    media.forEach((one, at) => {
        if (pictures.length > 1 && bubbleOf(one) === "image" && !one.gone) return;
        const noteTranscript: NoteTranscript | undefined =
            one.kind !== "note"
                ? undefined
                : transcript ??
                  (one.heard
                      ? { state: "heard", text: one.heard }
                      : one.unheard
                      ? { state: "failed", text: undefined }
                      : undefined);
        messages.push(
            localMessage({
                ...base,
                id: `${id}:media:${at}`,
                text: "",
                type: bubbleOf(one),
                media: {
                    url: one.gone ? undefined : one.url,
                    // A file that no longer existed when the chat came along: its bubble says it is gone
                    ...(one.gone ? { mediaGone: true } : {}),
                    filename: one.kind === "note" ? "voice message.ogg" : one.name,
                    ...(one.kind === "note"
                        ? {
                              isVoice: true,
                              voiceDuration: one.duration,
                              voiceWaveform: one.waveform,
                              ...(noteTranscript ? { transcript: noteTranscript } : {}),
                          }
                        : {}),
                },
            })
        );
    });
    if (!line.label && line.text.trim()) messages.push(localMessage({ ...base, id, text: line.text }));
    return messages;
}

/**
 * The messages of a chat with the chat a guest brought along drawn in: the messages that carry it become the lines as they
 * were said, each on its own and each once, then the Brick's welcome in the person's language, once. Other messages are left as they are.
 * Done when the chat is drawn only: the message itself stays one message in the chat.
 */
export function expandGuestChats(
    messages: readonly ChatMessage[],
    ll: TranslationFunctions,
    personName: string | null | undefined
): ChatMessage[] {
    if (!messages.some((message) => message.guestChat?.length)) return messages as ChatMessage[];
    const name = personName?.trim();
    // A chat carried in parts (plan v3 section 7): its lines are named, a line sent twice is drawn once, and the welcome
    // comes once, after its last part here. A chat carried as one message is its own carry
    const carryOf = (message: ChatMessage): string => {
        const id = message.guestChat?.find((line) => line.id)?.id;
        return id ? `carry:${id.slice(0, id.lastIndexOf("."))}` : `message:${message.id}`;
    };
    const lastOf = new Map<string, string>();
    for (const message of messages) {
        if (message.guestChat?.length && !get(message.isDeleted)) lastOf.set(carryOf(message), message.id);
    }
    const drawnLines = new Set<string>();
    const expanded: ChatMessage[] = [];
    for (const message of messages) {
        const lines = message.guestChat;
        // A removed carrier stays one removed message: its lines are not drawn again
        if (!lines?.length || get(message.isDeleted)) {
            expanded.push(message);
            continue;
        }
        const sender = message.sender;
        lines.forEach((line, index) => {
            if (line.id) {
                if (drawnLines.has(line.id)) return;
                drawnLines.add(line.id);
            }
            // A guest's pictures, files and notes are drawn in the same bubbles as every chat's
            if (line.media?.length) {
                const media: GuestMedia[] = line.media.map((one) => ({
                    kind: one.kind,
                    name: one.name,
                    type: one.type,
                    url: one.url ?? "",
                    receipt: "",
                    ...(one.gone ? { gone: true as const } : {}),
                    ...(one.duration !== undefined ? { duration: one.duration } : {}),
                    ...(one.heard ? { heard: one.heard } : {}),
                }));
                const shown: GuestLine = {
                    from: "guest",
                    text: line.text,
                    at: line.at > 0 ? line.at : message.date?.getTime() ?? 0,
                    media,
                    ...(line.label ? { label: true as const } : {}),
                };
                expanded.push(
                    ...guestLineMessages(guestBrickCard(ll, 0), shown, index, undefined, `${message.id}:line:${index}`)
                );
                return;
            }
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
        if (lastOf.get(carryOf(message)) !== message.id) continue;
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

/**
 * The same as `expandGuestChats`, as a store that draws again when a carrier is removed while the chat is open: the
 * lines it brought go with it, and only the removed message stays.
 */
export function drawnGuestChats(
    messages: Readable<readonly ChatMessage[]> | undefined,
    ll: Readable<TranslationFunctions>,
    personName: () => string | null | undefined
): Readable<ChatMessage[]> {
    if (!messages) return readable([]);
    return derived([messages, ll], ([$messages, $ll], set: (value: ChatMessage[]) => void) => {
        const carriers = $messages.filter((message) => message.guestChat?.length);
        if (carriers.length === 0) {
            set($messages as ChatMessage[]);
            return;
        }
        const draw = () => set(expandGuestChats($messages, $ll, personName()));
        let ready = false;
        const stops = carriers.map((carrier) =>
            carrier.isDeleted.subscribe(() => {
                if (ready) draw();
            })
        );
        ready = true;
        draw();
        return () => stops.forEach((stop) => stop());
    });
}
