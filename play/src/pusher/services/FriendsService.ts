import type { AxiosRequestConfig } from "axios";
import axios, { isAxiosError } from "axios";
import { z } from "zod";
import { ADMIN_API_TOKEN, ADMIN_API_URL } from "../enums/EnvironmentVariable";

export const FRIEND_ACTIONS = ["request", "accept", "ignore", "cancel", "remove", "block", "unblock"] as const;
export type FriendAction = (typeof FRIEND_ACTIONS)[number];

export function isFriendAction(action: string): action is FriendAction {
    return (FRIEND_ACTIONS as readonly string[]).includes(action);
}

export const FRIEND_SEARCH_MIN_LENGTH = 2;
export const FRIEND_SEARCH_MAX_LENGTH = 64;
export const FRIEND_PLACES_MAX_URIS = 50;

/**
 * A friends request the admin (Orbit) refused, or that cannot be made at all.
 * `code` is what the front shows a message for (sign_in_required, blocked, no_shared_world...).
 * `status` is the HTTP status of Orbit's refusal; undefined when Orbit was not called.
 */
export class FriendsError extends Error {
    constructor(public readonly code: string, public readonly status?: number) {
        super(code);
        this.name = "FriendsError";
    }
}

export const OrbitFriendsList = z.object({
    friends: z.array(
        z.object({
            uuid: z.string(),
            name: z.string().nullable(),
            chatId: z.string().nullable(),
            shareLocation: z.boolean(),
            since: z.string().nullable(),
            lastSeenAt: z.string().nullable(),
        })
    ),
    incoming: z.array(
        z.object({
            uuid: z.string(),
            name: z.string().nullable(),
            sharedWorld: z.string().nullable(),
            requestedAt: z.string(),
        })
    ),
    outgoing: z.array(
        z.object({
            uuid: z.string(),
            name: z.string().nullable(),
            sentAt: z.string(),
        })
    ),
    blocked: z.array(
        z.object({
            uuid: z.string(),
            name: z.string().nullable(),
        })
    ),
});
export type OrbitFriendsList = z.infer<typeof OrbitFriendsList>;

const OrbitFriendAction = z.object({ relationship: z.string() });

const OrbitFriendSearch = z.object({
    results: z.array(
        z.object({
            uuid: z.string(),
            name: z.string().nullable(),
            universes: z.array(z.string()),
            relationship: z.string(),
        })
    ),
});
export type OrbitFriendSearch = z.infer<typeof OrbitFriendSearch>;

export const OrbitFriendSettings = z.object({
    ringFrom: z.string(),
    friendRequestsFrom: z.string(),
    findableByName: z.boolean(),
    friendsSeeLocation: z.boolean(),
});
export type OrbitFriendSettings = z.infer<typeof OrbitFriendSettings>;

const OrbitFriendSettingsAnswer = z.object({ settings: OrbitFriendSettings });

/** Display names of a room, for a friend's session. */
export const FriendPlace = z.object({
    universe: z.string(),
    world: z.string(),
    room: z.string(),
});
export type FriendPlace = z.infer<typeof FriendPlace>;

const OrbitFriendPlaces = z.object({ places: z.record(z.string(), FriendPlace.nullable()) });

/** How the acting user stands with another player, and the other player's choices that matter for a ring. */
export const OrbitFriendRelationship = z.object({
    // none | friends | request_sent | request_received | blocked_by_me | blocked_by_them
    relationship: z.string(),
    target: z.object({
        ringFrom: z.string(),
        friendsSeeLocation: z.boolean(),
    }),
});
export type OrbitFriendRelationship = z.infer<typeof OrbitFriendRelationship>;

const OrbitErrorBody = z.object({ error: z.string() });

interface HttpClient {
    get(url: string, config: AxiosRequestConfig): Promise<{ data: unknown }>;
    post(url: string, body: unknown, config: AxiosRequestConfig): Promise<{ data: unknown }>;
    put(url: string, body: unknown, config: AxiosRequestConfig): Promise<{ data: unknown }>;
}

/**
 * Client of Orbit's /api/friends routes. Friendships and settings live in the admin; only usable when the
 * pusher has an admin (ADMIN_API_URL), otherwise every call fails with "friends_unavailable".
 */
