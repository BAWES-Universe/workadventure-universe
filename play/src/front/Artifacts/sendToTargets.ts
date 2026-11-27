import { get, readable } from "svelte/store";
import type { Readable, Unsubscriber } from "svelte/store";
import type { ChatRoom, RoomFolder } from "../Chat/Connection/ChatConnection";
import { botIdFromChatId } from "../Chat/Bots/BotChatStatus";
import { normalizeTimestamp } from "../Chat/Components/OneList/OneListOrder";

/** One chat "Send to…" can send to, as the chat server lists it right now. */
export interface SendEntry {
    room: ChatRoom;
    roomName: string;
    /** The chat addresses of everyone in it, the person's own included. Empty until the chat's members have arrived. */
    memberIds: string[];
    timestamp: number;
}

/** A chat with a Brick (any, not only the person's own): the other member's address is a bot's. */
export function isBrickChat(
    entry: Pick<SendEntry, "room" | "memberIds">,
    myChatId: string | null | undefined
): boolean {
    return entry.room.type === "direct" && entry.memberIds.some((id) => id !== myChatId && botIdFromChatId(id));
}

/** The members of a chat as a plain list of addresses, for a chat on the chat server (others have none to give). */
function memberIdsOf(room: ChatRoom): string[] {
    const members = (room as Partial<{ members: Readable<{ id: string }[]> }>).members;
    return members ? get(members).map((member) => member.id) : [];
}

/**
 * Every chat the person has that can take a message, kept current: its direct chats, its groups, and the chats put in
 * folders (in folders inside folders too). A chat hidden from the list of chats stays hidden here: an area's own chat room,
 * and the chat of a Brick that waits deleted. Invitations are not chats yet and are left out.
 */
export function sendEntriesStore(
    sources: {
        directRooms: Readable<ChatRoom[]>;
        rooms: Readable<ChatRoom[]>;
        folders: Readable<RoomFolder[]>;
    },
    hiddenRoomIds: Readable<ReadonlySet<string>>
): Readable<SendEntry[]> {
    return readable<SendEntry[]>([], (set) => {
        let directRooms: ChatRoom[] = [];
        let rooms: ChatRoom[] = [];
        let folders: RoomFolder[] = [];
        let hidden: ReadonlySet<string> = new Set();
        let watches: Unsubscriber[] = [];
        let building = false;
        let started = false;

        const allRooms = (): ChatRoom[] => {
            const all = [...directRooms, ...rooms];
            const seen = new Set<string>();
            const walk = (folder: RoomFolder) => {
                if (seen.has(folder.id)) return;
                seen.add(folder.id);
                all.push(...get(folder.rooms));
                get(folder.folders).forEach(walk);
            };
            folders.forEach(walk);
            // A chat can be listed twice (a direct chat that is also in a folder): once is enough
            const ids = new Set<string>();
            return all.filter((room) => !hidden.has(room.id) && !ids.has(room.id) && !!ids.add(room.id));
        };

        const emit = () => {
            if (building || !started) return;
            set(
                allRooms().map((room) => ({
                    room,
                    roomName: get(room.name),
                    memberIds: memberIdsOf(room),
                    timestamp: normalizeTimestamp(room.lastMessageTimestamp),
                }))
            );
        };

        // What is watched follows what there is: a chat or folder that arrives is watched, one that left is not
        const rewatch = () => {
            watches.forEach((unsubscribe) => unsubscribe());
            watches = [];
            building = true;
            try {
                const seen = new Set<string>();
                const watchFolder = (folder: RoomFolder) => {
                    if (seen.has(folder.id)) return;
                    seen.add(folder.id);
                    watches.push(folder.rooms.subscribe(rewatchSoon), folder.folders.subscribe(rewatchSoon));
                    get(folder.folders).forEach(watchFolder);
                };
                folders.forEach(watchFolder);
                for (const room of allRooms()) {
                    // The name and the members can arrive after the chat itself
                    watches.push(room.name.subscribe(emit));
                    const members = (room as Partial<{ members: Readable<unknown> }>).members;
                    if (members) watches.push(members.subscribe(emit));
                }
            } finally {
                building = false;
            }
        };
        const rewatchSoon = () => {
            if (building || !started) return;
            rewatch();
            emit();
        };

        const stops = [
            sources.directRooms.subscribe((value) => {
                directRooms = value;
                rewatchSoon();
            }),
            sources.rooms.subscribe((value) => {
                rooms = value;
                rewatchSoon();
            }),
            sources.folders.subscribe((value) => {
                folders = value;
                rewatchSoon();
            }),
            hiddenRoomIds.subscribe((value) => {
                hidden = value;
                rewatchSoon();
            }),
        ];
        started = true;
        rewatch();
        emit();
        return () => {
            started = false;
            stops.forEach((stop) => stop());
            watches.forEach((unsubscribe) => unsubscribe());
            watches = [];
        };
    });
}
