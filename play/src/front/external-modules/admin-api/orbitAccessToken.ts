import { MeResponse } from "@workadventure/messages";
import { localUserStore } from "../../Connection/LocalUserStore";
import { axiosToPusher } from "../../Connection/AxiosUtils";

/**
 * Where a caller keeps the game's token: the extension module's options, or the bot editor's own copy. A renewal
 * writes the renewed game token back here (and to the local user store).
 */
export interface GameTokenHolder {
    userAccessToken: string | null;
    roomId: string;
}

// Helper to extract OIDC access token from JWT
export function getAccessTokenFromJwt(jwtToken: string | null): string | null {
    if (!jwtToken) {
        return null;
    }
    try {
        const base64Url = jwtToken.split(".")[1];
        const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
        const jsonPayload = decodeURIComponent(
            atob(base64)
                .split("")
                .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
                .join("")
        );
        const payload = JSON.parse(jsonPayload);
        return payload.accessToken || null;
    } catch (e) {
        console.error("Error parsing JWT:", e);
        return null;
    }
}

/** When the OIDC access token inside the game's token runs out, in ms since the epoch; null when it doesn't say. */
function accessTokenExpiry(accessToken: string): number | null {
    try {
        const base64 = accessToken.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
        if (!base64) return null;
        const payload = JSON.parse(atob(base64)) as { exp?: unknown };
        return typeof payload.exp === "number" ? payload.exp * 1000 : null;
    } catch {
        return null;
    }
}

/** Whether an OIDC access token has run out (false when it doesn't say when). */
export function orbitAccessTokenHasExpired(accessToken: string): boolean {
    const expiry = accessTokenExpiry(accessToken);
    return expiry !== null && expiry <= Date.now();
}

/** Don't hand out a token about to run out: Orbit's sign-in would fail a moment later. */
const ACCESS_TOKEN_MARGIN_MS = 60_000;

/**
 * How long a /me renewal may take. Without a limit a play server that accepts the request and never answers would
 * hold up the room join for good, since the join waits for the renewal; at the limit it counts as a failed renewal.
 */
const RENEWAL_TIMEOUT_MS = 10_000;

/**
 * Why a renewal failed: the play server could not be reached (no connection, a timeout, the server down), so trying
 * again later may work; or it answered no (the sign-in ran out or was revoked), so trying again won't.
 */
export type RenewalFailure = "network" | "refused";

interface RenewalResult {
    /** The renewed OIDC access token, or null when it couldn't renew or the answer was not kept. */
    accessToken: string | null;
    /** Set when the renewal itself failed. */
    failure: RenewalFailure | null;
}

/**
 * No answer (no connection, a timeout) or a server error may pass. A 4xx, or an answer the game can't use, is the
 * play server's word and won't change by asking again.
 */
function failureOf(error: unknown): RenewalFailure {
    const failed = error as { isAxiosError?: unknown; response?: { status?: unknown } } | null;
    if (failed?.isAxiosError !== true) return "refused";
    const status = failed.response?.status;
    if (typeof status !== "number") return "network";
    return status >= 500 || status === 408 || status === 429 ? "network" : "refused";
}

/**
 * The /me renewal in flight, shared by every request made with the same game token (Orbit's frame and the bot
 * editor alike). A forced request doesn't join an unforced one: that one may hand back the very token just refused.
 */
let renewal: {
    gameToken: string;
    force: boolean;
    promise: Promise<RenewalResult>;
    /** Every caller waiting on this renewal: its answer is kept while any one of them still wants it. */
    wanted: Set<() => boolean>;
} | null = null;

/** Forgets the renewal in flight, so a late answer isn't shared with the next room's requests. */
export function forgetOrbitAccessTokenRenewal(): void {
    renewal = null;
}

/**
 * Renews the game token through the pusher's /me and keeps the result, returning the renewed OIDC access token.
 * Null when it couldn't renew, or when the answer came back too late to keep: the caller was torn down, the player
 * signed out, or the token it renewed from was replaced meanwhile. Keeping such a late answer would restore a
 * signed-out token or overwrite a newer one.
 */
