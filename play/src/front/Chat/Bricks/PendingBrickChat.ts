import { get, readable, writable } from "svelte/store";
import type { Readable, Writable } from "svelte/store";
import type { ChatMessage, ChatRoom, memberTypingInformation } from "../Connection/ChatConnection";
import type { PictureStore } from "../../Stores/PictureStore";
import type { BrickCard } from "./Brick";
import { brickPicture } from "./BrickLookPicture";
import { localMessage } from "./GuestBrickMessages";

/**
 * The chat screen of a Brick whose chat is still being made (the Brick's row was tapped, or New Brick was pressed). It is
 * the Brick's own from the first moment (its name, picture, hello and start card) and holds what the person writes while
 * the real chat is set up behind it. Nothing in it is a chat on the chat server: when the real chat is there, what was
 * written goes into it, one message at a time and in order, and the screen is the real chat's.
 *
 * A message shows faded until the chat server has it. When the setup fails, or takes longer than the wait below, the person
 * stays on this screen: the faded words go back into the message box, nothing is lost, and the chats are said to be
 * still loading. Writing again tries once more.
 */

export const PENDING_BRICK_ID_PREFIX = "pending-brick:";

/** How long the chat may take to be made before the person is told, and their words go back into the message box. */
export const SETUP_WAIT_MS = 15_000;

/** What the person said while the chat was being made: their own words, with the starter that was tapped when it was one. */
export interface PendingSend {
    words: string;
    starter?: string;
}

interface Line {
    id: string;
    send: PendingSend;
    at: Date;
    sent: boolean;
}

export interface PendingBrickDeps {
    now: () => number;
    setTimer: (run: () => void, ms: number) => unknown;
    clearTimer: (timer: unknown) => void;
    /** Says the chats are still loading, so the person tries again in a moment. */
    sayStillLoading: () => void;
    /** Whether this screen is the one the person is looking at. */
    isShown: () => boolean;
    /** Asks for the chat to be made again: the person wrote something after a failed try. */
    retry: () => void;
}

/** What handing over to the real chat needs from the game. */
export interface PendingHandOver {
    /** Sends one message to the real chat and answers once the chat server has it; rejects when it did not. */
    send: (send: PendingSend) => Promise<void>;
    /** Whatever the person had typed in the message box and not sent yet goes to the real chat's box. */
    carry: (typed: string) => void | Promise<void>;
    /** Shows the real chat. */
    showReal: () => void;
}

/** How a hand-over ended: on the real chat, left behind (the person was elsewhere), or still here (nothing was sent yet). */
export type HandOverResult = "switched" | "left" | "stayed" | "failed";

export class PendingBrickChatRoom implements ChatRoom {
    readonly id: string;
    readonly type = "direct" as const;
    readonly isRoomFolder = false;
    readonly isEncrypted: Readable<boolean> = readable(false);
    readonly hasUnreadMessages: Readable<boolean> = readable(false);
    readonly unreadNotificationCount: Readable<number> = readable(0);
    readonly hasPreviousMessage: Readable<boolean> = readable(false);
    readonly isLoadingMessages: Readable<boolean> = readable(false);
    readonly typingMembers: Readable<memberTypingInformation[]> = readable([]);
    readonly pictureStore: PictureStore;
    readonly name: Readable<string>;
    readonly lastMessageTimestamp = 0;

    private readonly lines: Writable<Line[]> = writable([]);
    private readonly shownMessages: Writable<ChatMessage[]> = writable([]);
    private readonly made = new Map<string, { message: ChatMessage; sending: Writable<boolean> }>();
    private readonly back: Writable<string | undefined> = writable(undefined);
    private count = 0;
    private phase: "waiting" | "failed" | "flushing" | "done" = "waiting";
    private timer: unknown;
    private flushing: Promise<HandOverResult> | undefined;

    /** What the person typed in the message box and has not sent: read when the real chat takes over. Set by the screen. */
    private carryText: (() => string) | undefined;

