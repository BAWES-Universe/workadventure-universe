import { derived, writable } from "svelte/store";
import type { Observable, Subscription } from "rxjs";
import type {
    FriendActionAnswer,
    FriendPresence,
    FriendsListAnswer,
    FriendSearchResult,
    FriendSettings,
    FriendSettingsUpdate,
    FriendsUpdateMessage,
} from "@workadventure/messages";

/** What the friends store needs from the room's connection (a RoomConnection), kept small for tests. */
export interface FriendsConnection {
    queryFriendsList(): Promise<FriendsListAnswer>;
    queryFriendAction(targetUuid: string, action: string): Promise<FriendActionAnswer>;
    queryFriendSearch(searchText: string): Promise<FriendSearchResult[]>;
    queryFriendSettings(update?: FriendSettingsUpdate): Promise<FriendSettings | undefined>;
    friendsUpdateMessageStream: Observable<FriendsUpdateMessage>;
}

export type FriendAction = "request" | "accept" | "ignore" | "cancel" | "remove" | "block" | "unblock";

export type Relationship =
    | "none"
    | "friends"
    | "request_sent"
    | "request_received"
    | "blocked_by_me"
    | "blocked_by_them";

/**
 * - `signedOut`: guests have no friends; the People tab shows no Friends or Requests chips.
 * - `failed`: the list could not be loaded (or reloaded). The last list known stays, but where friends are is
 *   unknown until a retry works: the panel says "Status unavailable".
 */
export type FriendsState =
    | { status: "signedOut" }
    | { status: "loading"; list?: FriendsListAnswer }
    | { status: "ready"; list: FriendsListAnswer }
    | { status: "failed"; list?: FriendsListAnswer };

/** Retries after a failed load, then every last delay until one works. */
export const FRIENDS_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];

/** Answers meaning friends don't apply to this player here. */
const NO_FRIENDS_ERRORS = ["friends_unavailable", "sign_in_required"];

/** Several changes close together (a request accepted on two tabs) make one reload. */
const RELOAD_DEBOUNCE_MS = 300;

export function createFriendsStore() {
    const { subscribe, set, update } = writable<FriendsState>({ status: "signedOut" });
    let connection: FriendsConnection | undefined;
    let updates: Subscription | undefined;
    let latestRequest = 0;
    let failures = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;

    function clearTimers() {
        if (retryTimer) clearTimeout(retryTimer);
        if (reloadTimer) clearTimeout(reloadTimer);
        retryTimer = undefined;
        reloadTimer = undefined;
    }

    async function load(): Promise<void> {
        if (!connection) return;
        const request = ++latestRequest;
        const requestConnection = connection;
        update((state) =>
            state.status === "signedOut" ? { status: "loading" } : { status: "loading", list: listOf(state) }
        );
        try {
            const list = await requestConnection.queryFriendsList();
            if (request !== latestRequest) return;
            failures = 0;
            set({ status: "ready", list });
        } catch (e) {
            if (request !== latestRequest) return;
            // This server has no friends (no admin), or doesn't count this player as signed in: nothing to retry.
            if (e instanceof Error && NO_FRIENDS_ERRORS.includes(e.message)) {
                set({ status: "signedOut" });
                return;
            }
            console.warn("Friends: could not load the list", e);
            update((state) => ({ status: "failed", list: listOf(state) }));
            const delay = FRIENDS_RETRY_DELAYS_MS[Math.min(failures, FRIENDS_RETRY_DELAYS_MS.length - 1)];
            failures++;
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = setTimeout(() => {
                retryTimer = undefined;
                load().catch((error) => console.error(error));
            }, delay);
        }
    }

    function reloadSoon() {
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
            reloadTimer = undefined;
            load().catch((e) => console.error(e));
        }, RELOAD_DEBOUNCE_MS);
    }

    function applyPresence(uuid: string, presence: FriendPresence) {
        update((state) => {
            if (state.status !== "ready" && state.status !== "loading") return state;
            if (!state.list) return state;
            const friends = state.list.friends.map((friend) =>
                friend.uuid === uuid ? { ...friend, presence } : friend
            );
            return { ...state, list: { ...state.list, friends } };
        });
    }

    function onUpdate(message: FriendsUpdateMessage) {
        switch (message.update?.$case) {
            case "presence": {
                const { uuid, presence } = message.update.presence;
                if (presence) applyPresence(uuid, presence);
                break;
            }
            case "listChanged":
                reloadSoon();
                break;
        }
    }

    function requireConnection(): FriendsConnection {
        if (!connection) throw new Error("Friends are for signed-in players");
        return connection;
    }

    return {
        subscribe,
        /** A new room's connection. Guests get no friends; signed-in players load theirs. */
        attach(newConnection: FriendsConnection, signedIn: boolean): void {
            updates?.unsubscribe();
            clearTimers();
            failures = 0;
            latestRequest++;
            if (!signedIn) {
                connection = undefined;
                updates = undefined;
                set({ status: "signedOut" });
                return;
            }
            connection = newConnection;
            updates = newConnection.friendsUpdateMessageStream.subscribe(onUpdate);
            load().catch((e) => console.error(e));
        },
        detach(): void {
            updates?.unsubscribe();
            updates = undefined;
            clearTimers();
            connection = undefined;
            latestRequest++;
            set({ status: "signedOut" });
        },
        refresh(): void {
            load().catch((e) => console.error(e));
        },
        /** Sends one action and reloads the list. Refusals resolve with their error code. */
        async act(targetUuid: string, action: FriendAction): Promise<FriendActionAnswer> {
            const answer = await requireConnection().queryFriendAction(targetUuid, action);
            reloadSoon();
            return answer;
        },
        search(text: string): Promise<FriendSearchResult[]> {
            return requireConnection().queryFriendSearch(text);
        },
        settings(update?: FriendSettingsUpdate): Promise<FriendSettings | undefined> {
            return requireConnection().queryFriendSettings(update);
        },
    };
}

function listOf(state: FriendsState): FriendsListAnswer | undefined {
    return state.status === "signedOut" ? undefined : state.list;
}

export const friendsStore = createFriendsStore();

/** Signed in, so friends apply (even while the list is loading or failed). */
export const friendsEnabledStore = derived(friendsStore, ($friends) => $friends.status !== "signedOut");

/** Where friends are is unknown right now (the list failed to load or reload). */
export const friendsPresenceUnavailableStore = derived(friendsStore, ($friends) => $friends.status === "failed");

/** How each known person stands with you, by uuid. Anyone missing is "none". */
export const relationshipsStore = derived(friendsStore, ($friends) => relationshipsOf(listOf($friends)));

export function relationshipsOf(list: FriendsListAnswer | undefined): Map<string, Relationship> {
    const map = new Map<string, Relationship>();
    if (!list) return map;
    for (const person of list.blocked) map.set(person.uuid, "blocked_by_me");
    for (const request of list.outgoing) map.set(request.uuid, "request_sent");
    for (const request of list.incoming) map.set(request.uuid, "request_received");
    for (const friend of list.friends) map.set(friend.uuid, "friends");
    return map;
}
