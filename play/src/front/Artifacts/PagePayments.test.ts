import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactRequestError } from "./ArtifactApi";
import type { ArtifactPay } from "./ArtifactApi";
import { pagePayments, safeCheckout } from "./PagePayments";

vi.mock("./ArtifactApi", () => {
    class ArtifactRequestError extends Error {
        constructor(public readonly status: number, public readonly code: string, public readonly unsure = false) {
            super(code);
        }
    }
    return { ArtifactRequestError, payOnArtifact: vi.fn() };
});

/** A browser's storage for one test, and ids that can be told apart: the first is "000…1" (a wish is 24 characters, a recovery code 43) */
const memoryStorage = () => {
    const kept = new Map<string, string>();
    return {
        getItem: (key: string) => kept.get(key) ?? null,
        setItem: (key: string, value: string) => void kept.set(key, value),
        kept,
    };
};
const counting = () => {
    let n = 0;
    return (length: number) => String(++n).padStart(length, "0");
};
const WISH_1 = "0".repeat(23) + "1";
const CODE = (n: number) => "0".repeat(42) + String(n);

const framePost = vi.fn();
const frameWindow = { postMessage: framePost } as unknown as Window;
const otherWindow = { postMessage: vi.fn() } as unknown as Window;

function ask(
    payments: ReturnType<typeof pagePayments>,
    source: Window = frameWindow,
    data: unknown = { universe: "use-app", app: "examplepay", request: "r1", session: "s1" }
) {
    payments.onMessage({ source, data } as unknown as MessageEvent);
}
const flush = async () => {
    await vi.advanceTimersByTimeAsync(0);
};
const toldAll = () =>
    (frameWindow.postMessage as ReturnType<typeof vi.fn>).mock.calls.map(
        (call) => call[0] as { universe: string; status: string; request?: string }
    );
const told = () =>
    (frameWindow.postMessage as ReturnType<typeof vi.fn>).mock.calls.map(
        (call) => (call[0] as { status: string }).status
    );

