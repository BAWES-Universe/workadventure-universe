import { writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { ArtifactRequestError, payOnArtifact } from "./ArtifactApi";
import type { ArtifactChat, ArtifactPay, ArtifactPayRequest } from "./ArtifactApi";

/**
 * The bridge between a page that takes payments and Universe, inside the game's artifact window (Keys for Apps, game #2044).
 * The page runs in a locked frame and can post one kind of message, in two forms:
 *
 *   page → window   { universe: "use-app", app, request, session }                 start the checkout its owner set up
 *   page → window   { universe: "use-app", app, request, session, restore: true }  get back a purchase this buyer already made (asked on load)
 *   window → page   { universe: "app-result", status, request, session, test? }
 *
 * `request` is a short id the page makes up for that tap, and every answer carries it back, so a page (a reloaded one, or one that asked
 * twice) never takes the result of another request as its own. `session` is one id the page's document makes for itself when its scripts
 * start (same plain-id rule): every answer carries it back and the page ignores one with another session, and a result of a request is told
 * only while the document that asked is still the one that spoke last. A message without a valid request id or session is never answered
 * and never starts anything: the line says the page needs an update. Statuses: started, paid, not_paid, cant_confirm, unavailable, limit, busy
 * (another request is on its way) and none (a restore found no purchase); `test: true` rides with `paid` for a test payment, so a page can
 * show a test preview and never unlock real goods. Everything real is decided on the server: only the frame of this window is listened to,
 * the amount and the service are the owner's (the message carries neither), and the page hears back only a status, never an address, a key,
 * an order or a recovery code. The purchase wish (`intentId`) is made here for each tap, never by the page, and a guest's recovery code lives
 * only in this browser (and in the receipt link they keep). Orbit's public page speaks exactly the same (its `page-payments-host`), and
 * the words on the line below the page are the same too (the approved mock M1).
 */

/** The id a page gives its request: short and plain, so it can only be echoed back and never carry anything else. */
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type PayProblem = "unavailable" | "limit" | "not_paid" | "cant_confirm" | "none";

/** What the window says under the page while a payment is on its way. */
export interface PayLine {
    /** A payment was started (or is being found again) and has not ended */
    checking: boolean;
    /** The start of the checkout is taking longer than usual: the page has been told nothing yet (it hears "started" or a failure, once) */
    slow: boolean;
    /** Why it did not go through, if it did not */
    problem: PayProblem | null;
    /** Where to go on when the pop-up was blocked or closed: the same checkout, in a new tab */
    resume: { url: string; app: string } | null;
    /** A payment was confirmed; `test` when it was made with a test key */
    paid: { test: boolean } | null;
    /** The page sends requests this window cannot answer (no request id of its own): it must be made again with the current instructions */
    needsUpdate: boolean;
    /** Check payment can be offered: the look ran out, the start answer was lost, or the page cannot ask for itself */
    canCheck: boolean;
    /** For a guest: the link to keep, which holds the recovery code (in its fragment, so no server ever receives it) */
    receipt: string | null;
    /** Who the buyer is: signed in, or a guest of this browser */
    buyer: "account" | "guest";
    /** The payment was found again (a reload, a new device) and was not made just now; `paidAt` says when, when known */
    restored: { paidAt: string | null } | null;
    /** The page asked for its purchase back and nothing was found by itself, or another page's ask was turned away as busy: Restore purchase is offered, quietly (it can be closed) */
    offerRestore: boolean;
}

export const NO_PAY_LINE: PayLine = {
    checking: false,
    slow: false,
    problem: null,
    resume: null,
    paid: null,
    needsUpdate: false,
    canCheck: false,
    receipt: null,
    buyer: "guest",
    restored: null,
    offerRestore: false,
};

/** How often an order is asked about, and for how long. The server asks the service itself at most once every few seconds. */
const FIRST_POLL_MS = 3_000;
/** The server's own `pollAfterMs` says how far apart (3 seconds at first, slowing to 15): never faster than one second or slower than thirty */
const LEAST_POLL_MS = 1_000;
const MOST_POLL_MS = 30_000;
const POLL_FOR_MS = 20 * 60_000;
/** A start whose answer was lost on the way (no answer at all) is sent again with the same wish this many times, so one order is made and never two */
const START_TRIES = 3;
const TRY_AGAIN_MS = 1_000;
/** How long the start of a checkout may wait for an answer before the window says it is taking longer (to the buyer only: the page is told nothing yet). */
const START_FOR_MS = 30_000;
/**
 * How long a question that is not a start (a status, a restore, a Check payment) waits for its answer. Past it the question is dropped
 * and counts as no answer, so a request that hangs never keeps the window busy or "checking" for good (it can be asked again).
 */
const STATUS_FOR_MS = 30_000;
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
/**
 * An early reload finds the buyer's own start unfinished (Orbit: `checking`, `own`, no checkout yet): Restore is asked again after the
 * answer's `pollAfterMs` (kept between these two), for this long in all, and then Check payment is offered
 */
const OWN_START_WAIT_MS = 20 * 60_000;
const OWN_START_POLL_MIN_MS = 1_000;
const OWN_START_POLL_MAX_MS = 60_000;
const OWN_START_POLL_DEFAULT_MS = 3_000;
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
    /**
     * Whether that frame has loaded the page it was drawn for. A frame has a window before its page is there (a new frame after
     * the Code view, a redraw, a new opening), and a message sent in that time goes to a blank or the previous document, where
     * nobody hears it: how a checkout ended is then held until the page has loaded (see `frameReady`).
     */
    loaded: () => boolean;
    /** Opens the checkout's window straight from the tap's moment; undefined when the browser blocked it. */
    openWindow?: () => Window | null;
    pay?: typeof payOnArtifact;
    /**
     * Which opening of the artifact is on show: a number that changes each time another version (or the same one again) is
     * opened. The page that asked for a checkout is gone with its opening, so how that checkout ends is never told to the page
     * of another one, whose own requests may use the same ids. The buyer's line is kept either way.
     */
    opening?: () => number;
    /** Whether the buyer is signed in (their account is then the buyer) or a guest (their recovery code is). Guest when not given. */
    buyer?: () => "account" | "guest";
    /** The address of the page anyone with the link may open, for a guest's receipt link (the code rides in its fragment: `#receipt=<code>`). None when the page is not shared that way. */
    pageUrl?: () => string | undefined;
    /** Where this browser keeps a guest's recovery code (localStorage); none means it lives only as long as this window. */
    storage?: Pick<Storage, "getItem" | "setItem"> | null;
    /** Random plain characters of a length (for wishes and recovery codes). */
    randomId?: (length: number) => string;
}

