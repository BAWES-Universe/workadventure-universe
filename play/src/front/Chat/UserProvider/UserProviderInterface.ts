import type { Readable } from "svelte/store";
import type { PartialAnyKindOfUser } from "../Connection/ChatConnection";

export interface UserProviderInterface {
    users: Readable<PartialAnyKindOfUser[]>;
    setFilter: (searchText: string) => Promise<void>;
    /** Reads the list again when it was read more than a couple of minutes ago. Providers that are live have nothing to do. */
    refreshIfStale?: () => Promise<void>;
}