    readonly messages: Readable<readonly ChatMessage[]> = { subscribe: this.shownMessages.subscribe };
    /** Words that go back into the message box, once (a store the screen reads and clears). */
    readonly textBack: Readable<string | undefined> = { subscribe: this.back.subscribe };

    constructor(readonly card: Readable<BrickCard>, private readonly deps: PendingBrickDeps) {
        const first = get(card);
        this.id = `${PENDING_BRICK_ID_PREFIX}${first.id}`;
        this.pictureStore = brickPicture(first.characterTextureId);
        this.name = {
            subscribe: (run) => {
                let last: string | undefined;
                return card.subscribe((value) => {
                    if (value.name === last) return;
                    last = value.name;
                    run(value.name);
                });
            },
        };
    }

    get brick(): BrickCard {
        return get(this.card);
    }

    /** Whether the setup has been given up on (the wait ran out or it failed), so writing starts it again. */
    get failed(): boolean {
        return this.phase === "failed";
    }

    /** The words not sent yet, in the order they were written. */
    unsentWords(): string[] {
        return get(this.lines)
            .filter((line) => !line.sent)
            .map((line) => line.send.words);
    }

    /** What was typed in the message box when the screen was left: it comes back when the screen is shown again, or goes to the real chat. */
    private leftTyped = "";

    /** The screen says how to read what is typed in its message box. */
    readTypedFrom(read: () => string): void {
        this.carryText = read;
    }

    /** The screen was left (or closed): what is typed and not sent is kept here, so it is not lost with the screen. */
    screenLeft(): void {
        const typed = this.carryText?.() ?? "";
        this.carryText = undefined;
        if (hasWords(typed)) this.leftTyped = typed;
    }

    /** Takes what was kept when the screen was left: the screen shown again puts it back into its message box. */
    takeLeftTyped(): string {
        const typed = this.leftTyped;
        this.leftTyped = "";
        return typed;
    }

    /** The setup starts (or starts again): the wait runs from now. */
    begin(): void {
        if (this.phase === "flushing" || this.phase === "done") return;
        this.deps.clearTimer(this.timer);
        this.phase = "waiting";
        this.timer = this.deps.setTimer(() => this.setupFailed(), SETUP_WAIT_MS);
    }

    /**
     * The chat could not be made in time, or at all. What was written and is not sent goes back into the message box, and the
     * chats are said to be still loading (once per try). Nothing is sent from here.
     */
    setupFailed(): void {
        if (this.phase !== "waiting") return;
        this.deps.clearTimer(this.timer);
        this.timer = undefined;
        this.phase = "failed";
        const returned = this.takeUnsent();
        if (returned.length > 0 || this.deps.isShown()) this.deps.sayStillLoading();
    }

    readonly sendMessage = (message: string): void => {
        this.add({ words: message });
    };

    /** A tap on one of the Brick's ways to start: the words go as the person's own, marked as that starter. */
    sendStarter(words: string, starter: string): void {
        this.add({ words, starter });
    }

    private add(send: PendingSend): void {
        const words = send.words.trim();
        if (!words) return;
        this.count++;
        const line: Line = {
            id: `pending-line:${this.id}:${this.count}`,
            send: { ...send, words },
            at: new Date(this.deps.now()),
            sent: false,
        };
        this.lines.update((lines) => [...lines, line]);
        this.publish();
        // Written after a failed try: the setup starts again, and these words go when it is done
        if (this.phase === "failed") {
            this.begin();
            this.deps.retry();
        }
    }

    /** Takes the words not sent yet out of the screen and puts them back into the message box. */
    private takeUnsent(): string[] {
        const unsent = get(this.lines).filter((line) => !line.sent);
        if (unsent.length === 0) return [];
        this.lines.update((lines) => lines.filter((line) => line.sent));
        this.publish();
        const words = unsent.map((line) => line.send.words);
        this.back.update((held) => (held ? `${held}\n${words.join("\n")}` : words.join("\n")));
        return words;
    }