describe("a page that takes payments, in the game's window", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    const make = (pay: (...args: unknown[]) => Promise<ArtifactPay>, openWindow?: () => Window | null) =>
        pagePayments({
            artifactId: "a1",
            chat: () => undefined,
            frame: () => frameWindow,
            loaded: () => true,
            openWindow,
            pay: pay as never,
            storage: memoryStorage(),
            randomId: counting(),
        });

    it("opens only plain https checkouts", () => {
        expect(safeCheckout("https://checkout.examplepay.com/x?y=1")).toBe("https://checkout.examplepay.com/x?y=1");
        expect(safeCheckout("http://checkout.examplepay.com/x")).toBeUndefined();
        expect(safeCheckout("javascript:alert(1)")).toBeUndefined();
        expect(safeCheckout("https://user:pw@checkout.examplepay.com/x")).toBeUndefined();
        expect(safeCheckout("not a url")).toBeUndefined();
        expect(safeCheckout(null)).toBeUndefined();
    });

    it("listens only to its own frame, and only to the one message", async () => {
        const pay = vi.fn(() => Promise.resolve({} as ArtifactPay));
        const payments = make(pay);
        ask(payments, otherWindow);
        ask(payments, frameWindow, { universe: "other", app: "examplepay" });
        ask(payments, frameWindow, { universe: "use-app" });
        ask(payments, frameWindow, null);
        // No id of its own, or one that is not plain: no answer could be told apart, so none is given
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay" });
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "", session: "s1" });
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: 7, session: "s1" });
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "a b", session: "s1" });
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "x", session: "s1".repeat(65) });
        await flush();
        expect(pay).not.toHaveBeenCalled();
        expect(framePost).not.toHaveBeenCalled();
    });

    it("starts the owner's checkout, sends the buyer there, and tells the page only a status", async () => {
        const popup = { location: { href: "" }, close: vi.fn(), opener: {} } as unknown as Window;
        const pay = vi
            .fn()
            .mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" })
            .mockResolvedValueOnce({ status: "checking", checkoutUrl: null, testPayment: false })
            .mockResolvedValueOnce({ status: "paid", checkoutUrl: null, testPayment: true });
        const payments = make(pay, () => popup);
        ask(payments, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "r1",
            session: "s1",
            amount: "1.000",
            job: "x",
        });
        await flush();
        // The message carried no amount and none is sent
        expect(pay).toHaveBeenNthCalledWith(
            1,
            "a1",
            undefined,
            { start: true, intentId: expect.stringMatching(/^0+1$/), recoveryCode: expect.stringMatching(/^0+\d$/) },
            expect.any(AbortSignal)
        );
        expect(popup.location.href).toBe("https://checkout.examplepay.com/c1");
        expect(popup.opener).toBeNull();
        expect(get(payments.line)).toMatchObject({ checking: true, resume: null });
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(payments.line).checking).toBe(true);
        await vi.advanceTimersByTimeAsync(3_000);
        expect(pay).toHaveBeenNthCalledWith(3, "a1", undefined, { order: "o1" });
        expect(get(payments.line)).toMatchObject({ checking: false, paid: { test: true } });
        expect(told()).toEqual(["started", "paid"]);
        // Every status carries the page's own request id back
        expect(toldAll().map((m) => m.request)).toEqual(["r1", "r1"]);
        // Nothing but a status went to the page
        expect(JSON.stringify((frameWindow.postMessage as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(
            "checkout"
        );
    });

    it("goes on in a new tab with the same checkout when the pop-up was blocked", async () => {
        const pay = vi.fn().mockResolvedValueOnce({
            orderId: "o1",
            checkoutUrl: "https://checkout.examplepay.com/c1",
            app: "Example",
        });
        const payments = make(pay, () => null);
        ask(payments);
        await flush();
        expect(get(payments.line).resume).toEqual({ url: "https://checkout.examplepay.com/c1", app: "Example" });
        payments.destroy();
    });

    it("tells the result of an earlier checkout under its own request first, and a purchase also under the newer request the page waits on, after a reload or a second tap", async () => {
        const pay = vi
            .fn()
            .mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" })
            .mockResolvedValueOnce({ status: "paid", checkoutUrl: null, testPayment: false });
        const payments = make(pay, () => null);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "first", session: "s1" });
        await flush();
        // The page was reloaded (or asked again): it has a new id while the first checkout is still open
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "second", session: "s1" });
        // The same tap heard twice is not a new request
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "first", session: "s1" });
        await flush();
        expect(pay).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(3_000);
        // The newer request was told "busy", and the page waits on it now: it hears a purchase that is made, under its own id (never a status that is not a purchase)
        expect(toldAll()).toEqual([
            { universe: "app-result", status: "started", request: "first", session: "s1" },
            { universe: "app-result", status: "busy", request: "second", session: "s1" },
            { universe: "app-result", status: "paid", request: "first", session: "s1" },
            { universe: "app-result", status: "paid", request: "second", session: "s1" },
        ]);
    });

    it("never answers or starts for a request without the session its document gave itself, and says on its line that the page needs an update", async () => {
        const pay = vi
            .fn()
            .mockResolvedValue({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" });
        const payments = make(pay, () => null);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r1" });
        await flush();
        expect(pay).not.toHaveBeenCalled();
        expect(framePost).not.toHaveBeenCalled();
        expect(get(payments.line)).toMatchObject({ needsUpdate: true, canCheck: true });
        // Not a plain id either
        for (const session of ["", 7, "a b", "s".repeat(65), null]) {
            ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r2", session });
        }
        await flush();
        expect(pay).not.toHaveBeenCalled();
        expect(framePost).not.toHaveBeenCalled();
        payments.destroy();
    });

    it("tells every answer under its document's session, and tells nothing of an older document's checkout once another document has spoken", async () => {
        const pay = vi
            .fn()
            .mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" })
            .mockResolvedValueOnce({ status: "paid", checkoutUrl: null, testPayment: false });
        const payments = make(pay, () => null);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "first", session: "doc1" });
        await flush();
        // Another document (the page was reloaded): it is told busy under its own id and session, even with the same id as the first one
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "other", session: "doc2" });
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "first", session: "doc2" });
        await flush();
        expect(pay).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(3_000);
        // The first document's result is told to nobody, and no result of it reaches the second
        expect(toldAll()).toEqual([
            { universe: "app-result", status: "started", request: "first", session: "doc1" },
            { universe: "app-result", status: "busy", request: "other", session: "doc2" },
            { universe: "app-result", status: "busy", request: "first", session: "doc2" },
        ]);
        // The buyer's line still shows what happened, and offers Restore purchase to the document that was turned away
        expect(get(payments.line)).toMatchObject({ paid: { test: false } });
        payments.destroy();
    });

    it("answers the newer request under its own id once the earlier checkout has ended", async () => {
        const pay = vi
            .fn()
            .mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" })
            .mockResolvedValueOnce({ status: "not_paid", checkoutUrl: null, testPayment: false })
            .mockResolvedValueOnce({
                orderId: "o2",
                checkoutUrl: "https://checkout.examplepay.com/c2",
                app: "Example",
            });
        const payments = make(pay, () => null);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "first", session: "s1" });
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "second", session: "s1" });
        await flush();
        expect(toldAll().map((m) => `${m.request}:${m.status}`)).toEqual([
            "first:started",
            "first:not_paid",
            "second:started",
        ]);
        payments.destroy();
    });

    it("says so, and closes the pop-up, when the checkout cannot be made", async () => {
        const close = vi.fn();
        const popup = { location: { href: "" }, close } as unknown as Window;
        const pay = vi.fn().mockRejectedValueOnce(new ArtifactRequestError(409, "unavailable"));
        const payments = make(pay, () => popup);
        ask(payments);
        await flush();
        expect(close).toHaveBeenCalled();
        expect(get(payments.line).problem).toBe("unavailable");
        expect(told()).toEqual(["unavailable"]);
    });

    it("keeps Check payment for a refused start only when Orbit says an order may have been made ('unsure'); a clear refusal offers none", async () => {
        const unsure = make(vi.fn().mockRejectedValueOnce(new ArtifactRequestError(409, "unavailable", true)));
        ask(unsure);
        await flush();
        expect(get(unsure.line)).toMatchObject({ problem: "unavailable", canCheck: true });
        unsure.destroy();
        const clear = make(vi.fn().mockRejectedValueOnce(new ArtifactRequestError(409, "unavailable")));
        ask(clear);
        await flush();
        expect(get(clear.line)).toMatchObject({ problem: "unavailable", canCheck: false });
        clear.destroy();
    });

    it("says why when Orbit refuses because the payment was set on a version this person is not shown yet, and the page hears only unavailable", async () => {
        const close = vi.fn();
        const popup = { location: { href: "" }, close } as unknown as Window;
        const payments = make(
            vi.fn().mockRejectedValueOnce(new ArtifactRequestError(409, "not_published")),
            () => popup
        );
        ask(payments);
        await flush();
        expect(close).toHaveBeenCalled();
        expect(get(payments.line)).toMatchObject({ problem: "not_published", canCheck: false });
        expect(told()).toEqual(["unavailable"]);
        payments.destroy();
    });

    it("says it is too many tries on the server's own rate limit (429), however it words it", async () => {
        const limited = make(vi.fn().mockRejectedValueOnce(new ArtifactRequestError(429, "too_many_requests")));
        ask(limited);
        await flush();
        expect(get(limited.line).problem).toBe("limit");
        expect(told()).toEqual(["limit"]);
    });

    /** What the page's own code does with what it hears, as the recipe the Brick is given says: waiting only while "started" */
    const pageHears = (request: string) => {
        let waiting = request;
        const heard: string[] = [];
        for (const message of toldAll()) {
            if (!waiting || message.request !== waiting) continue;
            heard.push(message.status);
            if (message.status !== "started") waiting = "";
        }
        return heard;
    };
    /** A start that never answers on its own (its answer can be given by hand), and fails when it is dropped */
    const neverAnswers =
        (dropped: { value: boolean; answer?: (value: ArtifactPay) => void }) =>
        (_id: unknown, _chat: unknown, _request: unknown, signal: AbortSignal) =>
            new Promise<ArtifactPay>((resolve, reject) => {
                dropped.answer = resolve;
                const onAbort = () => {
                    signal.removeEventListener("abort", onAbort);
                    dropped.value = true;
                    reject(new ArtifactRequestError(0, "offline"));
                };
                signal.addEventListener("abort", onAbort);
            });

    /** A start that never answers on its own and, when it is dropped, stays pending: its answer can still arrive afterwards (the server made the order) */
    const holdsThenAnswers =
        (dropped: { value: boolean; answer?: (value: ArtifactPay) => void }) =>
        (_id: unknown, _chat: unknown, _request: unknown, signal: AbortSignal) =>
            new Promise<ArtifactPay>((resolve) => {
                dropped.answer = resolve;
                signal.onabort = () => {
                    dropped.value = true;
                };
            });

    it("does not stay starting when the server never answers the start: it says it is taking longer, tells the page nothing, then drops it and can be asked again", async () => {
        const close = vi.fn();
        const popup = { location: { href: "" }, close } as unknown as Window;
        const dropped = { value: false };
        const pay = vi.fn().mockImplementationOnce(neverAnswers(dropped)).mockResolvedValueOnce({
            orderId: "o2",
            checkoutUrl: "https://checkout.examplepay.com/c2",
            app: "Example",
        });
        const payments = make(pay, () => popup);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "first", session: "s1" });
        await flush();
        await vi.advanceTimersByTimeAsync(29_000);
        expect(get(payments.line)).toMatchObject({ checking: false, slow: false, problem: null });
        await vi.advanceTimersByTimeAsync(2_000);
        // The buyer's window says it is taking longer; the page has heard nothing, so it is still listening for its own request
        expect(get(payments.line)).toMatchObject({ checking: true, slow: true, problem: null, resume: null });
        expect(close).toHaveBeenCalled();
        expect(toldAll()).toEqual([]);
        // Its answer may still come, so no second checkout is made meanwhile: another request is told it is busy, under its own id
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "second", session: "s1" });
        await flush();
        expect(pay).toHaveBeenCalledTimes(1);
        expect(toldAll()).toEqual([{ universe: "app-result", status: "busy", request: "second", session: "s1" }]);
        // Dropped for good two minutes after the tap: the page hears "unavailable" once, and nothing is stuck
        await vi.advanceTimersByTimeAsync(90_000);
        expect(dropped.value).toBe(true);
        expect(get(payments.line)).toMatchObject({ checking: false, slow: false, problem: "unavailable" });
        expect(toldAll().at(-1)).toEqual({
            universe: "app-result",
            status: "unavailable",
            request: "first",
            session: "s1",
        });
        expect(pageHears("first")).toEqual(["unavailable"]);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "third", session: "s1" });
        await flush();
        expect(pay).toHaveBeenCalledTimes(2);
        payments.destroy();
    });

    it("takes up a checkout whose start answered late, under the request it was started for, and the page hears started and then paid", async () => {
        let answerLate: (value: ArtifactPay) => void = () => undefined;
        const pay = vi
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise<ArtifactPay>((resolve) => {
                        answerLate = resolve;
                    })
            )
            .mockResolvedValueOnce({ status: "checking", checkoutUrl: null, testPayment: false })
            .mockResolvedValue({ status: "paid", checkoutUrl: null, testPayment: false });
        const payments = make(pay, () => null);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "first", session: "s1" });
        await flush();
        await vi.advanceTimersByTimeAsync(31_000);
        // Taking longer, and the page has not been told it failed
        expect(get(payments.line)).toMatchObject({ checking: true, slow: true, problem: null });
        expect(toldAll()).toEqual([]);
        // The page taps again while the first start is still out: refused as busy, no second checkout is made
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "second", session: "s1" });
        await flush();
        expect(pay).toHaveBeenCalledTimes(1);
        answerLate({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" } as ArtifactPay);
        await flush();
        // The order is not lost: the window offers its link, and asks how it stands
        expect(get(payments.line)).toMatchObject({
            checking: true,
            slow: false,
            problem: null,
            resume: { url: "https://checkout.examplepay.com/c1", app: "Example" },
        });
        await vi.advanceTimersByTimeAsync(3_000);
        expect(pay).toHaveBeenCalledWith("a1", undefined, { order: "o1" });
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(payments.line).paid).toMatchObject({ test: false });
        // Everything about that order went out under the first request's id; the second heard "busy", and then the purchase under its own id
        expect(toldAll()).toEqual([
            { universe: "app-result", status: "busy", request: "second", session: "s1" },
            { universe: "app-result", status: "started", request: "first", session: "s1" },
            { universe: "app-result", status: "paid", request: "first", session: "s1" },
            { universe: "app-result", status: "paid", request: "second", session: "s1" },
        ]);
        // The page's own recipe keeps listening only while "started": it hears started, then paid, so it unlocks
        expect(pageHears("first")).toEqual(["started", "paid"]);
        payments.destroy();
    });

    it("never offers a late checkout to a page that was told 'unavailable': a start answered after it was dropped is never read", async () => {
        const dropped: { value: boolean; answer?: (value: ArtifactPay) => void } = { value: false };
        const pay = vi.fn().mockImplementationOnce(holdsThenAnswers(dropped));
        const payments = make(pay, () => null);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "first", session: "s1" });
        await flush();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(dropped.value).toBe(true);
        expect(pageHears("first")).toEqual(["unavailable"]);
        // The server made the order and its answer arrives anyway: nothing is offered, nothing is asked about, the page hears nothing more
        dropped.answer?.({
            orderId: "o1",
            checkoutUrl: "https://checkout.examplepay.com/c1",
            app: "Example",
        } as ArtifactPay);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(get(payments.line)).toMatchObject({ checking: false, resume: null, problem: "unavailable" });
        expect(pay).toHaveBeenCalledTimes(1);
        expect(told()).toEqual(["unavailable"]);
        payments.destroy();
    });

    it("makes exactly one link reach the buyer when an order was made while its answer was dropped and the buyer tries again", async () => {
        // The server makes an order for every start and returns its link only in the answer. The first answer is slower than the
        // window waits: it is dropped, and the second start makes its own order.
        const links: string[] = [];
        const dropped: { value: boolean; answer?: (value: ArtifactPay) => void } = { value: false };
        const pay = vi
            .fn()
            .mockImplementationOnce(holdsThenAnswers(dropped))
            .mockResolvedValueOnce({ orderId: "o2", checkoutUrl: "https://checkout.examplepay.com/c2", app: "Example" })
            .mockResolvedValue({ status: "paid", checkoutUrl: null, testPayment: false });
        const payments = make(pay, () => null);
        const stop = payments.line.subscribe((now) => {
            if (now.resume) links.push(now.resume.url);
        });
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "first", session: "s1" });
        await flush();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(dropped.value).toBe(true);
        // Only now can the buyer try again (a retry never runs beside the start that was waiting), and the page is listening anew
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "second", session: "s1" });
        await flush();
        // The first order's answer reaches nobody, even if it arrives now
        dropped.answer?.({
            orderId: "o1",
            checkoutUrl: "https://checkout.examplepay.com/c1",
            app: "Example",
        } as ArtifactPay);
        await vi.advanceTimersByTimeAsync(6_000);
        expect(links).toEqual(["https://checkout.examplepay.com/c2"]);
        expect(pay).not.toHaveBeenCalledWith("a1", undefined, { order: "o1" });
        expect(toldAll().map((one) => `${one.request}:${one.status}`)).toEqual([
            "first:unavailable",
            "second:started",
            "second:paid",
        ]);
        expect(pageHears("second")).toEqual(["started", "paid"]);
        stop();
        payments.destroy();
    });

    it("drops a start that is still waiting for its answer when the window goes away, however soon", async () => {
        const dropped = { value: false };
        let signalSeen: AbortSignal | undefined;
        const pay = vi
            .fn()
            .mockImplementationOnce((_id: unknown, _chat: unknown, _request: unknown, signal: AbortSignal) => {
                signalSeen = signal;
                return neverAnswers(dropped)(_id, _chat, _request, signal);
            });
        const payments = make(pay, () => null);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "first", session: "s1" });
        await flush();
        await vi.advanceTimersByTimeAsync(5_000);
        expect(signalSeen?.aborted).toBe(false);
        payments.destroy();
        expect(signalSeen?.aborted).toBe(true);
        expect(dropped.value).toBe(true);
        await vi.advanceTimersByTimeAsync(200_000);
        // Nothing is said and nothing is asked once it is gone
        expect(toldAll()).toEqual([]);
        expect(pay).toHaveBeenCalledTimes(1);
    });

    it("tells the page a failure that comes while the start is only slow, once", async () => {
        const pay = vi.fn().mockImplementationOnce(
            () =>
                new Promise<ArtifactPay>((_resolve, reject) => {
                    setTimeout(() => reject(new ArtifactRequestError(500, "failed")), 45_000);
                })
        );
        const payments = make(pay, () => null);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "first", session: "s1" });
        await flush();
        await vi.advanceTimersByTimeAsync(31_000);
        expect(get(payments.line).slow).toBe(true);
        await vi.advanceTimersByTimeAsync(15_000);
        expect(get(payments.line)).toMatchObject({ checking: false, slow: false, problem: "unavailable" });
        expect(told()).toEqual(["unavailable"]);
        payments.destroy();
    });

    it("never gives a late order the id of a request that was made after it, and takes a new request once it ended", async () => {
        let answerLate: (value: ArtifactPay) => void = () => undefined;
        const pay = vi
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise<ArtifactPay>((resolve) => {
                        answerLate = resolve;
                    })
            )
            .mockResolvedValueOnce({ status: "not_paid", checkoutUrl: null })
            .mockResolvedValueOnce({ orderId: "o2", checkoutUrl: "https://checkout.examplepay.com/c2", app: "Example" })
            .mockResolvedValue({ status: "paid", checkoutUrl: null, testPayment: false });
        const payments = make(pay, () => null);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "first", session: "s1" });
        await flush();
        await vi.advanceTimersByTimeAsync(31_000);
        answerLate({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" } as ArtifactPay);
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        // The late order ended as not paid, under the first id; only now is a new request taken, under its own id
        expect(toldAll().at(-1)).toEqual({
            universe: "app-result",
            status: "not_paid",
            request: "first",
            session: "s1",
        });
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "second", session: "s1" });
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        expect(toldAll().map((one) => `${one.request}:${one.status}`)).toEqual([
            "first:started",
            "first:not_paid",
            "second:started",
            "second:paid",
        ]);
        payments.destroy();
    });

    it("says it is too many tries on a limit, and refuses an address that is not https", async () => {
        const limited = make(vi.fn().mockRejectedValueOnce(new ArtifactRequestError(429, "limit")));
        ask(limited);
        await flush();
        expect(get(limited.line).problem).toBe("limit");

        const unsafe = make(
            vi.fn().mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "http://x.example/c", app: "Example" })
        );
        ask(unsafe);
        await flush();
        expect(get(unsafe.line).problem).toBe("unavailable");
    });

    it("takes one payment at a time, and ends on a payment that did not go through", async () => {
        const pay = vi
            .fn()
            .mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" })
            .mockResolvedValueOnce({ status: "not_paid", checkoutUrl: null, testPayment: false });
        const payments = make(pay, () => null);
        ask(payments);
        ask(payments);
        await flush();
        expect(pay).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(payments.line).problem).toBe("not_paid");
        // It can be asked again now
        pay.mockRejectedValueOnce(new ArtifactRequestError(409, "unavailable"));
        ask(payments);
        await flush();
        expect(pay).toHaveBeenCalledTimes(3);
    });

    it("says it could not confirm the payment when it is still not known after twenty minutes", async () => {
        const pay = vi
            .fn()
            .mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" })
            .mockResolvedValue({ status: "checking" });
        const payments = make(pay, () => null);
        ask(payments);
        await flush();
        await vi.advanceTimersByTimeAsync(21 * 60_000);
        expect(get(payments.line)).toMatchObject({ checking: false, problem: "cant_confirm" });
        expect(told().at(-1)).toBe("cant_confirm");
    });

    it("ends at the deadline even when a question to the server never gets an answer, and a late answer changes nothing", async () => {
        let answerLate: (value: ArtifactPay) => void = () => undefined;
        const pay = vi
            .fn()
            .mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" })
            .mockImplementationOnce(
                () =>
                    new Promise<ArtifactPay>((resolve) => {
                        answerLate = resolve;
                    })
            )
            // Every later question hangs too (each is dropped after thirty seconds and asked again, until the deadline)
            .mockImplementation(() => new Promise<ArtifactPay>(() => {}));
        const payments = make(pay, () => null);
        ask(payments);
        await flush();
        await vi.advanceTimersByTimeAsync(21 * 60_000);
        expect(get(payments.line)).toMatchObject({ checking: false, problem: "cant_confirm" });
        expect(told().at(-1)).toBe("cant_confirm");
        // The question answers after the deadline: what was said stays said
        answerLate({ status: "paid", checkoutUrl: null, testPayment: false } as ArtifactPay);
        await flush();
        expect(get(payments.line)).toMatchObject({ paid: null, problem: "cant_confirm" });
        expect(told().filter((status) => status === "paid")).toEqual([]);
        // The payment is free to be started again
        const before = pay.mock.calls.length;
        pay.mockResolvedValueOnce({ orderId: "o2", checkoutUrl: "https://checkout.examplepay.com/c2", app: "Example" });
        ask(payments);
        await flush();
        expect(pay).toHaveBeenCalledTimes(before + 1);
    });

    it("gives the same checkout back as a link when the buyer closes its tab before paying", async () => {
        const popup = { location: { href: "" }, close: vi.fn(), opener: {}, closed: false } as unknown as Window & {
            closed: boolean;
        };
        const pay = vi
            .fn()
            .mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" })
            .mockResolvedValue({ status: "checking", checkoutUrl: null, testPayment: false });
        const payments = make(pay, () => popup);
        ask(payments);
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        // The tab is still open: no link yet
        expect(get(payments.line)).toMatchObject({ checking: true, resume: null });
        popup.closed = true;
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(payments.line)).toMatchObject({
            checking: true,
            resume: { url: "https://checkout.examplepay.com/c1", app: "Example" },
        });
        payments.destroy();
    });

    it("gives the link back even while a status question has not been answered", async () => {
        const popup = { location: { href: "" }, close: vi.fn(), opener: {}, closed: false } as unknown as Window & {
            closed: boolean;
        };
        const pay = vi
            .fn()
            .mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" })
            .mockImplementation(
                () =>
                    new Promise<ArtifactPay>(() => {
                        // never answers
                    })
            );
        const payments = make(pay, () => popup);
        ask(payments);
        await flush();
        // The first status question goes out and never comes back
        await vi.advanceTimersByTimeAsync(3_000);
        expect(pay).toHaveBeenCalledTimes(2);
        popup.closed = true;
        await vi.advanceTimersByTimeAsync(1_000);
        expect(get(payments.line)).toMatchObject({
            checking: true,
            resume: { url: "https://checkout.examplepay.com/c1", app: "Example" },
        });
        payments.destroy();
    });

    it("stops asking when the window is closed", async () => {
        const pay = vi
            .fn()
            .mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" })
            .mockResolvedValue({ status: "checking" });
        const payments = make(pay, () => null);
        ask(payments);
        await flush();
        payments.destroy();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(pay).toHaveBeenCalledTimes(1);
    });
});

