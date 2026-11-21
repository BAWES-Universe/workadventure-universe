/**
 * StudentHub embed (contract "Universe entry", card E3): the identity listener.
 *
 * StudentHub's embed, opened as a co-website WITHOUT the scripting API, asks its parent who is playing:
 *     { type: "studenthub.embed.identity-request", v: 1, challenge }
 * and accepts only the answer
 *     { type: "studenthub.embed.identity", v: 1, attestation }
 * from the exact Universe origin, from `window.parent`.
 *
 * This is a dedicated module, not the generic iframe bus. It answers only a message whose `event.source` is the
 * `contentWindow` of the StudentHub iframe Universe itself opened (recorded when that iframe was put on the page) AND
 * whose `event.origin` is the configured embed origin, with exactly the request shape above. The answer goes to that
 * same window with `targetOrigin` = the embed origin, so the browser never delivers it to anything else. The
 * attestation is kept only in memory, for the time it takes to pass it on; it is never logged or stored.
 */

export const IDENTITY_REQUEST_TYPE = "studenthub.embed.identity-request";
export const IDENTITY_REPLY_TYPE = "studenthub.embed.identity";
/** StudentHub's challenge: 32 random bytes as base64url. The same bounds the pusher checks. */
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

/** The challenge of an exact identity request, or undefined for anything else (extra keys included). */
export function parseIdentityRequest(data: unknown): string | undefined {
    if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
    if (Object.getPrototypeOf(data) !== Object.prototype) return undefined;
    const keys = Object.keys(data).sort();
    if (keys.length !== 3 || keys[0] !== "challenge" || keys[1] !== "type" || keys[2] !== "v") return undefined;
    const message = data as Record<string, unknown>;
    if (message.type !== IDENTITY_REQUEST_TYPE || message.v !== 1) return undefined;
    if (typeof message.challenge !== "string" || !CHALLENGE_PATTERN.test(message.challenge)) return undefined;
    return message.challenge;
}

export interface MessageTarget {
    addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
    removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

interface Registration {
    readonly iframe: HTMLIFrameElement;
    readonly window: Window;
    readonly generation: number;
}

export class StudentHubIdentityListener {
    private registration: Registration | undefined;
    private generation = 0;
    private latestRequest = 0;
    private readonly onMessage = (event: MessageEvent) => this.handle(event);

    /**
     * @param embedOrigin the exact StudentHub embed origin (STUDENTHUB_EMBED_ORIGIN)
     * @param attest asks the pusher for an attestation of this challenge; undefined when none can be given
     * @param target where messages arrive (the game's window)
     */
    constructor(
        private readonly embedOrigin: string,
        private readonly attest: (challenge: string) => Promise<string | undefined>,
        private readonly target: MessageTarget = window
    ) {}

    /** Records the StudentHub iframe Universe opened. Only its window is ever answered. */
    register(iframe: HTMLIFrameElement): void {
        const contentWindow = iframe.contentWindow;
        if (!contentWindow) return;
        const wasListening = this.registration !== undefined;
        this.registration = { iframe, window: contentWindow, generation: ++this.generation };
        if (!wasListening) this.target.addEventListener("message", this.onMessage);
    }

    /** Forgets the iframe (closed, or taken off the page). An answer still on its way is dropped. */
    unregister(iframe: HTMLIFrameElement): void {
        if (this.registration?.iframe !== iframe) return;
        this.reset();
    }

    /** Forgets whatever is registered (logout, account switch, reconnect). */
    reset(): void {
        if (this.registration === undefined) return;
        this.registration = undefined;
        this.generation++;
        this.target.removeEventListener("message", this.onMessage);
    }

    isRegistered(): boolean {
        return this.registration !== undefined;
    }

    private handle(event: MessageEvent): void {
        const registration = this.registration;
        if (!registration) return;
        if (event.source === null || event.source !== registration.window) return;
        if (event.origin !== this.embedOrigin) return;
        const challenge = parseIdentityRequest(event.data);
        if (challenge === undefined) return;

        // Only the newest request is answered: StudentHub keeps only its newest challenge.
        const request = ++this.latestRequest;
        this.attest(challenge)
            .then((attestation) => {
                if (attestation === undefined) return;
                if (this.registration?.generation !== registration.generation || request !== this.latestRequest) return;
                registration.window.postMessage(
                    { type: IDENTITY_REPLY_TYPE, v: 1, attestation },
                    { targetOrigin: this.embedOrigin }
                );
            })
            .catch(() => {
                // No answer: StudentHub shows "waiting for Universe" and asks again. Nothing about it is logged.
            });
    }
}
