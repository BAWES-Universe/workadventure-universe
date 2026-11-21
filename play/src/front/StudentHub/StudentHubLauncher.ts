import { StudentHubIdentityListener, type MessageTarget } from "./StudentHubIdentityListener";

/**
 * StudentHub embed (contract "Universe entry", card E3): the launcher.
 *
 * - Embed on (STUDENTHUB_EMBED_ORIGIN set): opens `<embed origin>/universe/embed` as an item of the window, with no
 *   scripting API, and points the dedicated identity listener at its iframe.
 * - Embed off: opens StudentHub (STUDENTHUB_URL) top-level in a new tab. That is never in-Universe acceptance.
 * - On a Universe logout, an account switch or a reconnect, the StudentHub item is closed and the listener forgets
 *   its iframe, so nothing is answered for a player who is no longer the one who opened it.
 *
 * No credential or identity is ever put in the URL it opens.
 */

export const EMBED_PATH = "/universe/embed";
/** StudentHub waits 5 s for an answer; there is no point answering later. */
export const ATTESTATION_TIMEOUT_MS = 5_000;

export type CloseReason = "logout" | "account_switch" | "reconnect";

/** The parts of the game the launcher uses, passed in so it can be tested without the game. */
export interface StudentHubLauncherDeps {
    readonly studentHubUrl: string | undefined;
    readonly embedOrigin: string | undefined;
    /** The pusher's absolute URL, ending with a slash (ABSOLUTE_PUSHER_URL). */
    readonly pusherUrl: string;
    /** The game token kept on this device, or null. */
    getAuthToken(): string | null;
    /** Replaces the game token after the pusher renewed the provider tokens (same player). */
    setAuthToken(token: string): void;
    /** Whether the token belongs to a signed-in account (not a guest). */
    isLogged(): boolean;
    openCoWebsite(url: URL, onIframe: CoWebsiteIframeHooks): { close(): void; isOpen(): boolean };
    openTab(url: string): void;
    fetch: typeof fetch;
    messageTarget?: MessageTarget;
}

export interface CoWebsiteIframeHooks {
    mounted(iframe: HTMLIFrameElement): void;
    unmounted(iframe: HTMLIFrameElement): void;
}

/** The player a game token was issued for (its `identifier` claim), read without checking it: only compared. */
export function playerOfToken(token: string | null): string | undefined {
    if (!token) return undefined;
    const payload = token.split(".")[1];
    if (!payload) return undefined;
    try {
        const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
        const json = new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
        const claims: unknown = JSON.parse(json);
        if (typeof claims !== "object" || claims === null) return undefined;
        const identifier = (claims as Record<string, unknown>).identifier;
        return typeof identifier === "string" && identifier !== "" ? identifier : undefined;
    } catch {
        return undefined;
    }
}

export class StudentHubLauncher {
    private readonly listener: StudentHubIdentityListener | undefined;
    private opened: { handle: ReturnType<StudentHubLauncherDeps["openCoWebsite"]>; player: string } | undefined;

    constructor(private readonly deps: StudentHubLauncherDeps) {
        this.listener = deps.embedOrigin
            ? new StudentHubIdentityListener(
                  deps.embedOrigin,
                  (challenge) => this.attest(challenge),
                  deps.messageTarget
              )
            : undefined;
    }

    /** Whether the menu offers StudentHub at all. */
    isAvailable(): boolean {
        return this.deps.embedOrigin !== undefined || this.deps.studentHubUrl !== undefined;
    }

    /** Whether StudentHub opens inside Universe (else in a new tab). */
    isEmbedded(): boolean {
        return this.deps.embedOrigin !== undefined;
    }

    launch(): void {
        const embedOrigin = this.deps.embedOrigin;
        if (embedOrigin === undefined) {
            if (this.deps.studentHubUrl !== undefined) this.deps.openTab(this.deps.studentHubUrl);
            return;
        }
        // Already open: it stays as it is (a second one would only ask StudentHub for a second instance).
        if (this.opened?.handle.isOpen()) return;
        const listener = this.listener as StudentHubIdentityListener;
        const handle = this.deps.openCoWebsite(new URL(EMBED_PATH, embedOrigin), {
            mounted: (iframe) => listener.register(iframe),
            unmounted: (iframe) => listener.unregister(iframe),
        });
        // A guest opens it too: StudentHub then says Universe has to confirm who they are, and nothing is attested.
        this.opened = { handle, player: playerOfToken(this.deps.getAuthToken()) ?? "" };
    }

    /** Closes StudentHub (if open) and makes the listener forget its iframe at once. */
    close(reason: CloseReason): void {
        void reason;
        this.listener?.reset();
        const opened = this.opened;
        this.opened = undefined;
        opened?.handle.close();
    }

    /**
     * The game token changed (signed in, out, or as someone else, here or in another tab). Anything but the same player
     * is an account switch.
     */
    authTokenChanged(token: string | null): void {
        if (!this.opened) return;
        const player = playerOfToken(token) ?? "";
        if (player !== this.opened.player) this.close(token === null ? "logout" : "account_switch");
    }

    /** Asks the pusher for an attestation of StudentHub's challenge. Undefined when none can be given. */
    private async attest(challenge: string): Promise<string | undefined> {
        const token = this.deps.getAuthToken();
        // A guest has no provider account to prove; the pusher would refuse anyway.
        if (!token || !this.deps.isLogged()) return undefined;
        // The player who opened StudentHub must still be the one playing.
        if (!this.opened || playerOfToken(token) !== this.opened.player) return undefined;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ATTESTATION_TIMEOUT_MS);
        try {
            const response = await this.deps.fetch(new URL("studenthub/embed/attestation", this.deps.pusherUrl), {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: token },
                body: JSON.stringify({ challenge }),
                cache: "no-store",
                credentials: "omit",
                signal: controller.signal,
            });
            if (!response.ok) return undefined;
            const body: unknown = await response.json();
            if (typeof body !== "object" || body === null) return undefined;
            const { attestation, authToken } = body as Record<string, unknown>;
            if (typeof attestation !== "string" || attestation === "") return undefined;
            // The pusher renewed the provider tokens: keep the renewed game token, as /me does, if nothing replaced
            // the one sent meanwhile and it names the same player.
            if (
                typeof authToken === "string" &&
                this.deps.getAuthToken() === token &&
                playerOfToken(authToken) === playerOfToken(token)
            ) {
                this.deps.setAuthToken(authToken);
            }
            return attestation;
        } catch {
            return undefined;
        } finally {
            clearTimeout(timer);
        }
    }
}
