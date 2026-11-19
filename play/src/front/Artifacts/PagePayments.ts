import { writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { ArtifactRequestError, payOnArtifact } from "./ArtifactApi";
import type { ArtifactChat, ArtifactPay } from "./ArtifactApi";

/**
 * The bridge between a page that takes payments and Universe, inside the game's artifact window (Keys for Apps, game #2044).
 * The page runs in a locked frame and can post one kind of message: `{ universe: "use-app", app, request }`, asking for the checkout its
 * owner set up. `request` is a short id the page makes up for that tap, and every answer carries it back, so a page (a reloaded one, or
 * one that asked twice) never takes the result of another checkout as its own. Everything real is decided on the server: only the frame of this window is listened to, the amount and the service
 * are the owner's (the message carries neither), and the page hears back only a status, never an address, a key or an order.
 */

/** The id a page gives its request: short and plain, so it can only be echoed back and never carry anything else. */
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type PayProblem = "unavailable" | "limit" | "not_paid" | "cant_confirm";

/** What the window says under the page while a payment is on its way. */
export interface PayLine {
    /** A payment was started and has not ended */
    checking: boolean;
    /** The start of the checkout is taking longer than usual: the page has been told nothing yet (it hears "started" or a failure, once) */
    slow: boolean;
    /** Why it did not go through, if it did not */
    problem: PayProblem | null;
    /** Where to go on when the pop-up was blocked: the same checkout, in a new tab */
    resume: { url: string; app: string } | null;
    /** A payment was confirmed; `test` when it was made with a test key */
    paid: { test: boolean } | null;
}

export const NO_PAY_LINE: PayLine = { checking: false, slow: false, problem: null, resume: null, paid: null };

/** How often an order is asked about, and for how long. The server asks the service itself at most once every few seconds. */
const POLL_MS = 3_000;
const POLL_FOR_MS = 20 * 60_000;
/** How long the start of a checkout may wait for an answer before the window says it is taking longer (to the buyer only: the page is told nothing yet). */
const START_FOR_MS = 30_000;
/**
 * How long, from the tap, the start of a checkout is waited for in all. Its order, if it was made, is taken up when the answer comes
 * (so it is never lost) and the page hears "started" then, as for any start; and no other start is taken meanwhile (the window stays
 * busy), so two checkouts are never made for one wish. Past this the request is dropped for good and the page hears "unavailable",
 * once: the page is never told "unavailable" about a checkout that can still be offered to the buyer, because a page that has heard
 * a failure stops listening to that request, and would not hear "paid" for it.
 *
 * Dropping the request does not undo an order the server may already have made: the server writes a new order for every start (the
 * order's id is the service's own reference), under its hourly limits, and the buyer's link is only ever returned in that answer. An
 * answer that is dropped is never read, so nobody holds a link to that order and nothing can be paid against it; it stays pending,
 * never asked about, and costs one slot in the hourly limits. The next start makes its own order, with its own link.
 */
const STALLED_START_FOR_MS = 120_000;
/** How often a closed checkout tab is looked for: on its own clock, not the status questions' */
const TAB_WATCH_MS = 1_000;

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
}

export interface PagePayments {
    line: Readable<PayLine>;
    onMessage: (event: MessageEvent) => void;
    /**
     * The artifact's frame is there and has loaded: what a checkout ended with while it was away (the buyer was reading the
     * code) is told to it now, once.
     */
    frameReady: () => void;
    destroy: () => void;
}

