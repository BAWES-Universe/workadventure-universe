import type { Writable } from "svelte/store";
import { readable, writable } from "svelte/store";
import type { ChatMember } from "@workadventure/messages";
import { AvailabilityStatus } from "@workadventure/messages";
import type { PartialChatUser } from "../Connection/ChatConnection";
import type { RoomConnection } from "../../Connection/RoomConnection";
import { storedWokaStore } from "../Stores/StoredWokaStore";
import type { UserProviderInterface } from "./UserProviderInterface";

/**
 * The member list is read again, when a chat asks about a person, once it is older than this (an away member who changed
 * their Woka or name in Orbit would otherwise keep the old ones until the room changes). Same rule as people outside the world.
 */
export const MEMBERS_REFRESH_AFTER_MS = 2 * 60_000;

export class AdminUserProvider implements UserProviderInterface {
    users: Writable<PartialChatUser[]>;
    private _setUsers: ((value: PartialChatUser[]) => void) | undefined;
    /** Bumped by every query: only the latest query's answer updates the list. */
    private queryGeneration = 0;
    /** What the list was last read for (the search text), so a refresh keeps the search the player typed. */
    private lastSearch = "";
    /** When the list was last asked for. Set when the question goes out, so questions never pile up. */
    private lastAskedAt: number | undefined;

    constructor(private connection: RoomConnection, private readonly now: () => number = () => Date.now()) {
        this.users = writable([] as PartialChatUser[], (set) => {
            this._setUsers = set;
            const generation = ++this.queryGeneration;
            this.lastAskedAt = this.now();
            connection
                .queryChatMembers("")
                .then(({ members }) => {
                    if (generation !== this.queryGeneration) return;
                    set(this.mapChatMembersToChatUser(members));
                })
                .catch((error) => {
                    throw new Error("An error occurred while processing chat members: " + error);
                });
        });
    }

    private mapChatMembersToChatUser(chatMembers: ChatMember[]): PartialChatUser[] {
        return chatMembers.reduce((userAcc, currentMember) => {
            if (currentMember.chatId)
                userAcc.push({
                    availabilityStatus: writable(AvailabilityStatus.UNCHANGED),
                    pictureStore: readable(undefined),
                    storedWoka: storedWokaStore(currentMember.characterTextures),
                    chatId: currentMember.chatId,
                    roomName: undefined,
                    playUri: undefined,
                    username: currentMember.wokaName,
                    gameName: currentMember.wokaName || undefined,
                    isAdmin: currentMember.tags.includes("admin"),
                    isMember: currentMember.tags.includes("member"),
                    // Their account id, so an away member can still be invited, befriended or reported.
                    uuid: currentMember.uuid || undefined,
                    color: undefined,
                    spaceUserId: undefined,
                });
            return userAcc;
        }, [] as PartialChatUser[]);
    }

    /** Reads the list again, for the search it shows, when it was last read over two minutes ago. */
    async refreshIfStale(): Promise<void> {
        const set = this._setUsers;
        if (!set || this.lastAskedAt === undefined || this.now() - this.lastAskedAt < MEMBERS_REFRESH_AFTER_MS) return;
        const generation = ++this.queryGeneration;
        this.lastAskedAt = this.now();
        try {
            const { members } = await this.connection.queryChatMembers(this.lastSearch);
            // A search was typed since: its answer is the one to show.
            if (generation === this.queryGeneration) set(this.mapChatMembersToChatUser(members));
        } catch (error) {
            // Asked again the next time a chat shows that person, after the same wait.
            console.warn("Could not read the world's members again", error);
        }
    }

    setFilter(searchText: string): Promise<void> {
        const generation = ++this.queryGeneration;
        this.lastSearch = searchText;
        this.lastAskedAt = this.now();
        return new Promise((res, rej) => {
            this.connection
                .queryChatMembers(searchText)
                .then(({ members }) => {
                    // A newer search was typed since: its answer is the one to show.
                    if (generation !== this.queryGeneration) {
                        res();
                        return;
                    }
                    if (this._setUsers) {
                        this._setUsers(this.mapChatMembersToChatUser(members));
                        res();
                    }
                })
                .catch((error) => {
                    rej(new Error("An error occurred while processing chat members: " + error));
                });
        });
    }
}
