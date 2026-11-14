import { derived, get, writable } from "svelte/store";
import type { Readable, Writable } from "svelte/store";
import type { TranslationFunctions } from "../../../i18n/i18n-types";
import type { ChatMessage, ChatMessageContent, ChatRoom } from "../Connection/ChatConnection";
import type { VoiceNoteDetails } from "../VoiceNote/VoiceNote";
import type { BrickCard } from "./Brick";
import {
    GUEST_BRICK_ID,
    guestBrickCard,
    historyExcept,
    mediaLabel,
    newGuestChat,
    parseGuestAnswer,
    parseGuestChat,
    requestMessage,
    serializeGuestChat,
    withLine,
    type GuestAnswer,
    type GuestChat,
    type GuestLine,
    type GuestMedia,
} from "./GuestBrick";
import { guestBrickSender, guestLineMessages, localMessage } from "./GuestBrickMessages";
import { brickPicture } from "./BrickLookPicture";

/** What a guest's message asks of the bot server (the guest and the room come with the game's own token and place). */
export interface GuestBrickRequest {
    turnId: string;
    roomUrl: string;
    message: string;
    history: { from: "guest" | "brick"; text: string }[];
    saidNeedsAccount: boolean;
    /** The receipts of the files sent with this message. */
    files?: string[];
    /** The receipt of the voice note this message is. */
    note?: string;
}

/** A file the uploader took for this guest, with its receipt. */
export interface GuestUploaded {
    location: string;
    name: string;
    type: string;
    size?: number;
    receipt: string;
}

/** What the Brick for guests takes now: files, and voice notes. */
export interface GuestBrickTakes {
    files: boolean;
    notes: boolean;
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
    /** Sends a file to the uploader for this guest; throws an UploadFailure when it can't. */
    upload?: (file: File) => Promise<GuestUploaded>;
    /** Renews a receipt that ran out (after a long pause), for a file this guest still holds. */
    refreshReceipt?: (receipt: string) => Promise<{ receipt: string; location: string }>;
    /** Tells the bot server this device has the answer of a note, so its kept copy is deleted. */
    delivered?: (delivery: string) => Promise<void>;
    /** What the Brick for guests takes now. */
    takes?: () => Promise<GuestBrickTakes>;
    /** Waits before a retry (ms). */
    sleep?: (ms: number) => Promise<void>;
}

