import type { Readable, Writable } from "svelte/store";
import { derived, writable } from "svelte/store";
import type { PartialAdminUser } from "../Connection/ChatConnection";
import type { SpaceInterface } from "../../Space/SpaceInterface";
import type { UserProviderInterface } from "./UserProviderInterface";
import { mapExtendedSpaceUserToChatUser } from "./ChatUserMapper";

export class WorldUserProvider implements UserProviderInterface {
    public readonly users: Readable<PartialAdminUser[]>;
    public readonly userCount: Readable<number>;
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
