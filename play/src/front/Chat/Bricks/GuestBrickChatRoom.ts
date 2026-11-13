import { derived, get, writable } from "svelte/store";
import type { Readable } from "svelte/store";
import type { TranslationFunctions } from "../../../i18n/i18n-types";
import type { ChatMessage, ChatRoom } from "../Connection/ChatConnection";
import type { BrickCard } from "./Brick";
import {
    GUEST_BRICK_ID,
    guestBrickCard,
    historyExcept,
    newGuestChat,
    parseGuestAnswer,
    parseGuestChat,
    serializeGuestChat,
    withLine,
    type GuestAnswer,
    type GuestChat,
    type GuestLine,
} from "./GuestBrick";
import { guestBrickSender, guestLineMessage, localMessage } from "./GuestBrickMessages";
import { brickPicture } from "./BrickLookPicture";

/** What a guest's message asks of the bot server (the guest and the room come with the game's own token and place). */
export interface GuestBrickRequest {
    turnId: string;
    roomUrl: string;
    message: string;
    history: { from: "guest" | "brick"; text: string }[];
    saidNeedsAccount: boolean;
}

/** What the chat needs from the game, so it can be tested without one. */
export interface GuestBrickDeps {
    ll: Readable<TranslationFunctions>;
    /** The id the game gives this device as a guest; null when there is none. */
    guestId: () => string | null;
    roomUrl: () => string | null;
    /** Asks the bot server for the answer; whatever it says, `parseGuestAnswer` reads. May throw. */
    ask: (request: GuestBrickRequest) => Promise<unknown>;
    readSaved: () => string | null;
    save: (raw: string) => void;
    drop: () => void;
    now: () => number;
    newTurnId: () => string;
    /** How long a chat is kept on the device after its last line (ms). */
    keepMs: number;
}

/**
 * A guest's chat with the Brick for guests (game #1997): a chat the device keeps for itself. It has no room on any chat
 * server and no members, and nothing about it is written anywhere but this device; each message is sent to the bot
 * server with the lines held here, and the answer is added. The game draws it with the same timeline as every chat.
 */
export class GuestBrickChatRoom implements ChatRoom {
    readonly id = GUEST_BRICK_ID;
    readonly type = "direct" as const;
    readonly isRoomFolder = false;
    readonly isEncrypted: Readable<boolean> = writable(false);
    readonly hasUnreadMessages: Readable<boolean> = writable(false);
    readonly unreadNotificationCount: Readable<number> = writable(0);
    readonly hasPreviousMessage: Readable<boolean> = writable(false);
    readonly isLoadingMessages: Readable<boolean> = writable(false);

    private chat: GuestChat | undefined;
    private readonly shown = writable<ChatMessage[]>([]);
    private readonly typing = writable<
        Array<{ id: string; name: string | null; pictureStore: ReturnType<typeof brickPicture> }>
    >([]);
    private readonly started = writable<number>(0);
    private readonly lastLine = writable<GuestLine | undefined>(undefined);
    private readonly made = new Map<string, ChatMessage>();
    private notes: ChatMessage[] = [];
    /** The lines the guest wrote that have not had their turn yet: one is answered at a time, the others wait. */
    private waiting = new Set<number>();
    private queue: Promise<void> = Promise.resolve();

    readonly messages: Readable<readonly ChatMessage[]> = { subscribe: this.shown.subscribe };
    readonly typingMembers = { subscribe: this.typing.subscribe };
    /** When the chat now held began: what a closed card is remembered by, so a new chat shows its cards again. */
    readonly startedAt: Readable<number> = { subscribe: this.started.subscribe };
    /** The last thing said in it, for the line under its name in Chats. */
    readonly last: Readable<GuestLine | undefined> = { subscribe: this.lastLine.subscribe };
    readonly pictureStore = brickPicture(undefined);
    readonly name: Readable<string>;

    constructor(private readonly deps: GuestBrickDeps) {
        this.name = derived(deps.ll, (ll) => guestBrickCard(ll, 0).name);
        this.refresh();
    }

    /** The Brick as it is drawn here: Universe's own, one for everyone. */
    brick(): BrickCard {
        return guestBrickCard(get(this.deps.ll), 0);
    }

    get lastMessageTimestamp(): number {
        return this.chat?.savedAt ?? 0;
    }

    /** The chat as it stands now, for what needs its cards or its last words. */
    current(): GuestChat | undefined {
        return this.chat;
    }

    /**
     * Reads what the device kept, once it is asked to open: a chat last touched longer ago than the device keeps one is
     * gone, and a chat that is not this guest's is gone too.
     */
    refresh(): void {
        const now = this.deps.now();
        const guestId = this.deps.guestId();
        const held = this.chat;
        if (held && (now - held.savedAt > this.deps.keepMs || (guestId !== null && held.guestId !== guestId))) {
            this.chat = undefined;
            this.waiting.clear();
        }
        if (!this.chat) {
            const raw = this.deps.readSaved();
            this.chat = parseGuestChat(raw, guestId, now, this.deps.keepMs);
            // Kept for someone else, or too old: it does not stay on the device
            if (!this.chat && raw !== null) this.deps.drop();
        }
        this.publish();
    }