/** A send while files are still uploading joins them: the words and the files are one message to the Brick. */
interface PendingUpload {
    texts: string[];
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
    /** Each message drawn, by its id, with its content: the same message each time, so its bubble is never drawn twice. */
    private readonly made = new Map<string, { message: ChatMessage; content: Writable<ChatMessageContent> }>();
    private notes: ChatMessage[] = [];
    /** The lines the guest wrote that have not had their turn yet: one is answered at a time, the others wait. */
    private waiting = new Set<number>();
    private queue: Promise<void> = Promise.resolve();
    /** The note of this line is being heard now: "Listening…" in its bubble. */
    private listening = new Set<number>();
    private pendingUpload: PendingUpload | undefined;
    private readonly taking = writable<GuestBrickTakes>({ files: false, notes: false });
    /** What the Brick for guests takes now: the paperclip and the mic show only for what it takes. */
    readonly takes: Readable<GuestBrickTakes> = { subscribe: this.taking.subscribe };

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
        this.deps
            .takes?.()
            .then((takes) => this.taking.set(takes))
            .catch(() => this.taking.set({ files: false, notes: false }));
    }

    /** Who a send started for: the guest, and the chat when there was one. */
    private owner(): { guestId: string | null; startedAt: number | undefined } {
        return { guestId: this.deps.guestId(), startedAt: this.chat?.startedAt };
    }

    /** Whether a send that took a while (an upload) still belongs to the chat here: not after sign-out, another guest or a new chat. */
    private stillOwns(owner: { guestId: string | null; startedAt: number | undefined }): boolean {
        if (this.deps.guestId() !== owner.guestId) return false;
        return owner.startedAt === undefined || this.chat?.startedAt === owner.startedAt;
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
        const messages = lines.flatMap((line, index) => {
            const listening = this.listening.has(index);
            return guestLineMessages(brick, line, index, listening ? { state: "listening" } : undefined).map(
                (message) => {
                    alive.add(message.id);
                    // The chat draws a message once by its id and reads its words once: a note's bubble keeps its message,
                    // and what changes in it ("Listening…", then the words heard) changes in its content
                    const kept = this.made.get(message.id);
                    const content = get(message.content);
                    if (kept) {
                        if (JSON.stringify(get(kept.content)) !== JSON.stringify(content)) kept.content.set(content);
                        return kept.message;
                    }
                    const store = writable(content);
                    const made = { ...message, content: { subscribe: store.subscribe } };
                    this.made.set(message.id, { message: made, content: store });
                    return made;
                }
            );
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
        // Files of this send are still uploading: the words go with them, as one message
        if (this.pendingUpload) {
            this.pendingUpload.texts.push(text);
            return;
        }
        this.addGuestLine(text, []);
    };

    /** Adds what the guest sent as one line, and queues its answer. */
    private addGuestLine(text: string, media: GuestMedia[]): void {
        const now = this.deps.now();
        const chat = this.ensureChat(now);
        // Last words from the game's own side are out of the way once the guest writes again
        this.notes = [];
        const line: GuestLine = {
            from: "guest",
            text: text || mediaLabel(media),
            at: now,
            turnId: this.deps.newTurnId(),
            ...(media.length ? { media } : {}),
            ...(media.length && !text ? { label: true as const } : {}),
        };
        this.chat = withLine(chat, line);
        const index = this.chat.lines.length - 1;
        const startedAt = this.chat.startedAt;
        this.waiting.add(index);
        this.persist();
        this.publish();
        // One answer at a time: the next waits for this one, and reads the chat as it stands then
        this.queue = this.queue.then(() => this.answer(index, startedAt)).catch((error) => console.error(error));
    }

    /**
     * Files the guest sends: uploaded with the same limits as every chat, then sent as one message with any words typed with them.
     * When one fails, nothing is sent and the box keeps the files to try again (the words still go on their own).
     */
    readonly sendFiles = async (files: FileList): Promise<void> => {
        const list = [...files];
        const upload = this.deps.upload;
        if (list.length === 0) return;
        const pending: PendingUpload = { texts: [] };
        this.pendingUpload = pending;
        const owner = this.owner();
        let uploaded: PromiseSettledResult<GuestUploaded>[] = [];
        try {
            uploaded = upload
                ? await Promise.allSettled(list.map((file) => upload(file)))
                : [{ status: "rejected", reason: new Error("No uploads here") }];
        } finally {
            if (this.pendingUpload === pending) this.pendingUpload = undefined;
        }
        // The chat was replaced while the files went up (signed out, another guest): none of it is said in the chat there now
        if (!this.stillOwns(owner)) return;
        const text = pending.texts.join("\n");
        const failed = uploaded.find((result): result is PromiseRejectedResult => result.status === "rejected");
        if (failed) {
            if (text) this.addGuestLine(text, []);
            throw failed.reason;
        }
        const media = uploaded.map((result, at): GuestMedia => {
            const one = (result as PromiseFulfilledResult<GuestUploaded>).value;
            return {
                kind: "file",
                name: one.name,
                type: one.type || list[at].type || "application/octet-stream",
                url: one.location,
                receipt: one.receipt,
                ...(one.size !== undefined ? { size: one.size } : {}),
            };
        });
        this.addGuestLine(text, media);
    };

    /** A recorded voice note, sent as the note (never also as a file). Throws when it could not be uploaded: the recorder keeps it. */
    readonly sendVoiceNote = async (file: File, details: VoiceNoteDetails): Promise<void> => {
        if (!this.deps.upload) throw new Error("No uploads here");
        const owner = this.owner();
        const one = await this.deps.upload(file);
        if (!this.stillOwns(owner)) return;
        this.addGuestLine("", [
            {
                kind: "note",
                name: one.name,
                type: one.type || file.type || "audio/ogg",
                url: one.location,
                receipt: one.receipt,
                duration: details.duration,
                waveform: details.waveform,
            },
        ]);
    };

    /**
     * Asks for the answer of a line: the same turn id on every try, and receipts renewed once. A note is asked once more after a
     * lost connection: its answer is kept at Orbit, so the same turn gets it back and is never heard or answered twice.
     */
    private async ask(
        request: GuestBrickRequest,
        index: number,
        startedAt: number,
        tries = { lost: 0, renewed: false, waited: 0 }
    ): Promise<GuestAnswer> {
        let answer: GuestAnswer;
        const sleep = this.deps.sleep ?? waitMs;
        try {
            answer = parseGuestAnswer(await this.deps.ask(request));
        } catch (error) {
            // The answer may have been made and lost: the same turn again gets it back, never a second one
            if (!request.note || tries.lost >= 1) throw error;
            await sleep(1000);
            return this.ask(request, index, startedAt, { ...tries, lost: tries.lost + 1, waited: tries.waited + 1000 });
        }
        // Asked again after a lost connection, the first ask may still be running on the bot server ("busy" for this guest), or
        // the uploader can't be read just now while Orbit still keeps the answer ("not heard: busy"): keep waiting, a little
        // longer each time, up to as long as one answer may take, and the note stays "Listening…" meanwhile
        const notNow = answer.kind === "busy" || (answer.kind === "unheard" && answer.why === "busy");
        if (notNow && tries.lost >= 1 && tries.waited < LOST_ANSWER_WAIT_MS) {
            const delay = Math.min(1000 * 2 ** Math.max(0, tries.lost - 1), 8000);
            await sleep(delay);
            return this.ask(request, index, startedAt, {
                ...tries,
                lost: tries.lost + 1,
                waited: tries.waited + delay,
            });
        }
        if (answer.kind !== "upload" || answer.why !== "expired" || tries.renewed || !this.deps.refreshReceipt) {
            return answer;
        }
        const fresh = await this.renewReceipts(index, startedAt);
        if (!fresh) return { kind: "upload", why: "refused" };
        return this.ask({ ...request, ...fresh }, index, startedAt, { ...tries, renewed: true });
    }

    /** Renews the receipts of a line's files (they ran out while the chat sat): kept on the device for the next try too. */
    private async renewReceipts(
        index: number,
        startedAt: number
    ): Promise<Pick<GuestBrickRequest, "files" | "note"> | undefined> {
        const refresh = this.deps.refreshReceipt;
        const line = this.chat?.lines[index];
        if (!refresh || !line?.media) return undefined;
        try {
            const media = await Promise.all(
                line.media.map(async (one) => {
                    const fresh = await refresh(one.receipt);
                    return { ...one, receipt: fresh.receipt, url: fresh.location };
                })
            );
            if (!this.chat || this.chat.startedAt !== startedAt) return undefined;
            this.updateLine(index, { ...line, media });
            return requestMedia(media);
        } catch {
            return undefined;
        }
    }

    private updateLine(index: number, line: GuestLine): void {
        if (!this.chat) return;
        const lines = [...this.chat.lines];
        lines[index] = line;
        this.chat = { ...this.chat, lines };
        this.persist();
        this.publish();
    }

    /** What happened to a line's note, kept with it: the words heard, or that it could not be heard. */
    private markNote(index: number, heard: string | undefined): void {
        const line = this.chat?.lines[index];
        if (!line?.media?.some((one) => one.kind === "note")) return;
        this.updateLine(index, {
            ...line,
            media: line.media.map((one) => {
                if (one.kind !== "note") return one;
                const rest = { ...one };
                delete rest.heard;
                delete rest.unheard;
                return heard ? { ...rest, heard } : { ...rest, unheard: true as const };
            }),
        });
    }

    private async answer(index: number, startedAt: number): Promise<void> {
        const chat = this.chat;
        if (!chat || chat.startedAt !== startedAt) {
            this.waiting.delete(index);
            return;
        }
        const line = chat.lines[index];
        const text = line && !line.label ? line.text : "";
        const hasNote = !!line?.media?.some((one) => one.kind === "note");
        // Its turn: what is read is the chat as it stands now, without this message and the ones still waiting behind it
        this.waiting.delete(index);
        const skip = new Set([...this.waiting, index]);
        const brick = this.brick();
        this.typing.set([
            { id: GUEST_BRICK_ID, name: brick.name, pictureStore: brickPicture(brick.characterTextureId) },
        ]);
        if (hasNote) {
            this.listening.add(index);
            this.publish();
        }
        let answer: GuestAnswer = { kind: "failed" };
        try {
            const roomUrl = this.deps.roomUrl();
            if (this.deps.guestId() && roomUrl && line) {
                answer = await this.ask(
                    {
                        turnId: line.turnId ?? this.deps.newTurnId(),
                        roomUrl,
                        message: requestMessage(text),
                        history: historyExcept(chat.lines, skip),
                        saidNeedsAccount: chat.saidNeedsAccount,
                        ...requestMedia(line.media ?? []),
                    },
                    index,
                    startedAt
                );
            }
        } catch (error) {
            console.warn("The Brick for guests could not answer", error);
        } finally {
            this.typing.set([]);
            this.listening.delete(index);
        }
        // The chat was started again while this was being answered: the answer belongs to the one before
        if (!this.chat || this.chat.startedAt !== startedAt) return;
        const now = this.deps.now();
        if (hasNote) {
            if (answer.kind === "reply") this.markNote(index, answer.heard);
            else if (answer.kind === "unheard" && (answer.why === "failed" || answer.why === "busy")) {
                // Not heard: the note's own bubble says so, as in every bot's chat, and nothing else is added
                this.markNote(index, undefined);
                return;
            }
            // Too long, unfinished or an answer gone: the note was not the problem, the line below says what was
            else this.publish();
        }
        if (answer.kind === "reply") {
            // The device has the answer of a note: its kept copy at Orbit goes
            if (answer.delivery) this.deps.delivered?.(answer.delivery).catch(() => undefined);
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
                text: this.failureWords(answer),
                at: new Date(now),
            })
        );
    }

    /** The game's own line for an answer that could not be made, in plain words. */
    private failureWords(answer: GuestAnswer): string {
        const words = get(this.deps.ll).chat.brick.guest;
        if (answer.kind === "unheard") {
            if (answer.why === "too-long") {
                return words.noteTooLong({ minutes: Math.max(1, Math.round((answer.longestSeconds ?? 300) / 60)) });
            }
            if (answer.why === "uncertain") return words.couldNotFinish();
            if (answer.why === "expired") return words.answerGone();
            return words.couldNotListen();
        }
        if (answer.kind === "upload") return answer.why === "too-big" ? words.fileTooBig() : words.fileGone();
        return words.couldNotAnswer();
    }

    readonly setTimelineAsRead = (): void => undefined;
    readonly loadMorePreviousMessages = (): Promise<void> => Promise.resolve();
    readonly startTyping = (): Promise<object> => Promise.resolve({});
    readonly stopTyping = (): Promise<object> => Promise.resolve({});
}

/** What a request names of a line's media: its files' receipts, or its note's. */
function requestMedia(media: readonly GuestMedia[]): Pick<GuestBrickRequest, "files" | "note"> {
    const note = media.find((one) => one.kind === "note");
    if (note) return { note: note.receipt };
    const files = media.filter((one) => one.kind === "file").map((one) => one.receipt);
    return files.length ? { files } : {};
}

/** How long a note asked again after a lost connection waits for the first ask to finish: as long as the device waits for one answer. */
const LOST_ANSWER_WAIT_MS = 130_000;

function waitMs(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