export function pagePayments(options: PagePaymentsOptions): PagePayments {
    const pay = options.pay ?? payOnArtifact;
    const line = writable<PayLine>(NO_PAY_LINE);
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let tabWatch: ReturnType<typeof setInterval> | undefined;
    let destroyed = false;
    // The id the page gave the checkout that is on its way (or whose start has not ended): every status about that checkout carries it
    let activeRequest = "";
    // The start that is waiting for its answer: its request is dropped when the window goes away, and its timers stop
    let startInFlight: { abort: AbortController; clear: () => void } | undefined;

    // The frame has no origin of its own, so it can only be addressed with "*": the message holds nothing but a status and the
    // page's own request id. The page, not this window, decides what it trusts: only its parent, and only its own request.
    const tellRequest = (status: string, request: string) =>
        options.frame()?.postMessage({ universe: "app-result", status, request }, "*");

    // How a checkout ended, when this artifact's frame was not there to hear it (the buyer was looking at the code, or the frame
    // was being drawn again): kept for this artifact's own frame, by the request it was started for, and told to it when it is
    // there again. Told once and forgotten; a new request from the page also forgets it (the page asked again, so it has heard).
    // Never sent to any other window: the frame is always asked from the artifact's own element.
    const held = new Map<string, string>();
    const HELD_MAX = 8;

    // How a checkout ended is the page's only word of it, so it is never dropped for want of a frame
    const tellEnd = (status: string, request: string) => {
        if (options.frame()) return tellRequest(status, request);
        if (destroyed) return;
        held.delete(request);
        held.set(request, status);
        if (held.size > HELD_MAX) held.delete(held.keys().next().value as string);
    };

    // Every status goes out under the id of the request its checkout was started for, never under whichever request is newest
    const end = (update: Partial<PayLine>, status: string, request: string) => {
        busy = false;
        line.set({ ...NO_PAY_LINE, ...update });
        tellEnd(status, request);
    };

    const frameReady = () => {
        if (destroyed || !options.frame()) return;
        const waiting = [...held];
        held.clear();
        for (const [request, status] of waiting) tellRequest(status, request);
    };

    /**
     * Asks about an order every few seconds until it ends. Two things the asking alone cannot do are done here: the deadline has its own
     * clock, so a question that never gets an answer cannot keep "checking" past it, and a checkout tab the buyer closed gets its link back.
     */
    const watch = (orderId: string, checkout: { url: string; app: string; popup: Window | null }, request: string) => {
        let over = false;
        let linkBack = false;
        const finish = (update: Partial<PayLine>, status: string) => {
            // Whatever answers later never overwrites how this ended
            if (over || destroyed) return;
            over = true;
            if (timer) clearTimeout(timer);
            if (deadline) clearTimeout(deadline);
            if (tabWatch) clearInterval(tabWatch);
            end(update, status, request);
        };
        // Twenty minutes without an answer: said plainly, never a silent end. The order may still be counted later.
        deadline = setTimeout(() => finish({ problem: "cant_confirm" }, "cant_confirm"), POLL_FOR_MS);
        // The buyer closed the checkout tab before paying: the same checkout is offered again, so the payment is never out of reach.
        // Looked at on its own clock, so a status question that is slow to answer cannot hold the link back.
        if (checkout.popup) {
            tabWatch = setInterval(() => {
                if (over || destroyed || linkBack || checkout.popup?.closed !== true) return;
                linkBack = true;
                if (tabWatch) clearInterval(tabWatch);
                line.update((now) =>
                    now.checking ? { ...now, resume: { url: checkout.url, app: checkout.app } } : now
                );
            }, TAB_WATCH_MS);
        }
        const poll = async () => {
            if (over || destroyed) return;
            try {
                const answer: ArtifactPay = await pay(options.artifactId, options.chat(), { order: orderId });
                if (over || destroyed) return;
                if (answer.status === "paid") return finish({ paid: { test: answer.testPayment === true } }, "paid");
                if (answer.status === "not_paid") return finish({ problem: "not_paid" }, "not_paid");
                if (answer.status === "cant_confirm") return finish({ problem: "cant_confirm" }, "cant_confirm");
            } catch {
                // Try again on the next turn
            }
            if (!over && !destroyed) timer = setTimeout(() => void poll(), POLL_MS);
        };
        timer = setTimeout(() => void poll(), POLL_MS);
    };

    /** A checkout is on its way: the line says so, and its order is asked about until it ends. */
    const adopt = (orderId: string, url: string, app: string, popup: Window | null, request: string) => {
        busy = true;
        activeRequest = request;
        line.set({ ...NO_PAY_LINE, checking: true, resume: popup ? null : { url, app } });
        watch(orderId, { url, app, popup }, request);
    };

    const onMessage = (event: MessageEvent) => {
        const frame = options.frame();
        if (!frame || event.source !== frame) return;
        const data = event.data as { universe?: unknown; app?: unknown; request?: unknown } | null;
        if (!data || data.universe !== "use-app" || typeof data.app !== "string") return;
        // A request without a valid id of its own is never answered: there would be no way to tell whose answer it is
        if (typeof data.request !== "string" || !REQUEST_ID.test(data.request)) return;
        if (busy) {
            // The same tap heard twice is the same request. Another request while a checkout is on its way (or its start is still
            // waiting for an answer, however long it takes) is told so under its own id, and the checkout that is on its way keeps
            // its own: its result is never handed to the newer request.
            if (data.request !== activeRequest) tellRequest("busy", data.request);
            return;
        }
        busy = true;
        activeRequest = data.request;
        held.clear();
        // Opened now, in the same moment as the page's tap, so a blocked pop-up is the only thing left that can go wrong
        let popup: Window | null = null;
        try {
            popup = options.openWindow?.() ?? null;
            if (popup) popup.opener = null;
        } catch {
            popup = null;
        }
        const request = data.request;
        void (async () => {
            // The start is waited for as long as STALLED_START_FOR_MS. After START_FOR_MS the buyer's window says it is taking
            // longer and the blank pop-up is closed (the link is offered on the line instead); the page is told nothing until the
            // start ends: "started" with its checkout (taken up as any other), or one failure, once.
            let slowTimer: ReturnType<typeof setTimeout> | undefined;
            let giveUpTimer: ReturnType<typeof setTimeout> | undefined;
            const abort = new AbortController();
            const mine = {
                abort,
                clear: () => {
                    if (slowTimer) clearTimeout(slowTimer);
                    if (giveUpTimer) clearTimeout(giveUpTimer);
                },
            };
            startInFlight = mine;
            const started = pay(options.artifactId, options.chat(), { start: true }, abort.signal);
            const slow = new Promise<"slow">((resolve) => {
                slowTimer = setTimeout(() => resolve("slow"), START_FOR_MS);
            });
            // Taken up in whichever way the start ends, so a late answer never leaves an unhandled rejection
            started.catch(() => undefined);
            try {
                let answer: ArtifactPay;
                const first = await Promise.race([started, slow]);
                if (first === "slow") {
                    popup?.close();
                    popup = null;
                    if (!destroyed) line.set({ ...NO_PAY_LINE, checking: true, slow: true });
                    const gaveUp = new Promise<"gave_up">((resolve) => {
                        giveUpTimer = setTimeout(() => resolve("gave_up"), STALLED_START_FOR_MS - START_FOR_MS);
                    });
                    const second = await Promise.race([started, gaveUp]);
                    if (second === "gave_up") {
                        // Dropped for good: its answer is never read, so no link to an order it may have made reaches anyone
                        abort.abort();
                        if (!destroyed) end({ problem: "unavailable" }, "unavailable", request);
                        return;
                    }
                    answer = second;
                } else {
                    answer = first;
                }
                mine.clear();
                const url = safeCheckout(answer.checkoutUrl);
                if (destroyed) {
                    popup?.close();
                    return;
                }
                if (!answer.orderId || !url) {
                    popup?.close();
                    return end({ problem: "unavailable" }, "unavailable", request);
                }
                if (popup) popup.location.href = url;
                adopt(answer.orderId, url, answer.app ?? "", popup, request);
                tellRequest("started", request);
            } catch (error) {
                popup?.close();
                if (destroyed) return;
                const limit = error instanceof ArtifactRequestError && (error.code === "limit" || error.status === 429);
                end({ problem: limit ? "limit" : "unavailable" }, limit ? "limit" : "unavailable", request);
            } finally {
                mine.clear();
                if (startInFlight === mine) startInFlight = undefined;
            }
        })();
    };

    return {
        line: { subscribe: line.subscribe },
        onMessage,
        frameReady,
        destroy() {
            destroyed = true;
            held.clear();
            // A start that is still waiting for its answer is dropped too: its answer is never read
            startInFlight?.abort.abort();
            startInFlight?.clear();
            if (timer) clearTimeout(timer);
            if (deadline) clearTimeout(deadline);
            if (tabWatch) clearInterval(tabWatch);
        },
    };
}
