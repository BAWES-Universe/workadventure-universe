import * as Sentry from "@sentry/svelte";
import { derived, get, readable, writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { localUserStore } from "../../Connection/LocalUserStore";
import { botApiService } from "../../external-modules/bots/services/BotApiService";
import { LL } from "../../../i18n/i18n-svelte";
import { gameManager } from "../../Phaser/Game/GameManager";
import { warningMessageStore } from "../../Stores/ErrorStore";
import { userIsConnected } from "../../Stores/MenuStore";
import type { ChatConnectionInterface, ChatRoom, RoomFolder } from "../Connection/ChatConnection";
import { selectedRoomStore } from "../Stores/SelectRoomStore";
import { openDirectChatRoom, showRoom } from "../Utils";
import { withoutBlankEdges } from "../Components/Room/BlankEdges";
import { wordsAsComposerHtml } from "../Components/Room/ComposerWords";
import { openBrickChatWith, unopenedBrickIds, type BrickCard, type MakeItMemory } from "./Brick";
import { GUEST_BRICK_ID } from "./GuestBrick";
import { openGuestBrickChat } from "./GuestBrickStore";
import { myBricksByChatId, myBricksStore } from "./MyBricksStore";
import { PendingBrickChatRoom, type PendingSend } from "./PendingBrickChat";

/** The Bricks whose chat is being opened right now, so their row can say so and a second tap does nothing more. */
const opening = writable<ReadonlySet<string>>(new Set());
export const openingBrickChats: Readable<ReadonlySet<string>> = { subscribe: opening.subscribe };

const running = new Map<string, Promise<ChatRoom | undefined>>();
const makeIt: MakeItMemory = new Map();

/** The Bricks whose chat this device has shown, until the chat server's own list of direct chats says so (it follows a moment later). */
const shown = writable<ReadonlySet<string>>(new Set());

function markOpened(brickId: string): void {
    if (!get(shown).has(brickId)) shown.update((ids) => new Set([...ids, brickId]));
}

/**
 * The Bricks the person never opened, by Brick id (see unopenedBrickIds): each is one unread message, counted the same in
 * the Brick's row, on the Chats tab and on the chat button, and the same on every device.
 */
export function unopenedBricksOf(connection: ChatConnectionInterface): Readable<ReadonlySet<string>> {
    return derived(
        [
            myBricksStore,
            myBricksByChatId,
            connection.connectionStatus,
            connection.directChatPartners ?? readable(undefined),
            opening,
            shown,
        ],
        ([$bricks, $byChatId, $status, $partners, $opening, $shown]) =>
            unopenedBrickIds({
                bricks: $bricks ? $byChatId : undefined,
                partners: $partners,
                online: $status === "ONLINE",
                opening: $opening,
                openedHere: $shown,
            })
    );
}

/** How many Bricks the person never opened: the number the chat button and the Chats tab add to the unread messages. */
export function unopenedBrickCountOf(connection: ChatConnectionInterface): Readable<number> {
    return derived(unopenedBricksOf(connection), ($ids) => $ids.size);
}

/** The screens of Bricks whose chat is still being made, by Brick id: each holds what the person writes meanwhile. */
const pendings = new Map<string, PendingBrickChatRoom>();

/** Words left typed on a screen that was dropped before its chat was there, by Brick id: they go to the chat when it is shown. */
const strays = new Map<string, string>();

function makePending(brickId: string): PendingBrickChatRoom | undefined {
    const first = (get(myBricksStore) ?? []).find((brick) => brick.id === brickId);
    if (!first) return undefined;
    const card: Readable<BrickCard> = derived(
        myBricksStore,
        ($bricks) => $bricks?.find((brick) => brick.id === brickId) ?? first
    );
    const holder: { room?: PendingBrickChatRoom } = {};
    const room = new PendingBrickChatRoom(card, {
        now: () => Date.now(),
        setTimer: (run, ms) => setTimeout(run, ms),
        clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
        sayStillLoading: () => warningMessageStore.addWarningMessage(get(LL).chat.chatsStillLoading()),
        isShown: () => get(selectedRoomStore) === holder.room,
        retry: () => {
            openBrickChat(brickId).catch((error) => console.error(error));
        },
    });
    holder.room = room;
    return room;
}

/** Opens the Brick's own screen at once, while its chat is made behind it. Only for someone signed in, and for a Brick that is listed. */
function showPending(brickId: string): void {
    if (!get(userIsConnected)) return;
    const pending = pendings.get(brickId) ?? makePending(brickId);
    if (!pending) return;
    pendings.set(brickId, pending);
    // What the person left typed on an earlier screen of this chat comes back in this one's message box
    const stray = strays.get(brickId);
    if (stray) {
        strays.delete(brickId);
        pending.keepTyped(stray);
    }
    pending.begin();
    showRoom(pending);
}

/** The room takes the words in a chat the person wrote, and answers once the chat server has them. */
type ConfirmingRoom = Partial<{
    sendMessageConfirmed: (message: string) => Promise<void>;
    sendStarter: (message: string, starter: string) => Promise<void>;
}>;

function sendConfirmed(room: ChatRoom, send: PendingSend): Promise<void> {
    const confirming = room as ConfirmingRoom;
    if (send.starter && confirming.sendStarter) return confirming.sendStarter(send.words, send.starter);
    if (confirming.sendMessageConfirmed) return confirming.sendMessageConfirmed(send.words);
    return Promise.reject(new Error("This chat cannot say when a message reached the chat server"));
}

/** What the person had typed on the screen of the chat being made goes to the real chat's message box. */
async function carryTyped(room: ChatRoom, typed: string): Promise<void> {
    if (typed.replace(/<br>/g, "").trim() === "") return;
    const { draftMessageService } = await import("../Services/DraftMessageService");
    const chatId = localUserStore.getChatId();
    draftMessageService.saveDraft({
        id: `${room.id}-${chatId ?? "0"}`,
        roomId: room.id,
        userId: chatId,
        message: typed,
    });
}

/**
 * Shows the chat with a Brick once it is there. When the Brick's own screen was open for it, what the person wrote
 * meanwhile goes into the chat first, one message at a time and in order, and the chat takes the screen's place only if the
 * person is still looking at it.
 */
async function reveal(brickId: string, room: ChatRoom): Promise<void> {
    const pending = pendings.get(brickId);
    if (!pending) {
        markOpened(brickId);
        const kept = strays.get(brickId);
        if (kept) {
            strays.delete(brickId);
            await carryTyped(room, kept).catch((error: unknown) => console.error(error));
        }
        showRoom(room);
        return;
    }
    const result = await pending.handOver({
        send: (send) => sendConfirmed(room, send),
        carry: (typed) => carryTyped(room, typed),
        showReal: () => showRoom(room),
    });
    // Counted as opened once the person has had the chat: not while they are left on the screen of the chat being made
    if (result === "switched" || result === "left") {
        markOpened(brickId);
        pendings.delete(brickId);
    }
}

/** Whether a folder, or a folder inside one, holds a room with that id. Each folder is read once, so a folder that holds itself ends. */
function inFolders(folders: readonly RoomFolder[], roomId: string, seen: Set<string> = new Set()): boolean {
    return folders.some((folder) => {
        if (seen.has(folder.id)) return false;
        seen.add(folder.id);
        return get(folder.rooms).some((room) => room.id === roomId) || inFolders(get(folder.folders), roomId, seen);
    });
}

function listed(connection: ChatConnectionInterface, roomId: string): boolean {
    return (
        get(connection.directRooms).some((room) => room.id === roomId) ||
        get(connection.rooms).some((room) => room.id === roomId) ||
        inFolders(get(connection.folders), roomId)
    );
}

/** Opens the chat with one of the person's own Bricks: the one chat they have, on every device (see openBrickChatWith). */
export function openBrickChat(brickId: string): Promise<ChatRoom | undefined> {
    // The Brick for guests has no chat on any server: its chat is the one this device keeps
    if (brickId === GUEST_BRICK_ID) return Promise.resolve(openGuestBrickChat());
    const already = running.get(brickId);
    if (already) {
        // Tapped again while its chat is made: the screen that holds the person's words is shown again
        const pending = pendings.get(brickId);
        if (pending) showRoom(pending);
        return already;
    }
    // A screen left behind by an earlier try (the person went elsewhere) is not this tap's: it would take the chat for
    // one the person left on purpose and show nothing
    const left = pendings.get(brickId);
    if (left && get(selectedRoomStore) !== left) {
        pendings.delete(brickId);
        // What they wrote on it and what they left typed go to the chat when it is shown: the lines first, as written, then
        // the typed words. Lines the setup gave back (nobody was there to read them) are part of it, or they are lost.
        const words = left.takeUnsentWords();
        const kept = [
            strays.get(brickId) ?? "",
            wordsAsComposerHtml(words.join("\n")),
            withoutBlankEdges(left.takeLeftTyped()),
        ].filter((part) => part !== "");
        if (kept.length > 0) strays.set(brickId, kept.join("<br>"));
    }
    opening.update((ids) => new Set([...ids, brickId]));
    const run = (async () => {
        const connection = await gameManager.getChatConnection();
        return openBrickChatWith<ChatRoom>(
            brickId,
            {
                myChatId: localUserStore.getChatId(),
                ask: (id, myChatId) => botApiService.askDirectChat(id, myChatId),
                hasChatWith: (chatId) => connection.getDirectRoomFor(chatId) !== undefined,
                hasRoom: (roomId) => listed(connection, roomId),
                openChatWith: (chatId) =>
                    openDirectChatRoom(chatId, {
                        show: (room) => reveal(brickId, room),
                        onFailure: pendings.has(brickId) ? () => pendings.get(brickId)?.setupFailed() : undefined,
                    }),
                openRoom: async (roomId) => {
                    try {
                        const room = connection.getRoomByID(roomId);
                        await reveal(brickId, room);
                        return room;
                    } catch (error) {
                        console.error(error);
                        Sentry.captureException(error);
                        const pending = pendings.get(brickId);
                        if (pending) pending.setupFailed();
                        else warningMessageStore.addWarningMessage(get(LL).chat.failedToOpenRoom({ roomId }));
                        return undefined;
                    }
                },
                sayStillLoading: () => {
                    const pending = pendings.get(brickId);
                    if (pending) pending.setupFailed();
                    else warningMessageStore.addWarningMessage(get(LL).chat.chatsStillLoading());
                },
                showPending: () => showPending(brickId),
                sleep: (ms) =>
                    new Promise((resolve) => {
                        setTimeout(resolve, ms);
                    }),
                now: () => Date.now(),
            },
            makeIt
        );
    })()
        .then((room) => {
            // No chat in the end: the screen held for it says so and gives the person's words back
            if (!room) pendings.get(brickId)?.setupFailed();
            return room;
        })
        .catch((error: unknown) => {
            console.error("Could not open the chat with a Brick", error);
            pendings.get(brickId)?.setupFailed();
            return undefined;
        })
        .finally(() => {
            running.delete(brickId);
            opening.update((ids) => {
                const next = new Set(ids);
                next.delete(brickId);
                return next;
            });
        });
    running.set(brickId, run);
    return run;
}

/**
 * The direct chat this device has with someone, kept up to date: found again when any list of chats changes (direct
 * chats, rooms, and the rooms in folders, where getDirectRoomFor also looks) and when the members of a chat arrive
 * (they can load after the chat is listed). Undefined while there is none.
 */
export function directChatWith(connection: ChatConnectionInterface, chatId: string): Readable<ChatRoom | undefined> {
    return readable<ChatRoom | undefined>(connection.getDirectRoomFor(chatId), (set) => {
        let queued = false;
        let stopped = false;
        const look = () => {
            queued = false;
            if (!stopped) set(connection.getDirectRoomFor(chatId));
        };
        const lookSoon = () => {
            if (queued || stopped) return;
            queued = true;
            queueMicrotask(look);
        };
        // What each list watches now, by list: a list that changes drops its old watches and takes new ones
        const watches = new Map<object, (() => void)[]>();
        const stopWatches = (list: object) => {
            watches.get(list)?.forEach((stop) => stop());
            watches.delete(list);
        };
        const watchRooms = (list: object, rooms: readonly ChatRoom[]) => {
            stopWatches(list);
            const stops: (() => void)[] = [];
            for (const room of rooms) {
                const members = (room as Partial<{ members: Readable<unknown> }>).members;
                if (members) stops.push(members.subscribe(lookSoon));
            }
            watches.set(list, stops);
            lookSoon();
        };
        const watchFolders = (list: object, folders: readonly RoomFolder[], seen: Set<string>) => {
            stopWatches(list);
            const stops: (() => void)[] = [];
            for (const folder of folders) {
                if (seen.has(folder.id)) continue;
                seen.add(folder.id);
                stops.push(folder.rooms.subscribe((rooms) => watchRooms(folder.rooms, rooms)));
                stops.push(() => stopWatches(folder.rooms));
                stops.push(
                    folder.folders.subscribe((children) => watchFolders(folder.folders, children, new Set(seen)))
                );
                stops.push(() => stopWatches(folder.folders));
            }
            watches.set(list, stops);
            lookSoon();
        };
        const stopDirect = connection.directRooms.subscribe((rooms) => watchRooms(connection.directRooms, rooms));
        // A connection without rooms or folders (a test's, or the void one) has only its direct chats
        const stopRooms = connection.rooms?.subscribe((rooms) => watchRooms(connection.rooms, rooms));
        const stopFolders = connection.folders?.subscribe((folders) =>
            watchFolders(connection.folders, folders, new Set())
        );
        return () => {
            stopped = true;
            stopDirect();
            stopRooms?.();
            stopFolders?.();
            [...watches.keys()].forEach(stopWatches);
        };
    });
}

/**
 * The person's Bricks this device has no chat with yet: each shows in Chats as a row of its own until its chat exists,
 * and the chat's own row takes its place from then on.
 */
export function bricksWithoutChat(
    connection: ChatConnectionInterface,
    bricksByChatId: Readable<Map<string, BrickCard>>
): Readable<BrickCard[]> {
    return derived(
        bricksByChatId,
        ($byChatId, set) => {
            const bricks = [...$byChatId];
            if (bricks.length === 0) {
                set([]);
                return;
            }
            const chats = bricks.map(([chatId]) => directChatWith(connection, chatId));
            return derived(chats, ($chats) =>
                bricks.filter((_, index) => $chats[index] === undefined).map(([, brick]) => brick)
            ).subscribe(set);
        },
        [] as BrickCard[]
    );
}