export class FriendsService {
    constructor(
        private readonly baseUrl: string | undefined,
        private readonly token: string | undefined,
        private readonly http: HttpClient = axios
    ) {}

    isEnabled(): boolean {
        return !!this.baseUrl;
    }

    getFriends(userUuid: string): Promise<OrbitFriendsList> {
        return this.call(async () => {
            const response = await this.http.get(this.url("/api/friends"), {
                headers: this.headers(),
                params: { userUuid },
            });
            return OrbitFriendsList.parse(response.data);
        });
    }

    /** Returns the relationship once the action is done. */
    act(userUuid: string, targetUuid: string, action: FriendAction): Promise<string> {
        return this.call(async () => {
            const response = await this.http.post(
                this.url("/api/friends/action"),
                { userUuid, targetUuid, action },
                { headers: this.headers() }
            );
            return OrbitFriendAction.parse(response.data).relationship;
        });
    }

    search(userUuid: string, q: string): Promise<OrbitFriendSearch> {
        return this.call(async () => {
            const response = await this.http.get(this.url("/api/friends/search"), {
                headers: this.headers(),
                params: { userUuid, q },
            });
            return OrbitFriendSearch.parse(response.data);
        });
    }

    getSettings(userUuid: string): Promise<OrbitFriendSettings> {
        return this.call(async () => {
            const response = await this.http.get(this.url("/api/friends/settings"), {
                headers: this.headers(),
                params: { userUuid },
            });
            return OrbitFriendSettingsAnswer.parse(response.data).settings;
        });
    }

    updateSettings(userUuid: string, settings: Partial<OrbitFriendSettings>): Promise<OrbitFriendSettings> {
        return this.call(async () => {
            const response = await this.http.put(
                this.url("/api/friends/settings"),
                { userUuid, settings },
                { headers: this.headers() }
            );
            return OrbitFriendSettingsAnswer.parse(response.data).settings;
        });
    }

    getRelationship(userUuid: string, targetUuid: string): Promise<OrbitFriendRelationship> {
        return this.call(async () => {
            const response = await this.http.get(this.url("/api/friends/relationship"), {
                headers: this.headers(),
                params: { userUuid, targetUuid },
            });
            return OrbitFriendRelationship.parse(response.data);
        });
    }

    /** Display names of rooms by play URI (at most FRIEND_PLACES_MAX_URIS); null for a room Orbit does not know. */
    getPlaces(playUris: string[]): Promise<Record<string, FriendPlace | null>> {
        return this.call(async () => {
            const response = await this.http.post(
                this.url("/api/friends/places"),
                { playUris },
                { headers: this.headers() }
            );
            return OrbitFriendPlaces.parse(response.data).places;
        });
    }

    private url(path: string): string {
        return `${this.baseUrl}${path}`;
    }

    private headers(): Record<string, string> {
        return { Authorization: `${this.token}` };
    }

    private async call<T>(request: () => Promise<T>): Promise<T> {
        if (!this.isEnabled()) {
            throw new FriendsError("friends_unavailable");
        }
        try {
            return await request();
        } catch (e) {
            if (isAxiosError(e) && e.response && e.response.status >= 400 && e.response.status < 500) {
                const body = OrbitErrorBody.safeParse(e.response.data);
                if (body.success) {
                    throw new FriendsError(body.data.error, e.response.status);
                }
            }
            throw e;
        }
    }
}

export const friendsService = new FriendsService(ADMIN_API_URL, ADMIN_API_TOKEN);

/** At most `limit` calls per socket in any `windowMs`. */
export class PerSocketRateLimiter<S extends object> {
    private readonly calls = new WeakMap<S, number[]>();

    constructor(
        private readonly limit: number,
        private readonly windowMs: number,
        private readonly now: () => number = Date.now
    ) {}

    /** Counts a call; false when the socket is over its limit (the call is then not counted). */
    take(socket: S): boolean {
        const now = this.now();
        const recent = (this.calls.get(socket) ?? []).filter((at) => at > now - this.windowMs);
        if (recent.length >= this.limit) {
            this.calls.set(socket, recent);
            return false;
        }
        recent.push(now);
        this.calls.set(socket, recent);
        return true;
    }
}