async function renewGameToken(
    holder: GameTokenHolder,
    gameToken: string,
    force: boolean,
    isCurrent: () => boolean
): Promise<RenewalResult> {
    const notKept: RenewalResult = { accessToken: null, failure: null };
    try {
        const response = await axiosToPusher.get("me", {
            timeout: RENEWAL_TIMEOUT_MS,
            // `refresh` makes the pusher renew an access token the provider still accepts but Orbit refused.
            params: { token: gameToken, playUri: holder.roomId, ...(force ? { refresh: "true" } : {}) },
        });
        const parsed = MeResponse.parse(response.data);
        // A room that refuses this player (not a member) still sends the renewed token along: keep it, since the
        // refresh token it replaces may no longer work.
        const renewedGameToken =
            parsed.status === "ok" ? parsed.authToken : (response.data as { authToken?: unknown } | null)?.authToken;
        if (typeof renewedGameToken !== "string") return { accessToken: null, failure: "refused" };
        const renewed = getAccessTokenFromJwt(renewedGameToken);
        if (!renewed) return { accessToken: null, failure: "refused" };
        const stored = localUserStore.getAuthToken();
        const stillCurrent = isCurrent() && holder.userAccessToken === gameToken && stored !== null;
        if (!stillCurrent) return notKept;
        // The store is shared by every tab: another tab may have saved a newer token while this answer was on its way.
        // Its token may already have replaced the refresh token this answer carries, so this one is not kept. Every
        // caller then moves on to the stored token (see freshOrbitAccessToken).
        if (stored !== gameToken) return notKept;
        // The rest of the game uses the renewed token from here on too. `stillCurrent` just checked, synchronously,
        // that the holder still has the token this renewal started from.
        // eslint-disable-next-line require-atomic-updates
        holder.userAccessToken = renewedGameToken;
        localUserStore.setAuthToken(renewedGameToken);
        return { accessToken: renewed, failure: null };
    } catch (error) {
        console.warn("Orbit sign-in: could not renew the access token", error);
        return { accessToken: null, failure: failureOf(error) };
    }
}

/**
 * The OIDC access token to sign in to Orbit with. The one inside the game's token lasts an hour or so; the game's
 * own token lasts weeks and carries a refresh token, so when the access token has run out (or Orbit says it was
 * refused), the pusher's /me renews it, as the game does for its own calls.
 *
 * `isCurrent` says whether the caller still wants the answer (not torn down, not moved to another room).
 */
export async function freshOrbitAccessToken(
    holder: GameTokenHolder,
    force: boolean,
    isCurrent: () => boolean
): Promise<string | null> {
    return (await orbitAccessTokenAttempt(holder, force, isCurrent)).accessToken;
}

/** One try of freshOrbitAccessToken, which also says why the renewal failed when it did. */
async function orbitAccessTokenAttempt(
    holder: GameTokenHolder,
    force: boolean,
    isCurrent: () => boolean
): Promise<RenewalResult> {
    // Another caller (Orbit's frame, the bot editor, a reconnect) may have renewed the game's token since this holder
    // got it: start from the newest one, since a rotated refresh token makes the old one useless.
    const stored = localUserStore.getAuthToken();
    if (stored && stored !== holder.userAccessToken) holder.userAccessToken = stored;
    const gameToken = holder.userAccessToken;
    const current = getAccessTokenFromJwt(gameToken);
    if (!gameToken || !current) return { accessToken: null, failure: "refused" };
    if (!force && !isStale(current)) return { accessToken: current, failure: null };

    let inFlight = renewal?.gameToken === gameToken && (renewal.force || !force) ? renewal : null;
    if (inFlight) {
        // Whoever started it may be gone by the time it answers (the player moved to another room): this caller
        // still wants the answer.
        inFlight.wanted.add(isCurrent);
    } else {
        const wanted = new Set([isCurrent]);
        const promise: Promise<RenewalResult> = renewGameToken(holder, gameToken, force, () =>
            [...wanted].some((stillWanted) => stillWanted())
        ).finally(() => {
            if (renewal?.promise === promise) renewal = null;
        });
        inFlight = renewal = { gameToken, force, promise, wanted };
    }
    const { accessToken: renewed, failure } = await inFlight.promise;
    // Torn down or signed out meanwhile: nothing to hand out.
    if (!isCurrent() || localUserStore.getAuthToken() === null) return { accessToken: null, failure: null };
    // Couldn't renew, or the answer was not kept (another caller's renewal got there first, or another tab saved a
    // newer token meanwhile): answer with the newest token there is, and let this holder start from it next time. This
    // runs for every caller sharing the renewal, each with its own holder.
    if (renewed === null) {
        const stored = localUserStore.getAuthToken();
        // eslint-disable-next-line require-atomic-updates -- the store is read just now; nothing else is awaited
        if (stored) holder.userAccessToken = stored;
    }
    return { accessToken: renewed ?? getAccessTokenFromJwt(holder.userAccessToken), failure };
}

