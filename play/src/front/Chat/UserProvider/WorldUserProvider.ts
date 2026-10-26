import type { Readable, Writable } from "svelte/store";
import { derived, writable } from "svelte/store";
import type { PartialAdminUser } from "../Connection/ChatConnection";
import type { SpaceInterface } from "../../Space/SpaceInterface";
import type { UserProviderInterface } from "./UserProviderInterface";
import { mapExtendedSpaceUserToChatUser } from "./ChatUserMapper";

export class WorldUserProvider implements UserProviderInterface {
    public readonly users: Readable<PartialAdminUser[]>;
    public readonly userCount: Readable<number>;
    /** userCount without the bots: what the People tab's badge shows (#1389). */
    public readonly peopleCount: Readable<number>;
    private filter: Writable<string> = writable("");

    constructor(allUsersInWorldSpace: SpaceInterface) {
        this.users = derived(
            [allUsersInWorldSpace.usersStore, this.filter],
            ([users, filter]) => {
                return Array.from(users.values())
                    .filter((user) => user.name.toLowerCase().includes(filter.toLowerCase()))
                    .map(mapExtendedSpaceUserToChatUser);
            },
            []
        );
        this.userCount = derived(this.users, countPeople);
        // From everyone in the world, not the search results: the badge doesn't change as you type in the People filter.
        this.peopleCount = derived(allUsersInWorldSpace.usersStore, (users) =>
            countPeople(
                Array.from(users.values())
                    .map(mapExtendedSpaceUserToChatUser)
                    .filter((user) => !user.isBot)
            )
        );
    }

    setFilter(searchText: string): Promise<void> {
        this.filter.set(searchText);
        return Promise.resolve();
    }
}

/**
 * Counts people the way the People tab lists them: one per tab (space user id), so several tabs of one account
 * (clones) count each other. Falls back to the uuid for entries without a space user id.
 */
export function countPeople(users: { spaceUserId?: string; uuid?: string }[]): number {
    return new Set(users.map((user) => user.spaceUserId || user.uuid)).size;
}

/**
 * People and bots among who is somewhere (#1389): a bot is anyone the mapper marks as one (isBotUser), everyone else
 * (guests and you included) is a person. Counts each entry, as the list gives them.
 */
export function countPeopleAndBots(users: { isBot?: boolean }[]): { people: number; bots: number } {
    const bots = users.filter((user) => user.isBot).length;
    return { people: users.length - bots, bots };
}

/** The people in this world's other rooms, for "Elsewhere in this world" (#1396): bots left out, sessions counted as
 * the list gives them. */
export function countPeopleElsewhere(
    usersByRoom: Map<string | undefined, { users: { isBot?: boolean }[] }>,
    currentRoomUrl: string | undefined
): number {
    let people = 0;
    for (const [playUri, entry] of usersByRoom) {
        if (playUri !== undefined && playUri !== currentRoomUrl) people += countPeopleAndBots(entry.users).people;
    }
    return people;
}
