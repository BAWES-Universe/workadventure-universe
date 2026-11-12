import { derived, get, readable, writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { localUserStore } from "../../Connection/LocalUserStore";
import { botApiService } from "../../external-modules/bots/services/BotApiService";
import { LL } from "../../../i18n/i18n-svelte";
import { gameManager } from "../../Phaser/Game/GameManager";
import { warningMessageStore } from "../../Stores/ErrorStore";
import type { ChatConnectionInterface, ChatRoom } from "../Connection/ChatConnection";
import { openChatRoom, openDirectChatRoom } from "../Utils";
import { openBrickChatWith, type BrickCard, type MakeItMemory } from "./Brick";
import { GUEST_BRICK_ID } from "./GuestBrick";
import { openGuestBrickChat } from "./GuestBrickStore";

/** The Bricks whose chat is being opened right now, so their row can say so and a second tap does nothing more. */
const opening = writable<ReadonlySet<string>>(new Set());
export const openingBrickChats: Readable<ReadonlySet<string>> = { subscribe: opening.subscribe };

const running = new Map<string, Promise<ChatRoom | undefined>>();
const makeIt: MakeItMemory = new Map();

function listed(connection: ChatConnectionInterface, roomId: string): boolean {
    return (
        get(connection.directRooms).some((room) => room.id === roomId) ||
        get(connection.rooms).some((room) => room.id === roomId)
    );
}

/** Opens the chat with one of the person's own Bricks: the one chat they have, on every device (see openBrickChatWith). */
export function openBrickChat(brickId: string): Promise<ChatRoom | undefined> {
    // The Brick for guests has no chat on any server: its chat is the one this device keeps
    if (brickId === GUEST_BRICK_ID) return Promise.resolve(openGuestBrickChat());
    const already = running.get(brickId);
    if (already) return already;
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
                openChatWith: (chatId) => openDirectChatRoom(chatId),
                openRoom: async (roomId) => {
                    await openChatRoom(roomId);
                    return connection.getRoomByID(roomId);
                },
                sayStillLoading: () => warningMessageStore.addWarningMessage(get(LL).chat.chatsStillLoading()),
                sleep: (ms) =>
                    new Promise((resolve) => {
                        setTimeout(resolve, ms);
                    }),
                now: () => Date.now(),
            },
            makeIt
        );
    })()
        .catch((error: unknown) => {
            console.error("Could not open the chat with a Brick", error);
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
 * The direct chat this device has with someone, kept up to date: found again when the list of chats changes and when
 * the members of a chat arrive (they can load after the chat is listed). Undefined while there is none.
 */
export function directChatWith(connection: ChatConnectionInterface, chatId: string): Readable<ChatRoom | undefined> {
    return readable<ChatRoom | undefined>(connection.getDirectRoomFor(chatId), (set) => {
        let memberWatches: (() => void)[] = [];
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
        const stopList = connection.directRooms.subscribe((rooms) => {
            memberWatches.forEach((stop) => stop());
            memberWatches = [];
            for (const room of rooms) {
                const members = (room as Partial<{ members: Readable<unknown> }>).members;
                if (members) memberWatches.push(members.subscribe(lookSoon));
            }
            lookSoon();
        });
        return () => {
            stopped = true;
            stopList();
            memberWatches.forEach((stop) => stop());
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