/** Whether an access token runs out within the margin (false when it doesn't say when). */
function isStale(accessToken: string): boolean {
    const expiry = accessTokenExpiry(accessToken);
    return expiry !== null && expiry < Date.now() + ACCESS_TOKEN_MARGIN_MS;
}

/** After a renewal that couldn't reach the play server: try again after 1, 2, 4 and 8 seconds, then every 15. */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];
const RETRY_EVERY_MS = 15_000;

/** Whether the browser says it has no connection. A browser that doesn't say counts as online. */
function isOffline(): boolean {
    return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** Waits `ms`, or less when the browser comes back online meanwhile. */
function waitOrOnline(ms: number): Promise<void> {
    return new Promise((resolve) => {
        const done = () => {
            clearTimeout(timer);
            window.removeEventListener?.("online", done);
            resolve();
        };
        const timer = setTimeout(done, ms);
        window.addEventListener?.("online", done);
    });
}

/**
 * The OIDC access token to sign Orbit in with, trying again while the play server can't be reached (a dropped or slow
 * connection) instead of handing out one that ran out. `onWait` is called each time it waits to try again, so Orbit
 * keeps waiting too. Null when it gives up: the play server said no, the caller no longer wants the answer, or it got
 * no answer for `giveUpAfterMs` of time online (time offline doesn't count: it tries again as soon as the browser is
 * back online).
 */
export async function orbitAccessTokenWithRetries(
    holder: GameTokenHolder,
    force: boolean,
    isCurrent: () => boolean,
    options: { giveUpAfterMs: number; onWait?: () => void }
): Promise<string | null> {
    const started = Date.now();
    let offlineFor = 0;
    for (let attempt = 0; isCurrent(); attempt++) {
        // Tried even when the browser says it is offline: a token that is still good needs no connection, and the
        // browser's word can be wrong. Offline, a renewal just fails at once and waits for the connection.
        // One try at a time, each after the last one's answer.
        // eslint-disable-next-line no-await-in-loop
        const { accessToken, failure } = await orbitAccessTokenAttempt(holder, force, isCurrent);
        if (!isCurrent()) return null;
        // Renewed, or the newest token there is (another caller or tab may have renewed it meanwhile).
        if (accessToken && failure === null && (force || !isStale(accessToken))) return accessToken;
        if (failure === "refused" || (failure === null && !accessToken)) return null;
        if (!isOffline() && Date.now() - started - offlineFor >= options.giveUpAfterMs) return null;
        options.onWait?.();
        const offline = isOffline();
        const waitStarted = Date.now();
        // eslint-disable-next-line no-await-in-loop
        await waitOrOnline(RETRY_DELAYS_MS[attempt] ?? RETRY_EVERY_MS);
        if (offline) offlineFor += Date.now() - waitStarted;
    }
    return null;
}

/**
 * The game's token to join a room with: the newest one there is (Orbit's frame and the bot editor renew the stored
 * one), renewed first when the OIDC access token inside has run out. Without that, a room opened an hour after page
 * load joins with a token Orbit can't check, and Orbit treats its owner as a stranger.
 */
export async function gameTokenToJoinWith(
    gameToken: string,
    roomId: string,
    isCurrent: () => boolean
): Promise<string> {
    const holder: GameTokenHolder = { userAccessToken: gameToken, roomId };
    try {
        await freshOrbitAccessToken(holder, false, isCurrent);
    } catch (error) {
        console.warn("Could not renew the sign-in token before joining a room", error);
    }
    // A renewal another caller started (Orbit's frame) and this one shared saved its result to the store, not to this
    // holder: the store has the newest token.
    return localUserStore.getAuthToken() ?? holder.userAccessToken ?? gameToken;
}