export interface PagePayments {
    line: Readable<PayLine>;
    onMessage: (event: MessageEvent) => void;
    /**
     * The artifact's frame is there and has loaded: what a checkout ended with while it was away (the buyer was reading the
     * code) is told to it now, once.
     */
    frameReady: () => void;
    /** The buyer pressed Check payment: where the order of their last checkout stands (or, with none in this window, what they have bought). */
    checkPayment: () => void;
    /** The buyer pressed Restore purchase. */
    restorePurchase: () => void;
    /** The buyer closed a line that can be closed (a quiet offer, or "no purchase found"). A payment on its way is never hidden. */
    dismiss: () => void;
    /** The receipt link to keep, when the buyer is a guest and the page can be opened by link: the code rides in the fragment. */
    receiptLink: () => string | undefined;
    destroy: () => void;
}

/** The code a guest's window keeps: plain characters only, long enough that nobody can guess it. Orbit stores only its hash. */
const RECOVERY_CODE = /^[A-Za-z0-9_-]{32,128}$/;

const defaultRandom = (length: number): string => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
};

const defaultStorage = (): Pick<Storage, "getItem" | "setItem"> | null => {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
};

const waitFor = (ms: number) =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });

export function pagePayments(options: PagePaymentsOptions): PagePayments {
    const pay = options.pay ?? payOnArtifact;
    const random = options.randomId ?? defaultRandom;
    const storage = options.storage === undefined ? defaultStorage() : options.storage;
    const storageKey = `universe-pay-recovery:${options.artifactId}`;
    // What Orbit said it used for whoever asked last ("account" or "guest"): read first, the window's own sign-in only when no answer said
    let askedAs: "account" | "guest" | undefined;
    const buyerKind = () => askedAs ?? options.buyer?.() ?? "guest";
    /**
     * Who made the purchase of the checkout on show: what Orbit said for its start, kept with it. A guest who paid and signs in later is
     * "account" to the questions that follow, but the purchase stays the guest's (it is kept under the recovery code): its receipt is still the guest's.
     */
    const purchaseBuyer = () => target?.buyer ?? buyerKind();
    const line = writable<PayLine>(NO_PAY_LINE);
    let current: PayLine = NO_PAY_LINE;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let tabWatch: ReturnType<typeof setInterval> | undefined;
    let destroyed = false;
    // The id the page gave the request that is on its way (or whose start has not ended): every status about it carries it,
    // and the opening it came from: a request of another opening is never taken for it
    let activeRequest = "";
    let activeFrom = 0;
    // The document the active operation was started for, held with it: the map of sessions by request can be overwritten by another document that
    // reuses the same request id, and a busy answer is decided by who the operation really belongs to
    let activeSession: string | undefined;
    // The start that is waiting for its answer: its request is dropped when the window goes away, and its timers stop
    let startInFlight: { abort: AbortController; clear: () => void } | undefined;
    // What Check payment asks about: the wish of the last checkout (when there is one in this window), and who asked for it
    // Each carries the session of the document that asked, taken when it asked: a later request of another document under the same id never takes it over
    let target: {
        intentId: string | null;
        request: string;
        from: number;
        session?: string;
        buyer?: "account" | "guest";
    } | null = null;
    // The last restore the page itself asked for: a Restore purchase that finds the purchase is told to the page under it
    let lastRestore: { request: string; from: number; session?: string } | null = null;
    // A page of another opening asked while a payment was on its way and was told so: Restore purchase is offered when this one ends
    let restoreOwed = false;
    // The restore that page asked for, kept as it asked: Restore purchase answers it, while that page is still the one on show
    // `latest` is the last request that same document made while turned away (its pay tap after its restore): its page waits on that one, so it hears the end under it too
    let deferredRestore: { request: string; from: number; session: string; latest?: string } | null = null;
    // The request the page that is being served made last while its payment was on its way, and was told busy: the page waits on that one now
    // (it dropped the id of the checkout it started), so a purchase that is found is told under it too. Cleared when a new request is taken.
    let lateAsker: { request: string; from: number; session: string } | null = null;
    let memoryCode: string | null = null;

    const publish = (next: PayLine) => {
        current = next;
        line.set(next);
    };
    /** The buyer's line, with what holds whatever it says: who the buyer is, and the receipt to keep when it is a guest's */
    const show = (update: Partial<PayLine>) =>
        publish({ ...NO_PAY_LINE, buyer: update.paid ? purchaseBuyer() : buyerKind(), ...update });

    /** The recovery code of this browser for this page: made once, kept, and never given to the page. */
    const recoveryCode = (): string => {
        // A code already made in this window's life is the code, whether or not the browser would keep it
        if (memoryCode) return memoryCode;
        try {
            const stored = storage?.getItem(storageKey);
            if (stored && RECOVERY_CODE.test(stored)) {
                memoryCode = stored;
                return stored;
            }
            memoryCode = random(43);
            storage?.setItem(storageKey, memoryCode);
        } catch {
            memoryCode = memoryCode ?? random(43);
        }
        return memoryCode;
    };

    const receiptLink = (): string | undefined => {
        if (purchaseBuyer() !== "guest") return undefined;
        const page = options.pageUrl?.();
        return page ? `${page.split("#")[0]}#receipt=${recoveryCode()}` : undefined;
    };

    /** One question to the server: the guest's code goes with every wish, check and restore (never with a look at an order) */
    const ask = (request: ArtifactPayRequest, signal?: AbortSignal, wanted: () => boolean = () => true) => {
        const body = request.order ? request : { ...request, recoveryCode: recoveryCode() };
        const asked = signal
            ? pay(options.artifactId, options.chat(), body, signal)
            : pay(options.artifactId, options.chat(), body);
        return asked.then((answer) => {
            // An answer that came after its question was given up on says nothing about who is asking now
            if (wanted() && (answer?.buyer === "account" || answer?.buyer === "guest")) askedAs = answer.buyer;
            return answer;
        });
    };

    /**
     * A question that is not a start, with a limit on the wait: when no answer comes in STATUS_FOR_MS it counts as no answer. The
     * question itself is left to the browser's own end (an answer that comes later is never read).
     */
    const askWithin = (request: ArtifactPayRequest, stillWanted: () => boolean = () => true): Promise<ArtifactPay> => {
        let stop: ReturnType<typeof setTimeout> | undefined;
        let givenUp = false;
        const timeout = new Promise<never>((_resolve, reject) => {
            stop = setTimeout(() => {
                givenUp = true;
                reject(new Error("no answer"));
            }, STATUS_FOR_MS);
        });
        // Taken up in whichever way it ends, so a late answer or a late timeout never leaves an unhandled rejection
        timeout.catch(() => undefined);
        const asked = Promise.resolve(ask(request, undefined, () => !givenUp && !destroyed && stillWanted()));
        asked.catch(() => undefined);
        return Promise.race([asked, timeout]).finally(() => {
            if (stop) clearTimeout(stop);
        });
    };

    // The frame has no origin of its own, so it can only be addressed with "*": the message holds nothing but a status and the
    // page's own request id. The page, not this window, decides what it trusts: only its parent, and only its own request.
    // The session each request came with (the id its document gave itself when its scripts started), and the session of the document that spoke
    // last: a result is told only while the document that asked is still the one that spoke last (no other document has spoken since)
    const sessions = new Map<string, string>();
    let speaker = "";
    const SESSIONS_MAX = 32;
    const remember = (request: string, session: string) => {
        sessions.delete(request);
        sessions.set(request, session);
        if (sessions.size > SESSIONS_MAX) sessions.delete(sessions.keys().next().value as string);
    };
    const stillSpeaking = (request: string, session = sessions.get(request)) =>
        session !== undefined && session === speaker;
    const tellRequest = (status: string, request: string, test = false, session = sessions.get(request)) =>
        options.frame()?.postMessage(
            {
                universe: "app-result",
                status,
                request,
                ...(session ? { session } : {}),
                ...(test ? { test: true } : {}),
            },
            "*"
        );

    // How a checkout ended, when this artifact's frame was not there to hear it (the buyer was looking at the code, or the frame
    // was being drawn again, or its page has not loaded yet): kept for this artifact's own frame, by the request it was started for, and told to it when it is
    // there again. Told once and forgotten; a new request from the page also forgets it (the page asked again, so it has heard).
    // Never sent to any other window: the frame is always asked from the artifact's own element.
    const held = new Map<string, { status: string; from: number; test: boolean; session?: string }>();
    const opening = () => options.opening?.() ?? 0;
    const HELD_MAX = 8;

    // How a checkout ended is the page's only word of it, so it is never dropped for want of a frame
    const tellEnd = (status: string, request: string, from: number, test = false, asker = sessions.get(request)) => {
        // The page that asked is gone with its opening: nobody is told
        if (opening() !== from) return;
        // Another document has spoken since: the one that asked is gone, and nobody is told
        if (!stillSpeaking(request, asker)) return;
        if (options.frame() && options.loaded()) return tellRequest(status, request, test, asker);
        if (destroyed) return;
        held.delete(request);
        held.set(request, { status, from, test, session: asker });
        if (held.size > HELD_MAX) held.delete(held.keys().next().value as string);
    };

    /** What a payment that ends owes the page that was turned away while it ran: Restore purchase, unless it ended paid. Owed once. */
    const owedRestore = (update: Partial<PayLine>): Partial<PayLine> => {
        const owed = restoreOwed && !update.paid;
        restoreOwed = false;
        return owed ? { offerRestore: true } : {};
    };

    /**
     * A restore that was turned away while this payment ran is answered when the payment ends paid: that page was told "busy", and
     * would stay on its pay button for a purchase that is made. Told under its own request and session, once.
     */
    const tellDeferredPaid = (test: boolean, ...told: string[]) => {
        const waiting = deferredRestore;
        deferredRestore = null;
        if (waiting && waiting.from === opening() && stillSpeaking(waiting.request, waiting.session)) {
            // What was just told under its request is not told twice
            if (!told.includes(waiting.request)) tellEnd("paid", waiting.request, waiting.from, test, waiting.session);
            if (waiting.latest && waiting.latest !== waiting.request && !told.includes(waiting.latest)) {
                tellEnd("paid", waiting.latest, waiting.from, test, waiting.session);
            }
        }
    };

    /**
     * The purchase is made: the page that asked something else while it was on its way (and was told busy) waits on that request, and hears
     * it under it too, once. Only a purchase is told this way: any other end says nothing the page that moved on could use.
     */
    const tellLatestPaid = (test: boolean, ...told: string[]) => {
        const one = lateAsker;
        if (!one) return;
        lateAsker = null;
        if (!told.includes(one.request) && one.from === opening() && stillSpeaking(one.request, one.session)) {
            tellEnd("paid", one.request, one.from, test, one.session);
        }
    };

    // Every status goes out under the id of the request its checkout was started for, never under whichever request is newest
    const end = (
        update: Partial<PayLine>,
        status: string,
        request: string,
        from: number,
        test = false,
        asker?: string
    ) => {
        busy = false;
        activeRequest = "";
        activeSession = undefined;
        show({
            ...owedRestore(update),
            ...update,
            receipt: update.paid && !update.paid.test && !update.restored ? receiptLink() ?? null : null,
        });
        tellEnd(status, request, from, test, asker ?? sessions.get(request));
        if (update.paid) {
            tellDeferredPaid(test, request);
            tellLatestPaid(test, request);
        }
    };

    const frameReady = () => {
        if (destroyed || !options.frame() || !options.loaded()) return;
        const waiting = [...held];
        held.clear();
        for (const [request, one] of waiting)
            if (one.from === opening() && stillSpeaking(request, one.session)) {
                tellRequest(one.status, request, one.test, one.session);
            }
    };

    interface Checkout {
        url: string;
        app: string;
        popup: Window | null;
    }

    /**
     * Asks about an order every few seconds until it ends. Two things the asking alone cannot do are done here: the deadline has its own
     * clock, so a question that never gets an answer cannot keep "checking" past it, and a checkout tab the buyer closed gets its link back.
     */
    const watch = (orderId: string, checkout: Checkout | null, request: string, from: number, asker?: string) => {
        let over = false;
        let linkBack = false;
        const finish = (update: Partial<PayLine>, status: string, test = false) => {
            // Whatever answers later never overwrites how this ended
            if (over || destroyed) return;
            over = true;
            if (timer) clearTimeout(timer);
            if (deadline) clearTimeout(deadline);
            if (tabWatch) clearInterval(tabWatch);
            end(update, status, request, from, test, asker);
        };
        // Twenty minutes without an answer: said plainly, never a silent end. The order may still be counted later, which Check payment finds.
        deadline = setTimeout(() => finish({ problem: "cant_confirm", canCheck: true }, "cant_confirm"), POLL_FOR_MS);
        // The buyer closed the checkout tab before paying: the same checkout is offered again, so the payment is never out of reach.
        // Looked at on its own clock, so a status question that is slow to answer cannot hold the link back.
        if (checkout?.popup) {
            const tab = checkout.popup;
            tabWatch = setInterval(() => {
                if (over || destroyed || linkBack || tab.closed !== true) return;
                linkBack = true;
                if (tabWatch) clearInterval(tabWatch);
                if (current.checking) publish({ ...current, resume: { url: checkout.url, app: checkout.app } });
            }, TAB_WATCH_MS);
        }
        const poll = async () => {
            if (over || destroyed) return;
            let next = FIRST_POLL_MS;
            try {
                // An answer that comes after the watch has ended (its deadline, say) says nothing about who is asking now: a new checkout may have started
                const answer: ArtifactPay = await askWithin({ order: orderId }, () => !over);
                if (over || destroyed) return;
                // How far apart to ask is the server's word: short for a new order, longer the longer it waits
                if (typeof answer.pollAfterMs === "number" && Number.isFinite(answer.pollAfterMs)) {
                    next = Math.min(MOST_POLL_MS, Math.max(LEAST_POLL_MS, answer.pollAfterMs));
                }
                const test = answer.testPayment === true;
                // An order that was adopted with no link (a restore found it before its checkout existed) gets its Continue link once an answer carries one
                if (answer.status === "checking" && current.checking && !current.resume && !checkout?.popup) {
                    const link = safeCheckout(answer.checkoutUrl);
                    if (link) publish({ ...current, resume: { url: link, app: answer.app ?? "" } });
                }
                if (answer.status === "paid") return finish({ paid: { test } }, "paid", test);
                if (answer.status === "not_paid") return finish({ problem: "not_paid", canCheck: true }, "not_paid");
                if (answer.status === "cant_confirm") {
                    return finish({ problem: "cant_confirm", canCheck: true }, "cant_confirm");
                }
            } catch {
                // Try again on the next turn
            }
            if (!over && !destroyed) timer = setTimeout(() => void poll(), next);
        };
        timer = setTimeout(() => void poll(), FIRST_POLL_MS);
    };

    /** A checkout is on its way: the line says so, and its order is asked about until it ends. */
    const adopt = (orderId: string, checkout: Checkout | null, request: string, from: number, asker?: string) => {
        busy = true;
        activeRequest = request;
        activeFrom = from;
        activeSession = asker ?? sessions.get(request);
        show({ checking: true, resume: checkout && !checkout.popup ? { url: checkout.url, app: checkout.app } : null });
        watch(orderId, checkout, request, from, asker);
    };

    /** The link of an order that is still open, when the answer holds one the window may open (plain https only). */
    const resumeOf = (answer: ArtifactPay): Checkout | null => {
        const url = safeCheckout(answer.checkoutUrl);
        return url ? { url, app: answer.app ?? "", popup: null } : null;
    };

    /**
     * No answer ever came: the connection dropped, or the browser gave up (the api says so as status 0, "offline"), as against an answer
     * of the server's, whatever it says. Only then may the order exist without the window knowing it.
     */
    const gotNoAnswer = (error: unknown) => !(error instanceof ArtifactRequestError) || error.status === 0;

    /** A start that got no answer at all is sent again with the same wish; an answer, whatever it says, is final. */
    const startWithTries = async (intentId: string, signal: AbortSignal, attempt = 1): Promise<ArtifactPay> => {
        try {
            // The answer of a start that was dropped says nothing about who the buyer is
            return await ask({ start: true, intentId }, signal, () => !signal.aborted);
        } catch (error) {
            if (!gotNoAnswer(error) || signal.aborted || destroyed || attempt >= START_TRIES) {
                throw error;
            }
            await waitFor(TRY_AGAIN_MS);
            if (signal.aborted || destroyed) throw error;
            return startWithTries(intentId, signal, attempt + 1);
        }
    };

    const begin = (request: string, from: number) => {
        busy = true;
        activeRequest = request;
        activeFrom = from;
        deferredRestore = null;
        lateAsker = null;
        held.clear();
        // The wish for this tap: made here, never by the page. A start sent again after a lost answer carries the same one, so it finds the order it made
        const intentId = random(24);
        // The document that asked, taken now: the end of this checkout is told to it, whoever uses the same request id later
        const asker = sessions.get(request);
        activeSession = asker;
        target = { intentId, request, from, session: asker };
        // Opened now, in the same moment as the page's tap, so a blocked pop-up is the only thing left that can go wrong
        let popup: Window | null = null;
        try {
            popup = options.openWindow?.() ?? null;
            if (popup) popup.opener = null;
        } catch {
            popup = null;
        }
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
            const started = startWithTries(intentId, abort.signal);
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
                    if (!destroyed) show({ checking: true, slow: true });
                    const gaveUp = new Promise<"gave_up">((resolve) => {
                        giveUpTimer = setTimeout(() => resolve("gave_up"), STALLED_START_FOR_MS - START_FOR_MS);
                    });
                    const second = await Promise.race([started, gaveUp]);
                    if (second === "gave_up") {
                        // Dropped for good: its answer is never read, so no link to an order it may have made reaches anyone. The same wish
                        // can still be asked about with Check payment
                        abort.abort();
                        if (!destroyed)
                            end({ problem: "unavailable", canCheck: true }, "unavailable", request, from, false, asker);
                        return;
                    }
                    answer = second;
                } else {
                    answer = first;
                }
                mine.clear();
                // Who made this purchase, as Orbit says for its start: kept with the checkout for its receipt
                if (
                    (answer.buyer === "account" || answer.buyer === "guest") &&
                    target?.request === request &&
                    target.from === from
                ) {
                    target.buyer = answer.buyer;
                }
                const url = safeCheckout(answer.checkoutUrl);
                if (destroyed) {
                    popup?.close();
                    return;
                }
                if (!answer.orderId || !url) {
                    popup?.close();
                    // An answer with no checkout to show may still stand for an order that is paid: it can be checked
                    return end({ problem: "unavailable", canCheck: true }, "unavailable", request, from, false, asker);
                }
                if (popup) popup.location.href = url;
                adopt(answer.orderId, { url, app: answer.app ?? "", popup }, request, from, asker);
                if (opening() === from && stillSpeaking(request)) tellRequest("started", request);
            } catch (error) {
                popup?.close();
                if (destroyed) return;
                const limit = error instanceof ArtifactRequestError && (error.code === "limit" || error.status === 429);
                // No answer ever came (not even after the same wish was sent again): an order may or may not have been made, and the wish can be asked about
                // Orbit says "unsure" when it refused a start that may still have made an order: Check payment stays; without it the refusal is clear
                const lost = gotNoAnswer(error) || (error instanceof ArtifactRequestError && error.unsure);
                end(
                    { problem: limit ? "limit" : "unavailable", ...(lost ? { canCheck: true } : {}) },
                    limit ? "limit" : "unavailable",
                    request,
                    from,
                    false,
                    asker
                );
            } finally {
                mine.clear();
                if (startInFlight === mine) startInFlight = undefined;
            }
        })();
    };

    const unfinishedOwnStart = (answer: ArtifactPay) =>
        answer.status === "checking" && answer.via === "own" && !safeCheckout(answer.checkoutUrl);

    /**
     * Restore found the buyer's own start unfinished: Restore is asked again (not the order's status: there is no checkout to watch yet) until
     * the checkout comes, the purchase is found, or OWN_START_WAIT_MS has passed (null: the buyer can Check payment). A question that got no
     * answer is asked again; an answer that is a refusal ends it. A receipt's order (`via: receipt`) is never asked again here.
     */
    const followOwnStart = async (
        answer: ArtifactPay,
        ends = Date.now() + OWN_START_WAIT_MS
    ): Promise<ArtifactPay | null> => {
        if (!unfinishedOwnStart(answer)) return answer;
        if (destroyed || Date.now() >= ends) return null;
        show({ checking: true });
        const wait = answer.pollAfterMs ?? OWN_START_POLL_DEFAULT_MS;
        // Never past the end of the wait: the last answer comes just before it, and what it asks for is not asked after it
        await waitFor(
            Math.min(Math.max(wait, OWN_START_POLL_MIN_MS), OWN_START_POLL_MAX_MS, Math.max(0, ends - Date.now()))
        );
        if (destroyed || Date.now() >= ends) return null;
        try {
            return await followOwnStart(await askWithin({ restore: true }), ends);
        } catch (error) {
            // No answer: the same is asked again. Anything else (a refusal) ends it
            return gotNoAnswer(error) ? followOwnStart(answer, ends) : null;
        }
    };

    /** A page asking for a purchase this buyer already made (a reload, a reopened version): found by the buyer, never by anything the page chose. */
    const restore = (request: string, from: number) => {
        busy = true;
        activeRequest = request;
        activeFrom = from;
        const asker = sessions.get(request);
        activeSession = asker;
        lastRestore = { request, from, session: asker };
        deferredRestore = null;
        lateAsker = null;
        held.clear();
        void (async () => {
            try {
                let answer = await askWithin({ restore: true });
                if (destroyed) return;
                if (unfinishedOwnStart(answer)) {
                    const followed = await followOwnStart(answer);
                    if (destroyed) return;
                    if (!followed) {
                        return end(
                            { problem: "unavailable", canCheck: true },
                            "unavailable",
                            request,
                            from,
                            false,
                            asker
                        );
                    }
                    answer = followed;
                }
                const test = answer.testPayment === true;
                if (answer.status === "paid") {
                    return end(
                        { paid: { test }, restored: { paidAt: answer.paidAt ?? null } },
                        "paid",
                        request,
                        from,
                        test,
                        asker
                    );
                }
                // Nothing found by itself (a new phone, a cleared browser): the page is told so, and the buyer is offered Restore purchase, quietly
                if (answer.status === "none") return end({ offerRestore: true }, "none", request, from, false, asker);
                if (answer.status === "checking" && answer.orderId) {
                    // An order of theirs is still open: it is watched like a new checkout, and the page hears how it ends under this request.
                    // Its own link is offered, so a reload or a lost pop-up goes on with the SAME order and does not need a second one
                    target = { intentId: null, request, from, session: asker };
                    return adopt(answer.orderId, resumeOf(answer), request, from, asker);
                }
                end({ problem: "unavailable", canCheck: true }, "unavailable", request, from, false, asker);
            } catch {
                if (!destroyed) {
                    end({ problem: "unavailable", canCheck: true }, "unavailable", request, from, false, asker);
                }
            }
        })();
    };

    const onMessage = (event: MessageEvent) => {
        const frame = options.frame();
        if (destroyed || !frame || event.source !== frame) return;
        const data = event.data as {
            universe?: unknown;
            app?: unknown;
            request?: unknown;
            session?: unknown;
            restore?: unknown;
        } | null;
        if (!data || data.universe !== "use-app" || typeof data.app !== "string") return;
        // A request without a valid id of its own, or without the session its document gave itself, is never answered: there would be no way to tell
        // whose answer it is, and a bare status would be taken for whichever request the page is waiting on. The buyer is told so on the window's
        // own line, and can still check a payment.
        if (
            typeof data.request !== "string" ||
            !REQUEST_ID.test(data.request) ||
            typeof data.session !== "string" ||
            !REQUEST_ID.test(data.session)
        ) {
            if (!busy) show({ needsUpdate: true, canCheck: true });
            else publish({ ...current, needsUpdate: true, canCheck: true });
            return;
        }
        // The document that spoke last: what comes of an older document's request is told to nobody
        const session = data.session;
        const askedBefore = activeSession;
        speaker = session;
        if (busy) {
            // The same tap heard twice, in the same opening, is the same request. Anything else while a payment is on its way (or its start
            // is still waiting for an answer, however long it takes) is told so under its own id, and the one on its way keeps its own:
            // its result is never handed to the newer request. A page of another opening that is turned away can still use Restore purchase.
            // The same id from another document (another session) is another request too.
            if (data.request !== activeRequest || activeFrom !== opening() || session !== askedBefore) {
                tellRequest("busy", data.request, false, session);
                // The same page asked something else while its own payment is on its way: it waits on this request now
                if (activeFrom === opening() && session === askedBefore) {
                    lateAsker = { request: data.request, from: opening(), session };
                }
                if (activeFrom !== opening() || session !== askedBefore) {
                    restoreOwed = true;
                    // Its own restore, as it asked: Restore purchase answers that page under its own request, while it is the page on show
                    if (data.restore === true) deferredRestore = { request: data.request, from: opening(), session };
                    // The same document asked for something else since (its pay tap): it waits on that request now, and hears the end under it too
                    else if (
                        deferredRestore &&
                        deferredRestore.session === session &&
                        deferredRestore.from === opening()
                    ) {
                        deferredRestore.latest = data.request;
                    }
                }
            }
            return;
        }
        remember(data.request, session);
        // The opening the page is in now: what comes of this request is for that page alone
        const from = opening();
        if (data.restore === true) return restore(data.request, from);
        begin(data.request, from);
    };

    /**
     * Asks again. Check payment asks about the wish of the last checkout when there is one; otherwise (a reload, or a page that cannot ask)
     * about whatever this buyer has bought, which is also all Restore purchase asks. A purchase found that way is "back", not made just now.
     */
    const askAgain = (restoring: boolean) => {
        if (destroyed || busy) return;
        const none: { intentId: string | null; request: string; from: number; session?: string } = {
            intentId: null,
            request: "",
            from: -1,
        };
        // A restore that was turned away while a payment was on its way is answered under its own request, when its page is still the one on show
        const deferred =
            restoring &&
            deferredRestore &&
            deferredRestore.from === opening() &&
            stillSpeaking(deferredRestore.request, deferredRestore.session)
                ? deferredRestore
                : null;
        if (deferred) remember(deferred.request, deferred.session);
        const asked = deferred
            ? { intentId: null, ...deferred }
            : restoring
            ? lastRestore
                ? { intentId: null, ...lastRestore }
                : none
            : // After a failed first look the page has no checkout of its own: the purchase found is told under the request that asked for it back
              target ?? (lastRestore ? { intentId: null, ...lastRestore } : none);
        busy = true;
        activeRequest = asked.request;
        activeFrom = asked.from;
        activeSession = asked.session;
        show({ checking: true });
        // A lookup that could not be made keeps the restore that was turned away: the buyer's next try (Restore purchase, or Check payment) goes on with
        // that page's request, and not with the wish of the checkout before it. Only a lookup that gave an answer lets it go.
        const keepRestore = () => {
            if (!deferred) return;
            deferredRestore ??= deferred;
            lastRestore = { request: deferred.request, from: deferred.from, session: deferred.session };
            target = null;
        };
        const lettingGo = () => {
            if (
                deferredRestore &&
                deferredRestore.request === asked.request &&
                deferredRestore.session === asked.session
            )
                deferredRestore = null;
        };
        void (async () => {
            const settle = (update: Partial<PayLine>, told: string, test = false) => {
                busy = false;
                activeRequest = "";
                activeSession = undefined;
                if (told === "unavailable" || told === "cant_confirm") keepRestore();
                else if (!update.paid) lettingGo();
                show({
                    ...owedRestore(update),
                    ...update,
                    receipt: update.paid && !update.paid.test && !update.restored ? receiptLink() ?? null : null,
                });
                if (asked.request) tellEnd(told, asked.request, asked.from, test, asked.session);
                if (deferred?.latest && deferred.latest !== asked.request) {
                    tellEnd(told, deferred.latest, asked.from, test, asked.session);
                }
                if (update.paid) {
                    tellDeferredPaid(test, asked.request, deferred?.latest ?? "");
                    tellLatestPaid(test, asked.request, deferred?.latest ?? "");
                }
            };
            try {
                let answer = await askWithin(
                    asked.intentId ? { check: true, intentId: asked.intentId } : { restore: true }
                );
                if (destroyed) return;
                if (!asked.intentId && unfinishedOwnStart(answer)) {
                    const followed = await followOwnStart(answer);
                    if (destroyed) return;
                    if (!followed) return settle({ problem: "unavailable", canCheck: true }, "unavailable");
                    answer = followed;
                }
                const test = answer.testPayment === true;
                if (answer.status === "paid") {
                    return settle(
                        { paid: { test }, restored: asked.intentId ? null : { paidAt: answer.paidAt ?? null } },
                        "paid",
                        test
                    );
                }
                if (answer.status === "checking" && answer.orderId) {
                    // An order that was found by asking for the buyer's purchases is the one to ask about from now on, not the wish of an earlier checkout
                    if (!asked.intentId) {
                        target = { intentId: null, request: asked.request, from: asked.from, session: asked.session };
                    }
                    // The page turned away twice (its restore, then its pay tap) waits on its latest request: the end of this order is told under it too
                    if (deferred?.latest && deferred.latest !== asked.request) {
                        lateAsker = { request: deferred.latest, from: asked.from, session: deferred.session };
                    }
                    // Its restore is being watched now, under its own request: nothing is left to hand over at the end
                    lettingGo();
                    return adopt(answer.orderId, resumeOf(answer), asked.request, asked.from, asked.session);
                }
                if (answer.status === "not_paid" || answer.status === "cant_confirm") {
                    return settle({ problem: answer.status, canCheck: true }, answer.status);
                }
                if (answer.status === "none") return settle({ problem: "none", canCheck: !restoring }, "none");
                settle({ problem: "unavailable", canCheck: true }, "unavailable");
            } catch (error) {
                if (destroyed) return;
                // No order of this buyer's for that wish
                if (error instanceof ArtifactRequestError && error.status === 404) {
                    return settle({ problem: "none", canCheck: !restoring }, "none");
                }
                busy = false;
                activeRequest = "";
                activeSession = undefined;
                keepRestore();
                const update: Partial<PayLine> = { problem: "unavailable", canCheck: true };
                show({ ...owedRestore(update), ...update });
            }
        })();
    };

    return {
        line: { subscribe: line.subscribe },
        onMessage,
        frameReady,
        checkPayment: () => askAgain(false),
        restorePurchase: () => askAgain(true),
        dismiss() {
            // Only a line that says nothing is going on can be closed: a payment on its way is never hidden
            if (destroyed || busy) return;
            show({});
        },
        receiptLink,
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
