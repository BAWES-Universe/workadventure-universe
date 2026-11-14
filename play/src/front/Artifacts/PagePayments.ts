import { writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { ArtifactRequestError, payOnArtifact } from "./ArtifactApi";
import type { ArtifactChat, ArtifactPay } from "./ArtifactApi";

/**
 * The bridge between a page that takes payments and Universe, inside the game's artifact window (Keys for Apps, game #2044).
 * The page runs in a locked frame and can post one kind of message: `{ universe: "use-app", app }`, asking for the checkout its
 * owner set up. Everything real is decided on the server: only the frame of this window is listened to, the amount and the service
 * are the owner's (the message carries neither), and the page hears back only a status, never an address, a key or an order.
 */

export type PayProblem = "unavailable" | "limit" | "not_paid" | "cant_confirm";

/** What the window says under the page while a payment is on its way. */
export interface PayLine {
    /** A payment was started and has not ended */
    checking: boolean;
    /** Why it did not go through, if it did not */
    problem: PayProblem | null;
    /** Where to go on when the pop-up was blocked: the same checkout, in a new tab */
    resume: { url: string; app: string } | null;
    /** A payment was confirmed; `test` when it was made with a test key */
    paid: { test: boolean } | null;
}

export const NO_PAY_LINE: PayLine = { checking: false, problem: null, resume: null, paid: null };

/** How often an order is asked about, and for how long. The server asks the service itself at most once every few seconds. */
const POLL_MS = 3_000;
const POLL_FOR_MS = 20 * 60_000;

/** Only a plain https address is ever opened. */
export function safeCheckout(url: string | null | undefined): string | undefined {
    if (!url) return undefined;
    try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.href : undefined;
    } catch {
        return undefined;
    }
}

export interface PagePaymentsOptions {
    artifactId: string;
    chat: () => ArtifactChat | undefined;
    /** The window of the artifact's frame, as it is now: a message from any other window is ignored. */
    frame: () => Window | null | undefined;
    /** Opens the checkout's window straight from the tap's moment; undefined when the browser blocked it. */
    openWindow?: () => Window | null;
    pay?: typeof payOnArtifact;
    now?: () => number;
}

export interface PagePayments {
    line: Readable<PayLine>;
    onMessage: (event: MessageEvent) => void;
    destroy: () => void;
}

export function pagePayments(options: PagePaymentsOptions): PagePayments {
    const pay = options.pay ?? payOnArtifact;
    const now = options.now ?? Date.now;
    const line = writable<PayLine>(NO_PAY_LINE);
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let destroyed = false;

    // The frame has no origin of its own, so it can only be addressed with "*": the message holds nothing but a status
    const tell = (status: string) => options.frame()?.postMessage({ universe: "app-result", status }, "*");

    const end = (update: Partial<PayLine>, status: string) => {
        busy = false;
        line.set({ ...NO_PAY_LINE, ...update });
        tell(status);
    };

    const watch = (orderId: string) => {
        const until = now() + POLL_FOR_MS;
        const poll = async () => {
            if (destroyed) return;
            try {
                const answer: ArtifactPay = await pay(options.artifactId, options.chat(), { order: orderId });
                if (destroyed) return;
                if (answer.status === "paid") return end({ paid: { test: answer.testPayment === true } }, "paid");
                if (answer.status === "not_paid") return end({ problem: "not_paid" }, "not_paid");
                if (answer.status === "cant_confirm") return end({ problem: "cant_confirm" }, "cant_confirm");
            } catch {
                // Try again on the next turn
            }
            if (now() < until) timer = setTimeout(poll, POLL_MS);
            else {
                busy = false;
                line.update((value) => ({ ...value, checking: false }));
                tell("checking");
            }
        };
        timer = setTimeout(poll, POLL_MS);
    };

    const onMessage = (event: MessageEvent) => {
        const frame = options.frame();
        if (!frame || event.source !== frame) return;
        const data = event.data as { universe?: unknown; app?: unknown } | null;
        if (!data || data.universe !== "use-app" || typeof data.app !== "string" || busy) return;
        busy = true;
        // Opened now, in the same moment as the page's tap, so a blocked pop-up is the only thing left that can go wrong
        let popup: Window | null = null;
        try {
            popup = options.openWindow?.() ?? null;
            if (popup) popup.opener = null;
        } catch {
            popup = null;
        }
        void (async () => {
            try {
                const answer = await pay(options.artifactId, options.chat(), { start: true });
                const url = safeCheckout(answer.checkoutUrl);
                if (destroyed) {
                    popup?.close();
                    return;
                }
                if (!answer.orderId || !url) {
                    popup?.close();
                    return end({ problem: "unavailable" }, "unavailable");
                }
                if (popup) popup.location.href = url;
                line.set({
                    ...NO_PAY_LINE,
                    checking: true,
                    resume: popup ? null : { url, app: answer.app ?? "" },
                });
                tell("started");
                watch(answer.orderId);
            } catch (error) {
                popup?.close();
                if (destroyed) return;
                const limit = error instanceof ArtifactRequestError && error.code === "limit";
                end({ problem: limit ? "limit" : "unavailable" }, limit ? "limit" : "unavailable");
            }
        })();
    };

    return {
        line: { subscribe: line.subscribe },
        onMessage,
        destroy() {
            destroyed = true;
            if (timer) clearTimeout(timer);
        },
    };
}