    private ensureChat(now: number): GuestChat {
        if (!this.chat) {
            this.chat = newGuestChat(this.deps.guestId() ?? "", now);
            this.waiting.clear();
        }
        return this.chat;
    }

    private persist(): void {
        const chat = this.chat;
        if (!chat?.guestId || chat.lines.length === 0) return;
        this.deps.save(serializeGuestChat(chat));
    }

    private publish(): void {
        const brick = this.brick();
        const lines = this.chat?.lines ?? [];
        const alive = new Set<string>();
        const messages = lines.map((line, index) => {
            const message = guestLineMessage(brick, line, index);
            alive.add(message.id);
            const kept = this.made.get(message.id);
            if (kept) return kept;
            this.made.set(message.id, message);
            return message;
        });
        for (const id of this.made.keys()) if (!alive.has(id)) this.made.delete(id);
        this.started.set(this.chat?.startedAt ?? 0);
        this.lastLine.set(lines[lines.length - 1]);
        this.shown.set([...messages, ...this.notes]);
    }

    private setNotes(notes: ChatMessage[]): void {
        this.notes = notes;
        this.publish();
    }

    /** The game's own line when an answer could not be made, or a reply limit: never kept, never sent as part of the chat. */
    private note(message: ChatMessage): void {
        this.setNotes([message]);
    }

    readonly sendMessage = (message: string): void => {
        const text = message.trim();
        if (!text) return;
        const now = this.deps.now();
        const chat = this.ensureChat(now);
        // Last words from the game's own side are out of the way once the guest writes again
        this.notes = [];
        const line: GuestLine = { from: "guest", text, at: now };
        this.chat = withLine(chat, line);
        const index = this.chat.lines.length - 1;
        const startedAt = this.chat.startedAt;
        this.waiting.add(index);
        this.persist();
        this.publish();
        // One answer at a time: the next waits for this one, and reads the chat as it stands then
        this.queue = this.queue.then(() => this.answer(text, index, startedAt)).catch((error) => console.error(error));
    };

    private async answer(text: string, index: number, startedAt: number): Promise<void> {
        const chat = this.chat;
        if (!chat || chat.startedAt !== startedAt) {
            this.waiting.delete(index);
            return;
        }
        // Its turn: what is read is the chat as it stands now, without this message and the ones still waiting behind it
        this.waiting.delete(index);
        const skip = new Set([...this.waiting, index]);
        const brick = this.brick();
        this.typing.set([
            { id: GUEST_BRICK_ID, name: brick.name, pictureStore: brickPicture(brick.characterTextureId) },
        ]);
        let answer: GuestAnswer = { kind: "failed" };
        try {
            const roomUrl = this.deps.roomUrl();
            if (this.deps.guestId() && roomUrl) {
                answer = parseGuestAnswer(
                    await this.deps.ask({
                        turnId: this.deps.newTurnId(),
                        roomUrl,
                        message: text,
                        history: historyExcept(chat.lines, skip),
                        saidNeedsAccount: chat.saidNeedsAccount,
                    })
                );
            }
        } catch (error) {
            console.warn("The Brick for guests could not answer", error);
        } finally {
            this.typing.set([]);
        }
        // The chat was started again while this was being answered: the answer belongs to the one before
        if (!this.chat || this.chat.startedAt !== startedAt) return;
        const now = this.deps.now();
        if (answer.kind === "reply") {
            // A failure or a limit from an earlier queued turn is out of the way once an answer comes
            this.notes = [];
            this.chat = withLine(this.chat, {
                from: "brick",
                text: answer.text,
                at: now,
                ...(answer.needsAccount ? { needsAccount: true as const } : {}),
            });
            this.persist();
            this.publish();
            return;
        }
        if (answer.kind === "limit") {
            this.note(
                localMessage({
                    id: `guest-limit:${now}`,
                    sender: guestBrickSender(brick),
                    mine: false,
                    text: "",
                    at: new Date(now),
                    replyLimit: {
                        // The guest's own allowance, or the universe's shared pool for guests
                        limit: answer.limit === "guest" ? "guest" : "guests",
                        resetsAt: answer.resetsAt,
                        who: "guest",
                        botId: GUEST_BRICK_ID,
                        botName: brick.name,
                    },
                })
            );
            return;
        }
        this.note(
            localMessage({
                id: `guest-note:${now}`,
                sender: guestBrickSender(brick),
                mine: false,
                text: get(this.deps.ll).chat.brick.guest.couldNotAnswer(),
                at: new Date(now),
            })
        );
    }

    readonly sendFiles = (): Promise<void> => Promise.resolve();
    readonly setTimelineAsRead = (): void => undefined;
    readonly loadMorePreviousMessages = (): Promise<void> => Promise.resolve();
    readonly startTyping = (): Promise<object> => Promise.resolve({});
    readonly stopTyping = (): Promise<object> => Promise.resolve({});
}