describe("how a checkout ended while the artifact's frame was away (Code view)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    const checkout = { orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" };
    // The window of the artifact's frame as it is now: none while the buyer reads the code
    let current: Window | undefined;
    // Which opening of the artifact is on show; another version coming on show changes it
    let showing = 1;
    // Whether the page in that frame has loaded
    let loadedNow = true;
    const make = (pay: (...args: unknown[]) => Promise<ArtifactPay>) =>
        pagePayments({
            artifactId: "a1",
            chat: () => undefined,
            frame: () => current,
            loaded: () => loadedNow,
            opening: () => showing,
            openWindow: () => null,
            pay: pay as never,
            storage: memoryStorage(),
            randomId: counting(),
        });

    beforeEach(() => {
        showing = 1;
        loadedNow = true;
    });

    it("keeps how it ended and tells the frame that comes back, under the request it was started for, once", async () => {
        current = frameWindow;
        const pay = vi
            .fn()
            .mockResolvedValueOnce(checkout)
            .mockResolvedValueOnce({ status: "paid", checkoutUrl: null, testPayment: false });
        const payments = make(pay);
        ask(payments);
        await flush();
        expect(told()).toEqual(["started"]);

        // The buyer goes to the code: no frame while the order is asked about
        current = undefined;
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(payments.line).paid).not.toBeNull();
        expect(told()).toEqual(["started"]);

        // And back: the frame loads and hears it, with the request id the page gave
        current = frameWindow;
        payments.frameReady();
        expect(toldAll().map((message) => [message.status, message.request])).toEqual([
            ["started", "r1"],
            ["paid", "r1"],
        ]);
        // Told once: another load of the frame does not say it again
        payments.frameReady();
        expect(told()).toEqual(["started", "paid"]);
    });

    it("keeps a payment that did not go through, and a start that failed, the same way", async () => {
        current = frameWindow;
        const failing = vi
            .fn()
            .mockResolvedValueOnce(checkout)
            .mockResolvedValueOnce({ status: "not_paid", checkoutUrl: null, testPayment: false });
        const first = make(failing);
        ask(first);
        await flush();
        current = undefined;
        await vi.advanceTimersByTimeAsync(3_000);
        current = frameWindow;
        first.frameReady();
        expect(told()).toEqual(["started", "not_paid"]);

        // A start that fails while the frame is away
        framePost.mockClear();
        let refuse: (error: Error) => void = () => {};
        const starting = vi.fn().mockImplementationOnce(
            () =>
                new Promise((_, reject) => {
                    refuse = reject;
                })
        );
        const second = make(starting);
        ask(second);
        await flush();
        current = undefined;
        refuse(new ArtifactRequestError(409, "unavailable"));
        await flush();
        expect(told()).toEqual([]);
        current = frameWindow;
        second.frameReady();
        expect(told()).toEqual(["unavailable"]);
    });

    it("tells nothing to a frame that is not there, and nothing after the window is gone", async () => {
        current = frameWindow;
        const pay = vi
            .fn()
            .mockResolvedValueOnce(checkout)
            .mockResolvedValueOnce({ status: "paid", checkoutUrl: null, testPayment: false });
        const payments = make(pay);
        ask(payments);
        await flush();
        current = undefined;
        await vi.advanceTimersByTimeAsync(3_000);
        // The frame is still away: nothing is sent anywhere
        payments.frameReady();
        expect(told()).toEqual(["started"]);
        payments.destroy();
        current = frameWindow;
        payments.frameReady();
        expect(told()).toEqual(["started"]);
    });

    it("never tells the page of another opening how a checkout ended, held or live; the buyer's line stays", async () => {
        current = frameWindow;
        const pay = vi
            .fn()
            .mockResolvedValueOnce(checkout)
            .mockResolvedValueOnce({ status: "paid", checkoutUrl: null, testPayment: false });
        const payments = make(pay);
        ask(payments);
        await flush();
        expect(told()).toEqual(["started"]);

        // Version 2 comes on show (a new frame, its own page that may use the same request ids)
        showing = 2;
        // Live: the frame is there, and the status is not for it
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(payments.line).paid).not.toBeNull();
        expect(told()).toEqual(["started"]);
        payments.frameReady();
        expect(told()).toEqual(["started"]);
    });

    it("drops a held status when another opening comes on show before the frame is back", async () => {
        current = frameWindow;
        const pay = vi
            .fn()
            .mockResolvedValueOnce(checkout)
            .mockResolvedValueOnce({ status: "paid", checkoutUrl: null, testPayment: false });
        const payments = make(pay);
        ask(payments);
        await flush();
        current = undefined;
        await vi.advanceTimersByTimeAsync(3_000);
        // Held for the page that asked; then another version opens and its frame loads
        showing = 2;
        current = frameWindow;
        payments.frameReady();
        expect(told()).toEqual(["started"]);
    });

    it.each([
        ["paid", { status: "paid", checkoutUrl: null, testPayment: false }],
        ["not_paid", { status: "not_paid", checkoutUrl: null, testPayment: false }],
        ["cant_confirm", { status: "cant_confirm", checkoutUrl: null }],
    ])(
        "holds '%s' while the frame has a window but its page has not loaded, and tells it once when the page has loaded",
        async (status, ending) => {
            current = frameWindow;
            const pay = vi.fn().mockResolvedValueOnce(checkout).mockResolvedValueOnce(ending);
            const payments = make(pay);
            ask(payments);
            await flush();
            expect(told()).toEqual(["started"]);

            // The frame is drawn again: it has a window, and its page is not there yet
            loadedNow = false;
            await vi.advanceTimersByTimeAsync(3_000);
            expect(told()).toEqual(["started"]);
            // A load that is not this frame's page yet tells nothing either
            payments.frameReady();
            expect(told()).toEqual(["started"]);

            loadedNow = true;
            payments.frameReady();
            expect(toldAll().map((message) => [message.status, message.request])).toEqual([
                ["started", "r1"],
                [status, "r1"],
            ]);
            payments.frameReady();
            expect(told()).toEqual(["started", status]);
        }
    );

    it("does not tell a result held for opening 1 once opening 2 is on show", async () => {
        current = frameWindow;
        const pay = vi
            .fn()
            .mockResolvedValueOnce(checkout)
            .mockResolvedValueOnce({ status: "paid", checkoutUrl: null, testPayment: false });
        const payments = make(pay);
        ask(payments);
        await flush();
        loadedNow = false;
        await vi.advanceTimersByTimeAsync(3_000);
        showing = 2;
        loadedNow = true;
        payments.frameReady();
        expect(told()).toEqual(["started"]);
    });

    it("does not tell 'started' to a page of another opening when the start answers late", async () => {
        current = frameWindow;
        let answer: (value: ArtifactPay) => void = () => {};
        const pay = vi.fn().mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    answer = resolve as (value: ArtifactPay) => void;
                })
        );
        const payments = make(pay);
        ask(payments);
        await flush();
        showing = 2;
        answer(checkout as unknown as ArtifactPay);
        await flush();
        expect(told()).toEqual([]);
    });
});