    /** The screen has put the words back into the box. */
    clearTextBack(): void {
        this.back.set(undefined);
    }

    private publish(): void {
        const alive = new Set<string>();
        const messages = get(this.lines).map((line) => {
            alive.add(line.id);
            let kept = this.made.get(line.id);
            if (!kept) {
                const sending = writable(!line.sent);
                kept = {
                    message: {
                        ...localMessage({
                            id: line.id,
                            sender: undefined,
                            mine: true,
                            text: line.send.words,
                            at: line.at,
                        }),
                        sending: { subscribe: sending.subscribe },
                    },
                    sending,
                };
                this.made.set(line.id, kept);
            } else if (get(kept.sending) === line.sent) {
                kept.sending.set(!line.sent);
            }
            return kept.message;
        });
        for (const id of this.made.keys()) if (!alive.has(id)) this.made.delete(id);
        this.shownMessages.set(messages);
    }

    /**
     * The real chat is there. What was written goes into it, each message once and in order, the next one only after the
     * chat server has the one before; a message turns normal as soon as it is confirmed. When all went, the person is on the
     * real chat (if they were looking at this screen). When one did not, the words not sent go back into the box and the
     * person stays here. A chat that turns up after the wait ran out takes the screen's place too, unless the box holds words.
     */
    handOver(into: PendingHandOver): Promise<HandOverResult> {
        if (this.flushing) return this.flushing;
        this.deps.clearTimer(this.timer);
        this.timer = undefined;
        const wasFailed = this.phase === "failed";
        this.phase = "flushing";
        const run = (async (): Promise<HandOverResult> => {
            let sentAny = false;
            // One at a time, each after the chat server took the one before: the wait is the point.
            /* eslint-disable no-await-in-loop */
            for (;;) {
                const next = get(this.lines).find((line) => !line.sent);
                if (!next) break;
                try {
                    await into.send(next.send);
                } catch (error) {
                    console.warn("Could not send what was written while the chat was made", error);
                    this.phase = "failed";
                    this.takeUnsent();
                    this.deps.sayStillLoading();
                    return "failed";
                }
                next.sent = true;
                sentAny = true;
                this.publish();
            }
            /* eslint-enable no-await-in-loop */
            // Gave up on before and nothing was written since: when the person's box holds words (the ones given back), they
            // stay as they are. An empty box has nothing to lose, so the chat that turned up late takes the screen's place.
            if (wasFailed && !sentAny && hasWords(this.carryText?.() ?? "")) {
                this.phase = "failed";
                return "stayed";
            }
            this.phase = "done";
            if (!this.deps.isShown()) {
                // The person is elsewhere: what they left typed here goes to the real chat's message box
                const kept = this.takeLeftTyped();
                if (hasWords(kept)) await into.carry(kept);
                return "left";
            }
            await into.carry(this.carryText?.() ?? "");
            // Carrying takes a moment: the person may have gone elsewhere meanwhile, and the chat does not take their place
            if (!this.deps.isShown()) return "left";
            into.showReal();
            return "switched";
        })().finally(() => {
            this.flushing = undefined;
        });
        this.flushing = run;
        return run;
    }

    readonly sendFiles = (): Promise<void> => Promise.resolve();
    readonly setTimelineAsRead = (): void => undefined;
    readonly loadMorePreviousMessages = (): Promise<void> => Promise.resolve();
    readonly startTyping = (): Promise<object> => Promise.resolve({});
    readonly stopTyping = (): Promise<object> => Promise.resolve({});
}

/** Whether what is typed in the message box (as the box holds it, with line breaks) says anything. */
function hasWords(typed: string): boolean {
    return typed.replace(/<br\s*\/?>/gi, "").trim() !== "";
}

export function isPendingBrickChat(room: ChatRoom | undefined): room is PendingBrickChatRoom {
    return room instanceof PendingBrickChatRoom;
}
