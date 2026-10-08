import { MapStore } from "@workadventure/store-utils";
import type { Writable } from "svelte/store";
import { writable } from "svelte/store";
import type { SpaceMessageQuote } from "@workadventure/messages";
import type { AnyKindOfUser, ChatMessage, ChatMessageContent, ChatMessageReaction, ChatUser } from "../ChatConnection";

/** Longest quoted text a reply carries: enough for the two lines a quote shows. */
export const QUOTE_MAX_LENGTH = 280;
/** More distinct emoji than this on one nearby message are ignored, so a flood can't grow the message forever. */
export const MAX_REACTIONS_PER_MESSAGE = 24;

const SHARED_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Whether an id received with a nearby message can be used as its shared id. Senders use a uuid; anything else
 * (a bot or an older game that sends none, or garbage) gets a local id, and the message then takes no reactions.
 */
export function isUsableSharedId(id: string | undefined | null): id is string {
    return typeof id === "string" && SHARED_ID_PATTERN.test(id);
}

/** Whether a received reaction key looks like one emoji (possibly with skin tone or joiners), not arbitrary text. */
export function isUsableReaction(reaction: string | undefined | null): reaction is string {
    if (typeof reaction !== "string" || reaction.length === 0 || reaction.length > 32) return false;
    return /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(reaction) && !/[\p{L}\s<>]/u.test(reaction);
}

/**
 * One emoji on a nearby chat message and who reacted with it. Reacting goes through the room, which sends it to the
 * others and applies it here.
 */
export class ProximityChatMessageReaction implements ChatMessageReaction {
    readonly users = new MapStore<string, ChatUser>();
    readonly reacted: Writable<boolean> = writable(false);

    constructor(public readonly key: string, private readonly toggleMine: (key: string) => void) {}

    react(): void {
        this.toggleMine(this.key);
    }
}

/**
 * Adds or removes one person's reaction on a message. Returns false when nothing changed (already there, not there,
 * or the message already has too many different emoji).
 */
export function applyReaction(
    reactions: MapStore<string, ChatMessageReaction>,
    key: string,
    userId: string,
    user: AnyKindOfUser,
    add: boolean,
    isMe: boolean,
    toggleMine: (key: string) => void
): boolean {
    const existing = reactions.get(key);
    if (add) {
        if (existing?.users.has(userId)) return false;
        if (!existing && reactions.size >= MAX_REACTIONS_PER_MESSAGE) return false;
        const reaction =
            existing instanceof ProximityChatMessageReaction
                ? existing
                : new ProximityChatMessageReaction(key, toggleMine);
        reaction.users.set(userId, { ...user, chatId: user.chatId ?? userId });
        if (isMe) reaction.reacted.set(true);
        // Set again so the message redraws its chips.
        reactions.set(key, reaction);
        return true;
    }
    if (!existing || !existing.users.has(userId)) return false;
    existing.users.delete(userId);
    if (isMe && existing instanceof ProximityChatMessageReaction) existing.reacted.set(false);
    if (existing.users.size === 0) {
        reactions.delete(key);
    } else {
        reactions.set(key, existing);
    }
    return true;
}

/** What a reply sends about the message it quotes, shortened, so people who never got the original still see it. */
export function buildQuote(message: ChatMessage, content: ChatMessageContent): SpaceMessageQuote {
    const body = content.body ?? "";
    return {
        id: message.id,
        senderUserId: message.sender?.spaceUserId,
        name: message.sender?.username,
        message: body.length > QUOTE_MAX_LENGTH ? body.slice(0, QUOTE_MAX_LENGTH - 1) + "…" : body,
        url: content.url,
        galleryUrls: content.urls ?? [],
        fileName: content.filename,
        fileNames: content.fileNames ?? [],
    };
}

/** The content a received quote describes, with its text kept short whatever the sender sent. */
export function quoteContent(quote: SpaceMessageQuote): ChatMessageContent {
    const body = quote.message ?? "";
    return {
        body: body.length > QUOTE_MAX_LENGTH ? body.slice(0, QUOTE_MAX_LENGTH - 1) + "…" : body,
        url: quote.url ?? undefined,
        urls: quote.galleryUrls && quote.galleryUrls.length > 0 ? quote.galleryUrls : undefined,
        filename: quote.fileName ?? undefined,
        fileNames: quote.fileNames && quote.fileNames.length > 0 ? quote.fileNames : undefined,
    };
}