describe("buying, checking and getting a purchase back, in the game's window (the approved mock M1)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    const checkout = { orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" };
    const SOFT = new ArtifactRequestError(409, "unavailable");
    let showing = 1;
    beforeEach(() => {
        showing = 1;
    });
    const make = (
        pay: (...args: unknown[]) => Promise<ArtifactPay>,
        over: Partial<Parameters<typeof pagePayments>[0]> = {}
    ) =>
        pagePayments({
            artifactId: "a1",
            chat: () => undefined,
            frame: () => frameWindow,
            loaded: () => true,
            opening: () => showing,
            openWindow: () => null,
            pay: pay as never,
            storage: memoryStorage(),
            randomId: counting(),
            ...over,
        });
    const heard = () => toldAll().map((m) => ({ ...m }));

    it("makes its own wish for each tap, keeps a guest's recovery code in this browser for this page, and gives the page neither", async () => {
        const storage = memoryStorage();
        const ids = counting();
        const pay = vi.fn().mockResolvedValue({ ...checkout, status: "checking" });
        const first = make(pay, { storage, randomId: ids });
        ask(first, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "r1",
            session: "s1",
            intentId: "page-made",
            recoveryCode: "page-made",
        });
        await flush();
        const sent = pay.mock.calls[0][2] as { start: boolean; intentId: string; recoveryCode: string };
        // The wish and the code are the window's: whatever the page put in its message is not used
        expect(sent).toEqual({ start: true, intentId: WISH_1, recoveryCode: CODE(2) });
        expect(storage.kept.get("universe-pay-recovery:a1")).toBe(CODE(2));
        first.destroy();
        // The same browser, the same page, the next time: the same code, a new wish
        const second = make(pay, { storage, randomId: ids });
        ask(second, frameWindow, { universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
        await flush();
        expect(pay.mock.calls[1][2]).toMatchObject({ start: true, recoveryCode: CODE(2) });
        expect((pay.mock.calls[1][2] as { intentId: string }).intentId).not.toBe(WISH_1);
        // Another page has a code of its own
        const other = pagePayments({
            artifactId: "a2",
            chat: () => undefined,
            frame: () => frameWindow,
            loaded: () => true,
            pay: pay as never,
            storage,
            randomId: ids,
        });
        ask(other, frameWindow, { universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
        await flush();
        expect(storage.kept.get("universe-pay-recovery:a2")).toBeDefined();
        // A look at an order never carries the code
        await vi.advanceTimersByTimeAsync(3_000);
        expect(pay).toHaveBeenCalledWith("a1", undefined, { order: "o1" });
        // The page hears statuses and its own id only
        expect(JSON.stringify((frameWindow.postMessage as ReturnType<typeof vi.fn>).mock.calls)).not.toMatch(
            /intent|recovery|0000000|checkout/
        );
        first.destroy();
        second.destroy();
        other.destroy();
    });

    it("sends a start whose answer was lost again with the SAME wish, makes one order, and never repeats an answer that said no", async () => {
        const pay = vi
            .fn()
            .mockRejectedValueOnce(new ArtifactRequestError(0, "offline"))
            .mockRejectedValueOnce(new ArtifactRequestError(0, "offline"))
            .mockResolvedValueOnce(checkout)
            .mockResolvedValue({ status: "paid", testPayment: false });
        const payments = make(pay);
        ask(payments);
        await flush();
        await vi.advanceTimersByTimeAsync(2_000);
        const starts = pay.mock.calls.filter((call) => (call[2] as { start?: boolean }).start);
        expect(starts).toHaveLength(3);
        expect(new Set(starts.map((call) => (call[2] as { intentId: string }).intentId))).toEqual(new Set([WISH_1]));
        expect(get(payments.line)).toMatchObject({ checking: true });
        expect(told()).toEqual(["started"]);
        payments.destroy();

        // An answer that said no is an answer: asked once, said once
        for (const [error, status] of [
            [SOFT, "unavailable"],
            [new ArtifactRequestError(429, "limit"), "limit"],
            [new ArtifactRequestError(400, "buyer_required"), "unavailable"],
        ] as const) {
            vi.clearAllMocks();
            const refused = vi.fn().mockRejectedValue(error);
            const one = make(refused);
            ask(one);
            // eslint-disable-next-line no-await-in-loop
            await flush();
            // eslint-disable-next-line no-await-in-loop
            await vi.advanceTimersByTimeAsync(5_000);
            expect(refused).toHaveBeenCalledTimes(1);
            expect(told()).toEqual([status]);
            expect(get(one.line)).toMatchObject({ problem: status, canCheck: false });
            one.destroy();
        }
    });

    it("says it could not hear back after three lost answers, keeps the wish, and Check payment asks about that same wish", async () => {
        const pay = vi
            .fn()
            .mockRejectedValueOnce(new ArtifactRequestError(0, "offline"))
            .mockRejectedValueOnce(new ArtifactRequestError(0, "offline"))
            .mockRejectedValueOnce(new ArtifactRequestError(0, "offline"))
            .mockResolvedValueOnce({ status: "paid", testPayment: false, orderId: "o1", pollAfterMs: 3000 });
        const payments = make(pay);
        ask(payments);
        await flush();
        await vi.advanceTimersByTimeAsync(2_000);
        expect(told()).toEqual(["unavailable"]);
        expect(get(payments.line)).toMatchObject({ problem: "unavailable", canCheck: true });
        payments.checkPayment();
        expect(get(payments.line)).toMatchObject({ checking: true });
        await flush();
        expect(pay).toHaveBeenLastCalledWith("a1", undefined, { check: true, intentId: WISH_1, recoveryCode: CODE(2) });
        expect(get(payments.line)).toMatchObject({ checking: false, paid: { test: false }, problem: null });
        // The page that asked hears it too, under its own request
        expect(heard()).toEqual([
            { universe: "app-result", status: "unavailable", request: "r1", session: "s1" },
            { universe: "app-result", status: "paid", request: "r1", session: "s1" },
        ]);
        payments.destroy();
    });

    it("offers Check payment after twenty minutes, and for a payment not seen yet; it asks about the order, and says if there is none", async () => {
        const pay = vi
            .fn()
            .mockResolvedValueOnce(checkout)
            .mockResolvedValue({ status: "checking", pollAfterMs: 30_000 })
            .mockResolvedValueOnce(checkout);
        const payments = make(pay);
        ask(payments);
        await flush();
        await vi.advanceTimersByTimeAsync(20 * 60_000);
        expect(get(payments.line)).toMatchObject({ checking: false, problem: "cant_confirm", canCheck: true });
        expect(told()).toEqual(["started", "cant_confirm"]);

        // Check payment: still not paid
        pay.mockResolvedValueOnce({ status: "not_paid", orderId: "o1", pollAfterMs: 3000 });
        payments.checkPayment();
        await flush();
        expect(pay).toHaveBeenLastCalledWith("a1", undefined, { check: true, intentId: WISH_1, recoveryCode: CODE(2) });
        expect(get(payments.line)).toMatchObject({ problem: "not_paid", canCheck: true });

        // ...and again: the wish has no order of this buyer's (the server says 404)
        pay.mockRejectedValueOnce(new ArtifactRequestError(404, "not_found"));
        payments.checkPayment();
        await flush();
        expect(get(payments.line)).toMatchObject({ problem: "none", canCheck: true, checking: false });

        // ...and again: it is still open, so it is watched again until it ends, and the page hears paid
        pay.mockResolvedValueOnce({
            status: "checking",
            orderId: "o1",
            checkoutUrl: "https://checkout.examplepay.com/c1",
            pollAfterMs: 3000,
        });
        pay.mockResolvedValue({ status: "paid", testPayment: false, pollAfterMs: 3000 });
        payments.checkPayment();
        await flush();
        expect(get(payments.line)).toMatchObject({
            checking: true,
            resume: { url: "https://checkout.examplepay.com/c1" },
        });
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(payments.line)).toMatchObject({ paid: { test: false } });
        expect(told().at(-1)).toBe("paid");
        // While a question is on its way a second press asks nothing
        payments.destroy();
    });

    it("asks nothing twice at once: Check payment pressed while a payment is on its way does nothing", async () => {
        const pay = vi.fn().mockResolvedValue(checkout);
        const payments = make(pay);
        ask(payments);
        await flush();
        const before = pay.mock.calls.length;
        payments.checkPayment();
        payments.restorePurchase();
        await flush();
        expect(pay).toHaveBeenCalledTimes(before);
        payments.destroy();
    });

    describe("an early reload finds the buyer's own start unfinished (restore: checking, via own, no checkout yet)", () => {
        const load = { universe: "use-app", app: "examplepay", request: "load1", session: "s1", restore: true };
        const unfinished = { status: "checking", via: "own", orderId: null, pollAfterMs: 2_000 } as ArtifactPay;

        it("asks Restore again after pollAfterMs, not the order's status, and takes up the checkout when it comes", async () => {
            const pay = vi
                .fn()
                .mockResolvedValueOnce(unfinished)
                .mockResolvedValueOnce(unfinished)
                .mockResolvedValueOnce({
                    status: "checking",
                    via: "own",
                    orderId: "o1",
                    checkoutUrl: "https://checkout.examplepay.com/c1",
                    pollAfterMs: 3_000,
                })
                .mockResolvedValue({ status: "paid", testPayment: false });
            const payments = make(pay);
            ask(payments, frameWindow, load);
            await flush();
            expect(pay).toHaveBeenCalledTimes(1);
            expect(get(payments.line)).toMatchObject({ checking: true });
            await vi.advanceTimersByTimeAsync(2_000);
            expect(pay).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(2_000);
            expect(pay).toHaveBeenCalledTimes(3);
            // Only Restore was asked while there was no checkout: never an order's status
            for (const call of pay.mock.calls.slice(0, 3))
                expect(call[2]).toEqual({ restore: true, recoveryCode: expect.any(String) });
            expect(get(payments.line)).toMatchObject({
                checking: true,
                resume: { url: "https://checkout.examplepay.com/c1" },
            });
            await vi.advanceTimersByTimeAsync(3_000);
            expect(pay).toHaveBeenLastCalledWith("a1", undefined, { order: "o1" });
            expect(told().at(-1)).toBe("paid");
            payments.destroy();
        });

        it("tells the page the purchase when Restore finds it while it waits", async () => {
            const pay = vi
                .fn()
                .mockResolvedValueOnce(unfinished)
                .mockResolvedValue({ status: "paid", testPayment: false, paidAt: "2026-11-19T08:00:00Z" });
            const payments = make(pay);
            ask(payments, frameWindow, load);
            await flush();
            await vi.advanceTimersByTimeAsync(2_000);
            expect(get(payments.line)).toMatchObject({
                paid: { test: false },
                restored: { paidAt: "2026-11-19T08:00:00Z" },
            });
            expect(told()).toEqual(["paid"]);
            payments.destroy();
        });

        it("asks again after a question with no answer, and after about twenty minutes offers Check payment and tells the page unavailable", async () => {
            const pay = vi
                .fn()
                .mockResolvedValueOnce(unfinished)
                .mockRejectedValueOnce(new ArtifactRequestError(0, "offline"))
                .mockResolvedValue(unfinished);
            const payments = make(pay);
            ask(payments, frameWindow, load);
            await flush();
            await vi.advanceTimersByTimeAsync(2_000);
            await vi.advanceTimersByTimeAsync(2_000);
            expect(pay.mock.calls.length).toBeGreaterThanOrEqual(3);
            expect(told()).toEqual([]);
            await vi.advanceTimersByTimeAsync(21 * 60_000);
            expect(get(payments.line)).toMatchObject({ checking: false, problem: "unavailable", canCheck: true });
            expect(told()).toEqual(["unavailable"]);
            const asked = pay.mock.calls.length;
            await vi.advanceTimersByTimeAsync(5 * 60_000);
            expect(pay).toHaveBeenCalledTimes(asked);
            payments.destroy();
        });

        it("never asks again after its own deadline, even when the last answer asked to wait a whole minute", async () => {
            const at: number[] = [];
            const slow = { ...unfinished, pollAfterMs: 60_000 } as ArtifactPay;
            // The first answer asks for half a minute, so the minute-long waits that follow do not end on the deadline itself
            const pay = vi.fn(() => {
                at.push(Date.now());
                return Promise.resolve(
                    at.length === 1 ? ({ ...unfinished, pollAfterMs: 30_000 } as ArtifactPay) : slow
                );
            });
            const payments = make(pay);
            const started = Date.now();
            ask(payments, frameWindow, load);
            await flush();
            await vi.advanceTimersByTimeAsync(21 * 60_000 + 30_000);
            expect(get(payments.line)).toMatchObject({ problem: "unavailable", canCheck: true });
            expect(Math.max(...at) - started).toBeLessThanOrEqual(20 * 60_000);
            payments.destroy();
        });

        it("ends the wait at a refusal, and never waits for an order of a receipt (via receipt) or without via", async () => {
            const refused = make(
                vi
                    .fn()
                    .mockResolvedValueOnce(unfinished)
                    .mockRejectedValueOnce(new ArtifactRequestError(409, "unavailable"))
            );
            ask(refused, frameWindow, load);
            await flush();
            await vi.advanceTimersByTimeAsync(2_000);
            expect(get(refused.line)).toMatchObject({ problem: "unavailable", canCheck: true });
            refused.destroy();

            const receipt = vi
                .fn()
                .mockResolvedValue({ status: "checking", via: "receipt", orderId: "o9", pollAfterMs: 2_000 });
            const watching = make(receipt);
            ask(watching, frameWindow, { ...load, request: "load2" });
            await flush();
            await vi.advanceTimersByTimeAsync(5_000);
            // watched as an order: the status of o9 is what is asked, and Restore only once
            expect(receipt.mock.calls.filter((call) => (call[2] as { restore?: boolean }).restore).length).toBe(1);
            expect(receipt).toHaveBeenLastCalledWith("a1", undefined, { order: "o9" });
            watching.destroy();
        });

        it("waits the same way for Restore purchase", async () => {
            const pay = vi
                .fn()
                .mockResolvedValueOnce(unfinished)
                .mockResolvedValue({ status: "paid", testPayment: false });
            const payments = make(pay);
            payments.restorePurchase();
            await flush();
            expect(get(payments.line)).toMatchObject({ checking: true });
            await vi.advanceTimersByTimeAsync(2_000);
            expect(get(payments.line)).toMatchObject({ paid: { test: false } });
            payments.destroy();
        });
    });

    it("gets a purchase back when the page asks on load, tells the page paid under that request, and says when it was bought", async () => {
        const pay = vi.fn().mockResolvedValue({
            status: "paid",
            testPayment: false,
            orderId: "o9",
            pollAfterMs: 3000,
            paidAt: "2026-11-19T08:00:00.000Z",
        });
        const payments = make(pay, { buyer: () => "account" });
        ask(payments, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "load1",
            session: "s1",
            restore: true,
        });
        await flush();
        // It is a look, not a checkout: no wish, no payment window, and the guest's code goes with it
        expect(pay).toHaveBeenCalledTimes(1);
        expect(pay).toHaveBeenCalledWith("a1", undefined, { restore: true, recoveryCode: expect.any(String) });
        expect(get(payments.line)).toMatchObject({
            checking: false,
            paid: { test: false },
            restored: { paidAt: "2026-11-19T08:00:00.000Z" },
            receipt: null,
        });
        expect(heard()).toEqual([{ universe: "app-result", status: "paid", request: "load1", session: "s1" }]);
        // It ended, so the page can ask again
        pay.mockResolvedValueOnce({ status: "none", testPayment: false, orderId: null, pollAfterMs: 3000 });
        ask(payments, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "load2",
            session: "s1",
            restore: true,
        });
        await flush();
        expect(heard().at(-1)).toEqual({ universe: "app-result", status: "none", request: "load2", session: "s1" });
        expect(get(payments.line)).toMatchObject({ offerRestore: true, paid: null });
        payments.destroy();
    });

    it("tells a test payment to the page as a test, from a restore and from a checkout, and a live one without the flag", async () => {
        const pay = vi
            .fn()
            .mockResolvedValue({ status: "paid", testPayment: true, orderId: "o9", pollAfterMs: 3000, paidAt: null });
        const restoring = make(pay);
        ask(restoring, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "load1",
            session: "s1",
            restore: true,
        });
        await flush();
        expect(heard()).toEqual([
            { universe: "app-result", status: "paid", request: "load1", session: "s1", test: true },
        ]);
        expect(get(restoring.line)).toMatchObject({ paid: { test: true } });
        restoring.destroy();

        vi.clearAllMocks();
        const buying = make(
            vi
                .fn()
                .mockResolvedValueOnce(checkout)
                .mockResolvedValueOnce({ status: "paid", testPayment: true })
                .mockResolvedValue({ status: "paid", testPayment: false })
        );
        ask(buying);
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        expect(heard()).toEqual([
            { universe: "app-result", status: "started", request: "r1", session: "s1" },
            { universe: "app-result", status: "paid", request: "r1", session: "s1", test: true },
        ]);
        expect(get(buying.line)).toMatchObject({ paid: { test: true }, receipt: null });
        buying.destroy();

        vi.clearAllMocks();
        const live = make(
            vi.fn().mockResolvedValueOnce(checkout).mockResolvedValue({ status: "paid", testPayment: false })
        );
        ask(live);
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        expect(heard().at(-1)).toEqual({ universe: "app-result", status: "paid", request: "r1", session: "s1" });
        live.destroy();
    });

    describe("an order that is not this buyer's any more (another account signed in on this device while the checkout was on its way)", () => {
        const NOT_THERE = new ArtifactRequestError(404, "not_found");

        it("clears the line of the one that left, tells the page unavailable under its own request, never paid, and stops asking", async () => {
            const pay = vi
                .fn()
                .mockResolvedValueOnce(checkout)
                .mockRejectedValueOnce(NOT_THERE)
                .mockResolvedValue({ status: "paid", testPayment: false });
            const payments = make(pay);
            ask(payments);
            await flush();
            expect(get(payments.line)).toMatchObject({ checking: true });
            await vi.advanceTimersByTimeAsync(3_000);
            // Cleared: nothing of the order is left on the line, not as a problem, not as a purchase, and no Check payment for it
            expect(get(payments.line)).toMatchObject({
                checking: false,
                paid: null,
                problem: null,
                canCheck: false,
                resume: null,
            });
            expect(heard()).toEqual([
                { universe: "app-result", status: "started", request: "r1", session: "s1" },
                { universe: "app-result", status: "unavailable", request: "r1", session: "s1" },
            ]);
            // The order is not asked about again: a later "paid" answer would never reach this line
            await vi.advanceTimersByTimeAsync(60_000);
            expect(pay).toHaveBeenCalledTimes(2);
            expect(told()).not.toContain("paid");
            payments.destroy();
        });

        it("clears an order a restore found open as well", async () => {
            const pay = vi
                .fn()
                .mockResolvedValueOnce({ status: "checking", orderId: "o7", checkoutUrl: null, pollAfterMs: 3000 })
                .mockRejectedValueOnce(NOT_THERE)
                .mockResolvedValue({ status: "paid", testPayment: false });
            const payments = make(pay);
            ask(payments, frameWindow, {
                universe: "use-app",
                app: "examplepay",
                request: "load1",
                session: "s1",
                restore: true,
            });
            await flush();
            await vi.advanceTimersByTimeAsync(3_000);
            expect(get(payments.line)).toMatchObject({ checking: false, paid: null, problem: null });
            expect(heard().at(-1)).toEqual({
                universe: "app-result",
                status: "unavailable",
                request: "load1",
                session: "s1",
            });
            expect(told()).not.toContain("paid");
            payments.destroy();
        });

        it("keeps asking after any other failure: a 5xx or no answer proves nothing about whose order it is", async () => {
            const pay = vi
                .fn()
                .mockResolvedValueOnce(checkout)
                .mockRejectedValueOnce(new ArtifactRequestError(500, "failed"))
                .mockRejectedValueOnce(new ArtifactRequestError(0, "offline"))
                .mockRejectedValueOnce(new ArtifactRequestError(403, "forbidden"))
                .mockResolvedValue({ status: "paid", testPayment: false });
            const payments = make(pay);
            ask(payments);
            await flush();
            await vi.advanceTimersByTimeAsync(30_000);
            expect(get(payments.line)).toMatchObject({ checking: false, paid: { test: false } });
            expect(told()).toEqual(["started", "paid"]);
            payments.destroy();
        });
    });

    it("keeps a restored test purchase a test one, from Check payment too: the page hears test, never a live paid", async () => {
        const pay = vi
            .fn()
            .mockResolvedValueOnce({ status: "none", orderId: null, pollAfterMs: 3000 })
            .mockResolvedValue({ status: "paid", testPayment: true, orderId: "o9", paidAt: "2026-11-19T08:00:00Z" });
        const payments = make(pay);
        ask(payments, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "load1",
            session: "s1",
            restore: true,
        });
        await flush();
        payments.checkPayment();
        await flush();
        expect(get(payments.line)).toMatchObject({
            paid: { test: true },
            restored: { paidAt: "2026-11-19T08:00:00Z" },
        });
        expect(heard().at(-1)).toEqual({
            universe: "app-result",
            status: "paid",
            request: "load1",
            session: "s1",
            test: true,
        });
        payments.destroy();
    });

    it("gives an order that was adopted with no link its Continue link when a later answer carries one", async () => {
        const pay = vi
            .fn()
            .mockResolvedValueOnce({ status: "checking", orderId: "o5", checkoutUrl: null, pollAfterMs: 3000 })
            .mockResolvedValueOnce({
                status: "checking",
                orderId: "o5",
                checkoutUrl: "https://checkout.examplepay.com/c5",
                app: "Example",
                pollAfterMs: 3000,
            })
            .mockResolvedValue({ status: "checking", pollAfterMs: 3000 });
        const payments = make(pay);
        ask(payments, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "load1",
            session: "s1",
            restore: true,
        });
        await flush();
        expect(get(payments.line)).toMatchObject({ checking: true, resume: null });
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(payments.line)).toMatchObject({
            checking: true,
            resume: { url: "https://checkout.examplepay.com/c5", app: "Example" },
        });
        // A link that is not plain https is never offered
        const unsafe = make(
            vi.fn().mockResolvedValue({
                status: "checking",
                orderId: "o6",
                checkoutUrl: "javascript:alert(1)",
                pollAfterMs: 3000,
            })
        );
        ask(unsafe, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "load2",
            session: "s1",
            restore: true,
        });
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(unsafe.line).resume).toBeNull();
        payments.destroy();
        unsafe.destroy();
    });

    it("watches an open order of the buyer's found by a restore, with its own link, and the page hears it end under its restore request", async () => {
        const pay = vi
            .fn()
            .mockResolvedValueOnce({
                status: "checking",
                orderId: "o5",
                checkoutUrl: "https://checkout.examplepay.com/c5",
                pollAfterMs: 3000,
            })
            .mockResolvedValue({ status: "paid", testPayment: false });
        const payments = make(pay);
        ask(payments, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "load1",
            session: "s1",
            restore: true,
        });
        await flush();
        expect(get(payments.line)).toMatchObject({
            checking: true,
            resume: { url: "https://checkout.examplepay.com/c5" },
        });
        await vi.advanceTimersByTimeAsync(3_000);
        expect(pay).toHaveBeenLastCalledWith("a1", undefined, { order: "o5" });
        expect(heard()).toEqual([{ universe: "app-result", status: "paid", request: "load1", session: "s1" }]);
        payments.destroy();
    });

    describe("an order that closed while the payment service has not had the last word (longWait)", () => {
        const loadAsk = { universe: "use-app", app: "examplepay", request: "load1", session: "s1", restore: true };
        const stillChecking = {
            status: "checking",
            via: "own",
            orderId: "o7",
            longWait: true,
            pollAfterMs: 3_000,
        } as ArtifactPay;

        it("says it is still checking when a restore finds one, never watches it for twenty minutes, tells the page it could not confirm yet, and leaves Buy available", async () => {
            const pay = vi.fn().mockResolvedValue(stillChecking);
            const payments = make(pay);
            ask(payments, frameWindow, loadAsk);
            await flush();
            expect(get(payments.line)).toMatchObject({ checking: false, problem: "still_checking", canCheck: true });
            expect(heard()).toEqual([
                { universe: "app-result", status: "cant_confirm", request: "load1", session: "s1" },
            ]);
            // nothing is asked again, for the twenty minutes of a watch and after it
            await vi.advanceTimersByTimeAsync(25 * 60_000);
            expect(pay).toHaveBeenCalledTimes(1);
            expect(heard()).toHaveLength(1);
            // a new purchase is not held up by it: the page's own Buy starts a checkout
            pay.mockResolvedValueOnce({
                orderId: "o8",
                checkoutUrl: "https://checkout.examplepay.com/c8",
                app: "Example",
            });
            ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r2", session: "s1" });
            await flush();
            expect(heard().at(-1)).toMatchObject({ status: "started", request: "r2" });
            payments.destroy();
        });

        it("is no unfinished start of the buyer's own, though it has no link: Restore is not asked again for it", async () => {
            const pay = vi.fn().mockResolvedValue({ ...stillChecking, checkoutUrl: null, orderId: null });
            const payments = make(pay);
            ask(payments, frameWindow, loadAsk);
            await flush();
            await vi.advanceTimersByTimeAsync(10_000);
            expect(pay).toHaveBeenCalledTimes(1);
            expect(get(payments.line)).toMatchObject({ problem: "still_checking" });
            payments.destroy();
        });

        it("stops watching an order at once when its poll says it is a long wait, and tells the page it could not confirm yet", async () => {
            const pay = vi
                .fn()
                .mockResolvedValueOnce({
                    orderId: "o1",
                    checkoutUrl: "https://checkout.examplepay.com/c1",
                    app: "Example",
                })
                .mockResolvedValueOnce({ status: "checking", orderId: "o1", longWait: true, pollAfterMs: 3000 })
                .mockResolvedValue({ status: "checking", orderId: "o1", longWait: true });
            const payments = make(pay);
            ask(payments);
            await flush();
            await vi.advanceTimersByTimeAsync(3_000);
            expect(get(payments.line)).toMatchObject({
                checking: false,
                problem: "still_checking",
                canCheck: true,
                resume: null,
            });
            expect(told()).toEqual(["started", "cant_confirm"]);
            await vi.advanceTimersByTimeAsync(25 * 60_000);
            expect(pay).toHaveBeenCalledTimes(2);
            expect(told()).toEqual(["started", "cant_confirm"]);
            payments.destroy();
        });

        it("says the same for Check payment and Restore purchase, and a later confirmation of the payment ends it as paid", async () => {
            const pay = vi
                .fn()
                .mockResolvedValueOnce({
                    orderId: "o1",
                    checkoutUrl: "https://checkout.examplepay.com/c1",
                    app: "Example",
                })
                .mockResolvedValue({ status: "checking", pollAfterMs: 30_000 });
            const payments = make(pay);
            ask(payments);
            await flush();
            await vi.advanceTimersByTimeAsync(20 * 60_000);
            expect(get(payments.line)).toMatchObject({ problem: "cant_confirm" });
            // Check payment (by the wish): the order is closed and not settled
            pay.mockResolvedValueOnce({ status: "checking", orderId: "o1", longWait: true });
            payments.checkPayment();
            await flush();
            expect(pay).toHaveBeenLastCalledWith("a1", undefined, expect.objectContaining({ check: true }));
            expect(get(payments.line)).toMatchObject({ checking: false, problem: "still_checking", canCheck: true });
            const calls = pay.mock.calls.length;
            await vi.advanceTimersByTimeAsync(25 * 60_000);
            expect(pay).toHaveBeenCalledTimes(calls);
            // Restore purchase: the same
            pay.mockResolvedValueOnce(stillChecking);
            payments.restorePurchase();
            await flush();
            expect(pay).toHaveBeenLastCalledWith("a1", undefined, expect.objectContaining({ restore: true }));
            expect(get(payments.line)).toMatchObject({ problem: "still_checking", canCheck: true });
            // The service confirms it later: Check payment finds it paid
            pay.mockResolvedValueOnce({ status: "paid", testPayment: false, orderId: "o1" });
            payments.checkPayment();
            await flush();
            expect(get(payments.line)).toMatchObject({ paid: { test: false }, problem: null });
            payments.destroy();
        });

        it.each([[undefined], [false], ["true"], [1]])(
            "reads an answer with longWait %s as before (an older Orbit, or a value that is not true): watched for twenty minutes, then not heard back",
            async (longWait) => {
                const pay = vi
                    .fn()
                    .mockResolvedValueOnce({
                        orderId: "o1",
                        checkoutUrl: "https://checkout.examplepay.com/c1",
                        app: "Example",
                    })
                    .mockResolvedValue({
                        status: "checking",
                        orderId: "o1",
                        ...(longWait === undefined ? {} : { longWait }),
                        pollAfterMs: 30_000,
                    });
                const payments = make(pay);
                ask(payments);
                await flush();
                await vi.advanceTimersByTimeAsync(5 * 60_000);
                expect(get(payments.line)).toMatchObject({ checking: true, problem: null });
                await vi.advanceTimersByTimeAsync(16 * 60_000);
                expect(get(payments.line)).toMatchObject({ checking: false, problem: "cant_confirm" });
                expect(told().at(-1)).toBe("cant_confirm");
                payments.destroy();
            }
        );
    });

    it("says it could not look when a restore gets no answer, and the buyer can check", async () => {
        const payments = make(vi.fn().mockRejectedValue(new ArtifactRequestError(0, "offline")));
        ask(payments, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "load1",
            session: "s1",
            restore: true,
        });
        await flush();
        expect(heard()).toEqual([{ universe: "app-result", status: "unavailable", request: "load1", session: "s1" }]);
        expect(get(payments.line)).toMatchObject({ problem: "unavailable", canCheck: true });
        payments.destroy();
    });

    const hangs = () => new Promise<ArtifactPay>(() => {});

    it("does not stay busy when a restore never gets an answer: after thirty seconds it says so, and the buyer can check (Sentry)", async () => {
        const pay = vi.fn(hangs);
        const payments = make(pay);
        ask(payments, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "load1",
            session: "s1",
            restore: true,
        });
        await flush();
        await vi.advanceTimersByTimeAsync(31_000);
        expect(heard()).toEqual([{ universe: "app-result", status: "unavailable", request: "load1", session: "s1" }]);
        expect(get(payments.line)).toMatchObject({ checking: false, problem: "unavailable", canCheck: true });
        // Free again: Check payment asks, and its request is dropped too after thirty seconds
        payments.checkPayment();
        await flush();
        expect(pay).toHaveBeenCalledTimes(2);
        expect(get(payments.line)).toMatchObject({ checking: true });
        await vi.advanceTimersByTimeAsync(31_000);
        expect(get(payments.line)).toMatchObject({ checking: false, problem: "unavailable", canCheck: true });
        payments.dismiss();
        expect(get(payments.line).problem).toBeNull();
        payments.destroy();
    });

    it("drops a status question that never gets an answer after thirty seconds, and asks the order again (Sentry)", async () => {
        const pay = vi
            .fn()
            .mockResolvedValueOnce(checkout)
            .mockImplementationOnce(hangs)
            .mockResolvedValue({ status: "paid", checkoutUrl: null, testPayment: false });
        const payments = make(pay);
        ask(payments);
        await flush();
        // The first status question (at 3 s) hangs: it is dropped at 33 s, and the order is asked about again after that
        await vi.advanceTimersByTimeAsync(3_000);
        expect(pay).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(40_000);
        expect(pay.mock.calls.length).toBeGreaterThanOrEqual(3);
        expect(get(payments.line)).toMatchObject({ paid: { test: false } });
        payments.destroy();
    });

    it("asks again as the server says, never faster than a second or slower than thirty", async () => {
        const pay = vi
            .fn()
            .mockResolvedValueOnce(checkout)
            .mockResolvedValueOnce({ status: "checking", pollAfterMs: 10_000 })
            .mockResolvedValueOnce({ status: "checking", pollAfterMs: 5 })
            .mockResolvedValueOnce({ status: "checking", pollAfterMs: 9_999_999 })
            .mockResolvedValueOnce({ status: "checking" })
            .mockResolvedValue({ status: "paid", testPayment: false });
        const payments = make(pay);
        ask(payments);
        await flush();
        const orders = () => pay.mock.calls.filter((call) => (call[2] as { order?: string }).order).length;
        await vi.advanceTimersByTimeAsync(3_000);
        expect(orders()).toBe(1);
        await vi.advanceTimersByTimeAsync(9_000);
        expect(orders()).toBe(1);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(orders()).toBe(2);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(orders()).toBe(3);
        await vi.advanceTimersByTimeAsync(29_000);
        expect(orders()).toBe(3);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(orders()).toBe(4);
        // No hint: the first pace
        await vi.advanceTimersByTimeAsync(3_000);
        expect(orders()).toBe(5);
        expect(get(payments.line).paid).toMatchObject({ test: false });
        payments.destroy();
    });

    it("is busy for one request of one opening: another opening's page is told busy even with the same id, and can use Restore purchase after", async () => {
        const pay = vi.fn().mockResolvedValueOnce(checkout).mockResolvedValue({ status: "paid", testPayment: false });
        const payments = make(pay);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
        await flush();
        // The same tap heard twice, in the same opening: nothing is said
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
        await flush();
        expect(told()).toEqual(["started"]);
        // The version was opened again (a new page) and its own first ask has the same id: it is another request, and it is told so
        showing = 2;
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
        ask(payments, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "load",
            session: "s1",
            restore: true,
        });
        await flush();
        expect(told()).toEqual(["started", "busy", "busy"]);
        expect(
            heard()
                .filter((m) => m.status === "busy")
                .map((m) => m.request)
        ).toEqual(["r1", "load"]);
        expect(pay).toHaveBeenCalledTimes(1);
        // The first page's payment ended in an opening that is gone: that page is told nothing. The page of the opening on show, whose
        // restore was turned away, is told its purchase is made, under its own request
        await vi.advanceTimersByTimeAsync(3_000);
        expect(told()).toEqual(["started", "busy", "busy", "paid"]);
        expect(heard().at(-1)).toMatchObject({ status: "paid", request: "load" });
        expect(get(payments.line)).toMatchObject({ paid: { test: false } });
        payments.destroy();

        // Without a payment on its way nothing is owed
        const quiet = make(vi.fn().mockResolvedValue({ status: "none" }));
        ask(quiet, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "load",
            session: "s1",
            restore: true,
        });
        await flush();
        expect(get(quiet.line)).toMatchObject({ offerRestore: true });
        quiet.destroy();

        // A payment that ends badly in a gone opening still leaves Restore purchase on offer
        vi.clearAllMocks();
        showing = 1;
        const later = make(vi.fn().mockResolvedValueOnce(checkout).mockResolvedValue({ status: "not_paid" }));
        ask(later, frameWindow, { universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
        await flush();
        showing = 2;
        ask(later, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "load",
            session: "s1",
            restore: true,
        });
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(later.line)).toMatchObject({ problem: "not_paid", canCheck: true, offerRestore: true });
        later.destroy();
    });

    it("offers Restore purchase once when Check payment ends a payment that turned another page away, and not again after", async () => {
        const pay = vi.fn().mockResolvedValueOnce(checkout).mockResolvedValueOnce({ status: "not_paid" });
        const payments = make(pay);
        showing = 1;
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(payments.line)).toMatchObject({ problem: "not_paid", canCheck: true });
        // Check payment is on its way when the version is opened again and its page asks
        let release: (value: unknown) => void = () => undefined;
        pay.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    release = resolve;
                })
        );
        payments.checkPayment();
        await flush();
        showing = 2;
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "load", session: "s2" });
        await flush();
        release({ status: "not_paid" });
        await flush();
        expect(get(payments.line)).toMatchObject({ problem: "not_paid", offerRestore: true });
        // What was owed was given once: the next check that ends badly does not offer it again
        pay.mockResolvedValueOnce({ status: "not_paid" });
        payments.checkPayment();
        await flush();
        expect(get(payments.line)).toMatchObject({ problem: "not_paid", offerRestore: false });
        payments.destroy();
    });

    it("does not take who the buyer is from an answer that came after its question was given up on", async () => {
        let late: (answer: unknown) => void = () => undefined;
        const pay = vi
            .fn()
            // The restore at load: no answer in time, and one that comes later says "account"
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        late = resolve;
                    })
            )
            // The guest's checkout that follows: its answers say nothing about who the buyer is
            .mockResolvedValueOnce(checkout)
            .mockResolvedValue({ status: "paid", testPayment: false });
        const payments = make(pay, { pageUrl: () => "https://orbit.test/a/a1" });
        ask(payments, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "load",
            session: "s1",
            restore: true,
        });
        await flush();
        await vi.advanceTimersByTimeAsync(31_000);
        expect(told()).toEqual(["unavailable"]);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r2", session: "s1" });
        await flush();
        late({ status: "none", buyer: "account" });
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(payments.line)).toMatchObject({ paid: { test: false }, buyer: "guest" });
        expect(get(payments.line).receipt).toContain("#receipt=");
        payments.destroy();
    });

    it("does not take who the buyer is from a status answer that comes after its watch has ended at the deadline", async () => {
        let held: (answer: unknown) => void = () => undefined;
        let hold = false;
        let paid = false;
        const pay = vi.fn(async (_artifact: unknown, _chat: unknown, body: { order?: string }) => {
            if (!body.order) return checkout;
            if (hold) {
                hold = false;
                // The status question that is on its way when the twenty minutes end
                return new Promise((resolve) => {
                    held = resolve;
                });
            }
            return paid ? { status: "paid", testPayment: false } : { status: "checking", pollAfterMs: 30_000 };
        });
        const payments = make(pay as never, { pageUrl: () => "https://orbit.test/a/a1" });
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
        await flush();
        // Polls at 3s, 33s, ... : the one at 1173s is the last before the deadline, and it is still waiting for its answer when the deadline comes
        await vi.advanceTimersByTimeAsync(1_170_000);
        hold = true;
        await vi.advanceTimersByTimeAsync(31_000);
        expect(told()).toContain("cant_confirm");
        // A guest's new checkout starts; then the old status answer arrives, saying "account"
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r2", session: "s1" });
        await flush();
        held({ status: "checking", buyer: "account" });
        await flush();
        paid = true;
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(payments.line)).toMatchObject({ paid: { test: false }, buyer: "guest" });
        expect(get(payments.line).receipt).toContain("#receipt=");
        payments.destroy();
    });

    it("ends a start that came back with no checkout to show as one that can be checked, never as a plain failure", async () => {
        const pay = vi.fn().mockResolvedValue({ status: "paid", checkoutUrl: null, reused: true });
        const payments = make(pay);
        ask(payments);
        await flush();
        expect(get(payments.line)).toMatchObject({ problem: "unavailable", canCheck: true });
        payments.destroy();
    });

    it("never tells a restore result to a document other than the one that asked for it, even when it used the same request id", async () => {
        const pay = vi
            .fn()
            .mockResolvedValueOnce({ status: "none" })
            .mockResolvedValueOnce(checkout)
            .mockResolvedValueOnce({ status: "not_paid" })
            .mockResolvedValue({ status: "paid", testPayment: false, paidAt: "2026-11-19T10:00:00.000Z" });
        const payments = make(pay);
        // Document A restores under r1 and the answer is "none"
        ask(payments, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "r1",
            session: "s1",
            restore: true,
        });
        await flush();
        // Document B (another session) asks for a checkout under the SAME request id: it is the one speaking now
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r1", session: "s2" });
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        framePost.mockClear();
        // Restore purchase asks as A's restore did; A is not speaking, and B's own request must not get A's answer
        payments.restorePurchase();
        await flush();
        expect(get(payments.line)).toMatchObject({ paid: { test: false } });
        expect(framePost).not.toHaveBeenCalled();
        payments.destroy();
    });

    it("answers a restore that was turned away while a payment was on its way, under its own request, when its page is still on show", async () => {
        const pay = vi.fn().mockResolvedValueOnce(checkout).mockResolvedValueOnce({ status: "not_paid" });
        const payments = make(pay);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
        await flush();
        showing = 2;
        ask(payments, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "load",
            session: "s2",
            restore: true,
        });
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(payments.line)).toMatchObject({ problem: "not_paid", offerRestore: true });
        framePost.mockClear();
        pay.mockResolvedValueOnce({ status: "paid", testPayment: false, paidAt: "2026-11-19T10:00:00.000Z" });
        payments.restorePurchase();
        await flush();
        expect(heard()).toEqual([{ universe: "app-result", status: "paid", request: "load", session: "s2" }]);
        payments.destroy();

        // The page that asked is gone with its opening: the purchase is found for the buyer and nobody is told
        const gone = make(vi.fn().mockResolvedValueOnce(checkout).mockResolvedValueOnce({ status: "not_paid" }));
        showing = 1;
        ask(gone, frameWindow, { universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
        await flush();
        showing = 2;
        ask(gone, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "load",
            session: "s2",
            restore: true,
        });
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        showing = 3;
        framePost.mockClear();
        gone.restorePurchase();
        await flush();
        expect(framePost).not.toHaveBeenCalled();
        gone.destroy();
    });

    it("keeps a restore that was turned away through a lookup that could not be made: Check payment and Restore purchase both go on with that page's request", async () => {
        const offline = () => new ArtifactRequestError(0, "offline");
        const paidBack = { status: "paid", testPayment: false, paidAt: "2026-11-19T10:00:00.000Z" };
        const turnedAway = async (pay: ReturnType<typeof vi.fn>) => {
            showing = 1;
            const payments = make(pay);
            ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
            await flush();
            showing = 2;
            ask(payments, frameWindow, {
                universe: "use-app",
                app: "examplepay",
                request: "load",
                session: "s2",
                restore: true,
            });
            ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r2", session: "s2" });
            await flush();
            // The first checkout ends unpaid, and the buyer is offered Restore purchase for the page that was turned away
            await vi.advanceTimersByTimeAsync(3_000);
            expect(get(payments.line)).toMatchObject({ problem: "not_paid", offerRestore: true });
            framePost.mockClear();
            return payments;
        };

        // Restore purchase whose lookup fails, then Check payment: it retries that restore (not the first checkout's wish), and the page hears paid under both requests it waits on
        const pay = vi
            .fn()
            .mockResolvedValueOnce(checkout)
            .mockResolvedValueOnce({ status: "not_paid" })
            .mockRejectedValueOnce(offline())
            .mockResolvedValue(paidBack);
        const payments = await turnedAway(pay);
        payments.restorePurchase();
        await flush();
        expect(get(payments.line)).toMatchObject({ problem: "unavailable", canCheck: true });
        payments.checkPayment();
        await flush();
        expect(pay.mock.calls.at(-1)?.[2]).toMatchObject({ restore: true });
        expect(heard()).toEqual([
            { universe: "app-result", status: "paid", request: "load", session: "s2" },
            { universe: "app-result", status: "paid", request: "r2", session: "s2" },
        ]);
        payments.destroy();

        // Restore purchase again after the failed lookup: the same page is answered
        const again = await turnedAway(
            vi
                .fn()
                .mockResolvedValueOnce(checkout)
                .mockResolvedValueOnce({ status: "not_paid" })
                .mockResolvedValueOnce({ status: "cant_confirm" })
                .mockResolvedValue(paidBack)
        );
        again.restorePurchase();
        await flush();
        expect(get(again.line)).toMatchObject({ problem: "cant_confirm" });
        again.restorePurchase();
        await flush();
        expect(heard().filter((m) => m.status === "paid")).toEqual([
            { universe: "app-result", status: "paid", request: "load", session: "s2" },
            { universe: "app-result", status: "paid", request: "r2", session: "s2" },
        ]);
        again.destroy();
    });

    describe("Check payment after a turned-away page's restore lookup failed", () => {
        const offline = () => new ArtifactRequestError(0, "offline");
        const paidBack = { status: "paid", testPayment: false, paidAt: "2026-11-19T10:00:00.000Z" };
        const turnedAway = async (pay: ReturnType<typeof vi.fn>) => {
            showing = 1;
            const payments = make(pay);
            ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
            await flush();
            showing = 2;
            ask(payments, frameWindow, {
                universe: "use-app",
                app: "examplepay",
                request: "load",
                session: "s2",
                restore: true,
            });
            ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r2", session: "s2" });
            await flush();
            // The first checkout ends unpaid; the page that was turned away asks to restore, and the lookup cannot be made
            await vi.advanceTimersByTimeAsync(3_000);
            payments.restorePurchase();
            await flush();
            expect(get(payments.line)).toMatchObject({ problem: "unavailable", canCheck: true });
            framePost.mockClear();
            return payments;
        };

        it("keeps what the page waits on through a not paid yet, and tells it under both requests when the purchase is found", async () => {
            const notYet = await turnedAway(
                vi
                    .fn()
                    .mockResolvedValueOnce(checkout)
                    .mockResolvedValueOnce({ status: "not_paid" })
                    .mockRejectedValueOnce(offline())
                    .mockResolvedValueOnce({ status: "not_paid" })
                    .mockResolvedValue(paidBack)
            );
            notYet.checkPayment();
            await flush();
            expect(get(notYet.line)).toMatchObject({ problem: "not_paid", canCheck: true });
            framePost.mockClear();
            notYet.checkPayment();
            await flush();
            expect(heard().filter((m) => m.status === "paid")).toEqual([
                { universe: "app-result", status: "paid", request: "load", session: "s2" },
                { universe: "app-result", status: "paid", request: "r2", session: "s2" },
            ]);
            notYet.destroy();
        });

        it("hands over what the page waits on when Check payment finds an open order that is paid later", async () => {
            const open = await turnedAway(
                vi
                    .fn()
                    .mockResolvedValueOnce(checkout)
                    .mockResolvedValueOnce({ status: "not_paid" })
                    .mockRejectedValueOnce(offline())
                    .mockResolvedValueOnce({ status: "checking", orderId: "o9", pollAfterMs: 3000 })
                    .mockResolvedValue(paidBack)
            );
            open.checkPayment();
            await flush();
            await vi.advanceTimersByTimeAsync(10_000);
            await flush();
            expect(heard().filter((m) => m.status === "paid")).toEqual([
                { universe: "app-result", status: "paid", request: "load", session: "s2" },
                { universe: "app-result", status: "paid", request: "r2", session: "s2" },
            ]);
            open.destroy();
        });

        it("keeps a newer request the page sent while Check payment was looking up the order, and tells the purchase under it", async () => {
            let answerLookup: (value: unknown) => void = () => undefined;
            const lookup = new Promise((resolve) => {
                answerLookup = resolve;
            });
            const pay = vi
                .fn()
                .mockResolvedValueOnce(checkout)
                .mockResolvedValueOnce({ status: "not_paid" })
                .mockRejectedValueOnce(offline())
                .mockReturnValueOnce(lookup)
                .mockResolvedValue(paidBack);
            const payments = await turnedAway(pay);
            payments.checkPayment();
            await flush();
            // The page taps again while the look is out (told busy), and then the look finds an open order
            ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r3", session: "s2" });
            await flush();
            answerLookup({ status: "checking", orderId: "o9", pollAfterMs: 3000 });
            await flush();
            await vi.advanceTimersByTimeAsync(10_000);
            await flush();
            const paid = heard().filter((m) => m.status === "paid");
            expect(paid).toContainEqual({ universe: "app-result", status: "paid", request: "r3", session: "s2" });
            payments.destroy();
        });
    });

    it("tells a restore that was turned away its purchase even when another document's checkout used the same request id", async () => {
        const pay = vi.fn().mockResolvedValueOnce(checkout).mockResolvedValue({ status: "paid", testPayment: false });
        const payments = make(pay);
        showing = 1;
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r1", session: "sA" });
        await flush();
        // Document B (now the one that spoke last) restores under the SAME id and is turned away
        ask(payments, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "r1",
            session: "sB",
            restore: true,
        });
        await flush();
        framePost.mockClear();
        await vi.advanceTimersByTimeAsync(3_000);
        // A's own answer is for a document that is gone; B is told, under its own session
        expect(heard()).toEqual([{ universe: "app-result", status: "paid", request: "r1", session: "sB" }]);
        payments.destroy();
    });

    it("answers a request busy by the document the running operation was started for, not by whoever last used that request id", async () => {
        const pay = vi
            .fn()
            .mockResolvedValueOnce({ status: "none" })
            .mockResolvedValueOnce(checkout)
            .mockResolvedValueOnce({ status: "not_paid" })
            // The buyer's own Restore purchase is running when the other document repeats its request
            .mockImplementationOnce(
                () =>
                    new Promise(() => {
                        // never answered
                    })
            );
        const payments = make(pay);
        showing = 1;
        // Document A restores under r1 and finds nothing
        ask(payments, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "r1",
            session: "sA",
            restore: true,
        });
        await flush();
        // Document B uses the same id for its checkout, which ends unpaid
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r1", session: "sB" });
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(payments.line)).toMatchObject({ problem: "not_paid" });
        framePost.mockClear();
        // The buyer restores for A (the last restore a page asked for); B repeats its request while it runs
        payments.restorePurchase();
        await flush();
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r1", session: "sB" });
        await flush();
        expect(heard()).toEqual([{ universe: "app-result", status: "busy", request: "r1", session: "sB" }]);
        payments.destroy();
    });

    it("tells the page its purchase is back when Check payment finds it after a failed load restore: the page has no checkout of its own, so it is told under the request that asked", async () => {
        const pay = vi
            .fn()
            .mockRejectedValueOnce(new ArtifactRequestError(0, "offline"))
            .mockResolvedValue({ status: "paid", testPayment: false, paidAt: "2026-11-19T10:00:00.000Z" });
        const payments = make(pay);
        ask(payments, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "load1",
            session: "s1",
            restore: true,
        });
        await flush();
        expect(get(payments.line)).toMatchObject({ problem: "unavailable", canCheck: true });
        framePost.mockClear();
        payments.checkPayment();
        await flush();
        expect(get(payments.line)).toMatchObject({ paid: { test: false } });
        // The page leaves its pay button: it hears paid
        expect(heard()).toEqual([{ universe: "app-result", status: "paid", request: "load1", session: "s1" }]);
        payments.destroy();
    });

    it("tells a page whose restore was turned away as busy that its purchase is made, when the payment that was running ends paid", async () => {
        const pay = vi.fn().mockResolvedValueOnce(checkout).mockResolvedValue({ status: "paid", testPayment: false });
        const payments = make(pay);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
        await flush();
        // Another opening's page asks for its purchase back while the payment is on its way, and is told busy
        showing = 2;
        ask(payments, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "load",
            session: "s2",
            restore: true,
        });
        await flush();
        framePost.mockClear();
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(payments.line)).toMatchObject({ paid: { test: false } });
        expect(heard()).toEqual([{ universe: "app-result", status: "paid", request: "load", session: "s2" }]);
        // Told once: the restore is not owed again
        await vi.advanceTimersByTimeAsync(60_000);
        expect(heard()).toHaveLength(1);
        payments.destroy();
    });

    it("tells a page turned away twice (its restore, then its pay tap) the purchase under its latest request too, since that is the one it waits on", async () => {
        const pay = vi.fn().mockResolvedValueOnce(checkout).mockResolvedValue({ status: "paid", testPayment: false });
        const payments = make(pay);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
        await flush();
        showing = 2;
        ask(payments, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "load",
            session: "s2",
            restore: true,
        });
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r2", session: "s2" });
        await flush();
        framePost.mockClear();
        await vi.advanceTimersByTimeAsync(3_000);
        expect(heard()).toEqual([
            { universe: "app-result", status: "paid", request: "load", session: "s2" },
            { universe: "app-result", status: "paid", request: "r2", session: "s2" },
        ]);
        payments.destroy();

        // The same through Restore purchase, after a payment that did not go through
        const later = make(
            vi
                .fn()
                .mockResolvedValueOnce(checkout)
                .mockResolvedValueOnce({ status: "not_paid" })
                .mockResolvedValue({ status: "paid", testPayment: false, paidAt: "2026-11-19T10:00:00.000Z" })
        );
        showing = 1;
        ask(later, frameWindow, { universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
        await flush();
        showing = 2;
        ask(later, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "load",
            session: "s2",
            restore: true,
        });
        ask(later, frameWindow, { universe: "use-app", app: "examplepay", request: "r2", session: "s2" });
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        framePost.mockClear();
        later.restorePurchase();
        await flush();
        expect(heard()).toEqual([
            { universe: "app-result", status: "paid", request: "load", session: "s2" },
            { universe: "app-result", status: "paid", request: "r2", session: "s2" },
        ]);
        later.destroy();
    });

    /**
     * The page as its instructions make it (bots/ai/KeyTools.ts): one request is waited on, the last one sent is kept, and a "paid" is
     * taken for the request waited on, or, once nothing is waited on, for the last one sent.
     */
    const page = (session: string) => {
        let waiting = "";
        let asked = "";
        let shownPaid = false;
        const send = (payments: ReturnType<typeof pagePayments>, request: string, extra: object = {}) => {
            waiting = asked = request;
            ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request, session, ...extra });
        };
        const hear = (message: { session?: string; request?: string; status?: string }) => {
            if (message.session !== session) return;
            const late = message.status === "paid" && !waiting && message.request === asked;
            if (!late && (!waiting || message.request !== waiting)) return;
            if (message.status === "paid") shownPaid = true;
            if (message.status !== "started") waiting = "";
        };
        return {
            send,
            hearAll: () => {
                for (const message of heard()) hear(message);
            },
            paid: () => shownPaid,
        };
    };

    it("tells a page that tapped again while its payment was on its way, and was told busy, that the purchase is made under its latest request (the page waits on that one)", async () => {
        const pay = vi.fn().mockResolvedValueOnce(checkout).mockResolvedValue({ status: "paid", testPayment: false });
        const payments = make(pay);
        const buyer = page("s1");
        buyer.send(payments, "r1");
        await flush();
        // A second tap of the same page: busy, and the page now waits on it (and on nothing once it hears busy)
        buyer.send(payments, "r2");
        await flush();
        buyer.hearAll();
        expect(buyer.paid()).toBe(false);
        framePost.mockClear();
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(payments.line)).toMatchObject({ paid: { test: false } });
        expect(heard()).toEqual([
            { universe: "app-result", status: "paid", request: "r1", session: "s1" },
            { universe: "app-result", status: "paid", request: "r2", session: "s1" },
        ]);
        buyer.hearAll();
        // The page shows its paid result
        expect(buyer.paid()).toBe(true);
        // Told once
        await vi.advanceTimersByTimeAsync(60_000);
        expect(heard()).toHaveLength(2);
        payments.destroy();
    });

    it("tells that page its purchase is back under its latest request when Check payment finds it later, not under the first request alone", async () => {
        const pay = vi
            .fn()
            .mockResolvedValueOnce(checkout)
            .mockResolvedValueOnce({ status: "not_paid" })
            .mockResolvedValue({ status: "paid", testPayment: false });
        const payments = make(pay);
        const buyer = page("s1");
        buyer.send(payments, "r1");
        await flush();
        buyer.send(payments, "r2");
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(payments.line)).toMatchObject({ problem: "not_paid" });
        buyer.hearAll();
        expect(buyer.paid()).toBe(false);
        framePost.mockClear();
        payments.checkPayment();
        await flush();
        expect(heard()).toEqual([
            { universe: "app-result", status: "paid", request: "r1", session: "s1" },
            { universe: "app-result", status: "paid", request: "r2", session: "s1" },
        ]);
        buyer.hearAll();
        expect(buyer.paid()).toBe(true);
        payments.destroy();
    });

    it("keeps the page's latest request through a Restore purchase that finds an order still open: the purchase is told under it when that order is paid", async () => {
        const pay = vi
            .fn()
            .mockResolvedValueOnce(checkout)
            .mockResolvedValueOnce({ status: "not_paid" })
            // The restore finds an open order of the buyer's, and it is paid on the next question
            .mockResolvedValueOnce({ status: "checking", orderId: "o2", checkoutUrl: null })
            .mockResolvedValue({ status: "paid", testPayment: false });
        const payments = make(pay);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
        await flush();
        showing = 2;
        ask(payments, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "load",
            session: "s2",
            restore: true,
        });
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r2", session: "s2" });
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        framePost.mockClear();
        payments.restorePurchase();
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(payments.line)).toMatchObject({ paid: { test: false } });
        expect(heard()).toEqual([
            { universe: "app-result", status: "paid", request: "load", session: "s2" },
            { universe: "app-result", status: "paid", request: "r2", session: "s2" },
        ]);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(heard()).toHaveLength(2);
        payments.destroy();
    });

    it("tells the end of an order a Restore purchase found to the document that asked for the restore, never to a later one with the same request id", async () => {
        const pay = vi
            .fn()
            .mockResolvedValueOnce({ status: "none" })
            .mockResolvedValueOnce(checkout)
            .mockResolvedValueOnce({ status: "not_paid" })
            .mockResolvedValueOnce({
                status: "checking",
                orderId: "o5",
                checkoutUrl: "https://checkout.examplepay.com/c5",
                pollAfterMs: 3000,
            })
            .mockResolvedValue({ status: "paid", testPayment: false });
        const payments = make(pay);
        ask(payments, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "r1",
            session: "s1",
            restore: true,
        });
        await flush();
        // Document B asks for a checkout under the same request id and is the one speaking; its checkout ends not paid
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "r1", session: "s2" });
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        framePost.mockClear();
        // Restore purchase finds an open order of the buyer's: it is watched, and when it is paid A's restore is answered, which is nobody's now
        payments.restorePurchase();
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(payments.line)).toMatchObject({ paid: { test: false } });
        expect(framePost).not.toHaveBeenCalled();
        payments.destroy();
    });

    it("checks the order a Restore purchase found from then on, not the wish of the checkout before it", async () => {
        const pay = vi
            .fn()
            .mockResolvedValueOnce(checkout)
            .mockResolvedValueOnce({ status: "not_paid" })
            // Restore purchase finds another open order of the buyer's, which then cannot be confirmed
            .mockResolvedValueOnce({
                status: "checking",
                orderId: "o2",
                checkoutUrl: "https://checkout.examplepay.com/c2",
            })
            .mockResolvedValueOnce({ status: "cant_confirm" })
            .mockResolvedValue({ status: "none" });
        const payments = make(pay);
        ask(payments);
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(payments.line)).toMatchObject({ problem: "not_paid", canCheck: true });
        payments.restorePurchase();
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(payments.line)).toMatchObject({ problem: "cant_confirm", canCheck: true });
        payments.checkPayment();
        await flush();
        // It asks about what the buyer has bought (the order restore found), not the wish of the first checkout
        expect(pay).toHaveBeenLastCalledWith("a1", undefined, { restore: true, recoveryCode: expect.any(String) });
        payments.destroy();
    });

    it("says on its own line that the page needs an update when a request has no id of its own, answers the page nothing, and Check payment still works", async () => {
        const pay = vi
            .fn()
            .mockResolvedValue({ status: "paid", testPayment: false, orderId: "o2", pollAfterMs: 3000, paidAt: null });
        const payments = make(pay);
        for (const data of [
            { universe: "use-app", app: "examplepay" },
            { universe: "use-app", app: "examplepay", request: "bad id", session: "s1" },
            { universe: "use-app", app: "examplepay", request: 7, session: "s1" },
        ]) {
            ask(payments, frameWindow, data);
            // eslint-disable-next-line no-await-in-loop
            await flush();
        }
        expect(pay).not.toHaveBeenCalled();
        expect(toldAll()).toEqual([]);
        expect(get(payments.line)).toMatchObject({ needsUpdate: true, canCheck: true, checking: false });
        payments.checkPayment();
        await flush();
        // This window made no checkout, so the check asks what this buyer has bought
        expect(pay).toHaveBeenCalledWith("a1", undefined, { restore: true, recoveryCode: expect.any(String) });
        expect(get(payments.line)).toMatchObject({ paid: { test: false } });
        payments.destroy();
    });

    describe("who the buyer is, as Orbit says it (buyer on the answers of the pay route)", () => {
        const page = "https://orbit.test/a/a1";
        const paidAs = (kind: string | undefined) => ({
            status: "paid",
            testPayment: false,
            ...(kind ? { buyer: kind } : {}),
        });
        const startedAs = (kind: string | undefined) => ({ ...checkout, ...(kind ? { buyer: kind } : {}) });

        it("gives the guest receipt line to a signed-in person whose Orbit account is a guest account, and none to one Orbit bound to an account", async () => {
            const guest = make(vi.fn().mockResolvedValueOnce(startedAs("guest")).mockResolvedValue(paidAs("guest")), {
                buyer: () => "account",
                pageUrl: () => page,
            });
            ask(guest);
            await flush();
            await vi.advanceTimersByTimeAsync(3_000);
            expect(get(guest.line)).toMatchObject({ paid: { test: false }, buyer: "guest" });
            expect(get(guest.line).receipt).toBe(`${page}#receipt=${CODE(2)}`);
            guest.destroy();
            const account = make(
                vi.fn().mockResolvedValueOnce(startedAs("account")).mockResolvedValue(paidAs("account")),
                {
                    buyer: () => "guest",
                    pageUrl: () => page,
                }
            );
            ask(account);
            await flush();
            await vi.advanceTimersByTimeAsync(3_000);
            expect(get(account.line)).toMatchObject({ paid: { test: false }, buyer: "account", receipt: null });
            account.destroy();
        });

        it("keeps the guest's receipt for a purchase made as a guest when the buyer signs in before Check payment (buyer is who asks, not the order's)", async () => {
            let signedIn = false;
            const pay = vi
                .fn()
                .mockResolvedValueOnce(startedAs("guest"))
                .mockResolvedValueOnce({ status: "cant_confirm", buyer: "guest" })
                // Signed in meanwhile: the same wish is answered for an account
                .mockResolvedValue(paidAs("account"));
            const payments = make(pay, { buyer: () => (signedIn ? "account" : "guest"), pageUrl: () => page });
            ask(payments);
            await flush();
            signedIn = true;
            await vi.advanceTimersByTimeAsync(3_000);
            expect(get(payments.line)).toMatchObject({ problem: "cant_confirm", canCheck: true });
            payments.checkPayment();
            await flush();
            // The purchase was made as a guest, so its receipt is the guest's, though Orbit now answers for an account
            expect(get(payments.line)).toMatchObject({ paid: { test: false }, buyer: "guest" });
            expect(get(payments.line).receipt).toBe(`${page}#receipt=${CODE(2)}`);
            const asked = pay.mock.calls.map((call) => call[2] as Record<string, unknown>);
            expect(asked.filter((body) => !body.order).every((body) => body.recoveryCode === CODE(2))).toBe(true);
            payments.destroy();
        });

        it("reads the answer's word first and the window's own sign-in only when the answer has none", async () => {
            const old = make(vi.fn().mockResolvedValueOnce(startedAs(undefined)).mockResolvedValue(paidAs(undefined)), {
                buyer: () => "account",
                pageUrl: () => page,
            });
            ask(old);
            await flush();
            await vi.advanceTimersByTimeAsync(3_000);
            expect(get(old.line)).toMatchObject({ paid: { test: false }, buyer: "account", receipt: null });
            old.destroy();
            // A purchase that is back is never given a receipt, whoever asks; "none" is said for who asked
            const none = make(vi.fn().mockResolvedValue({ status: "none", buyer: "account" }), {
                buyer: () => "guest",
            });
            ask(none, frameWindow, {
                universe: "use-app",
                app: "examplepay",
                request: "load1",
                session: "s1",
                restore: true,
            });
            await flush();
            expect(get(none.line)).toMatchObject({ offerRestore: true });
            none.restorePurchase();
            await flush();
            expect(get(none.line)).toMatchObject({ problem: "none", buyer: "account" });
            none.destroy();
        });

        it("never tells the page who the buyer is", async () => {
            const payments = make(
                vi.fn().mockResolvedValueOnce(startedAs("account")).mockResolvedValue(paidAs("account"))
            );
            ask(payments);
            await flush();
            await vi.advanceTimersByTimeAsync(3_000);
            expect(JSON.stringify(heard())).not.toMatch(/buyer|account|guest/);
            payments.destroy();
        });
    });

    it("gives a guest the receipt link to keep, with the code in the fragment, only for a live purchase made just now on a page shared by link", async () => {
        const storage = memoryStorage();
        const paying = () =>
            vi.fn().mockResolvedValueOnce(checkout).mockResolvedValue({ status: "paid", testPayment: false });
        const guest = make(paying(), { storage, buyer: () => "guest", pageUrl: () => "https://orbit.test/a/a1" });
        ask(guest);
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        const code = storage.kept.get("universe-pay-recovery:a1");
        expect(code).toBe(CODE(2));
        expect(get(guest.line)).toMatchObject({
            paid: { test: false },
            buyer: "guest",
            receipt: `https://orbit.test/a/a1#receipt=${code}`,
        });
        expect(guest.receiptLink()).toBe(`https://orbit.test/a/a1#receipt=${code}`);
        guest.destroy();

        // Signed in: the account is the buyer, no link
        const account = make(paying(), { buyer: () => "account", pageUrl: () => "https://orbit.test/a/a1" });
        ask(account);
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(account.line)).toMatchObject({ paid: { test: false }, buyer: "account", receipt: null });
        expect(account.receiptLink()).toBeUndefined();
        account.destroy();

        // A page that is not shared by link has no link to give
        const closed = make(paying(), { pageUrl: () => undefined });
        ask(closed);
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(closed.line)).toMatchObject({ paid: { test: false }, receipt: null });
        closed.destroy();

        // A test payment and a purchase that is back are never given a receipt
        const test = make(
            vi.fn().mockResolvedValueOnce(checkout).mockResolvedValue({ status: "paid", testPayment: true }),
            { pageUrl: () => "https://orbit.test/a/a1" }
        );
        ask(test);
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(test.line)).toMatchObject({ paid: { test: true }, receipt: null });
        test.destroy();
        const back = make(vi.fn().mockResolvedValue({ status: "paid", testPayment: false, paidAt: null }), {
            pageUrl: () => "https://orbit.test/a/a1",
        });
        ask(back, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "load",
            session: "s1",
            restore: true,
        });
        await flush();
        expect(get(back.line)).toMatchObject({ paid: { test: false }, receipt: null });
        back.destroy();
    });

    it("closes a quiet offer, and never hides a payment on its way", async () => {
        const quiet = make(vi.fn().mockResolvedValue({ status: "none" }));
        ask(quiet, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "load",
            session: "s1",
            restore: true,
        });
        await flush();
        expect(get(quiet.line).offerRestore).toBe(true);
        quiet.dismiss();
        expect(get(quiet.line)).toMatchObject({ offerRestore: false, problem: null, paid: null });
        quiet.destroy();

        const going = make(vi.fn().mockResolvedValue(checkout));
        ask(going);
        await flush();
        going.dismiss();
        expect(get(going.line).checking).toBe(true);
        going.destroy();
    });

    it("Restore purchase asks what this buyer bought, and says when there is nothing (a guest and an account are told differently)", async () => {
        const pay = vi.fn().mockResolvedValue({ status: "none", testPayment: false, orderId: null, pollAfterMs: 3000 });
        const payments = make(pay);
        ask(payments, frameWindow, {
            universe: "use-app",
            app: "examplepay",
            request: "load",
            session: "s1",
            restore: true,
        });
        await flush();
        payments.restorePurchase();
        await flush();
        expect(pay).toHaveBeenLastCalledWith("a1", undefined, { restore: true, recoveryCode: expect.any(String) });
        // The page that asked for it hears the answer under its own request
        expect(
            heard()
                .filter((m) => m.request === "load")
                .map((m) => m.status)
        ).toEqual(["none", "none"]);
        // Nothing found: said, and no second Check payment is offered (there is no checkout to check)
        expect(get(payments.line)).toMatchObject({ problem: "none", canCheck: false });
        pay.mockResolvedValueOnce({ status: "paid", testPayment: false, paidAt: "2026-11-19T08:00:00.000Z" });
        payments.restorePurchase();
        await flush();
        expect(get(payments.line)).toMatchObject({
            paid: { test: false },
            restored: { paidAt: "2026-11-19T08:00:00.000Z" },
        });
        payments.destroy();
    });
});
