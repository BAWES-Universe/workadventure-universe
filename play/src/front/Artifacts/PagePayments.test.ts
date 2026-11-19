import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactRequestError } from "./ArtifactApi";
import type { ArtifactPay } from "./ArtifactApi";
import { pagePayments, safeCheckout } from "./PagePayments";

vi.mock("./ArtifactApi", () => {
    class ArtifactRequestError extends Error {
        constructor(public readonly status: number, public readonly code: string) {
            super(code);
        }
    }
    return { ArtifactRequestError, payOnArtifact: vi.fn() };
});

const framePost = vi.fn();
const frameWindow = { postMessage: framePost } as unknown as Window;
const otherWindow = { postMessage: vi.fn() } as unknown as Window;

function ask(
    payments: ReturnType<typeof pagePayments>,
    source: Window = frameWindow,
    data: unknown = { universe: "use-app", app: "examplepay", request: "r1" }
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
            openWindow,
            pay: pay as never,
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
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "" });
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: 7 });
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "a b" });
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "x".repeat(65) });
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
            amount: "1.000",
            job: "x",
        });
        await flush();
        // The message carried no amount and none is sent
        expect(pay).toHaveBeenNthCalledWith(1, "a1", undefined, { start: true }, expect.any(AbortSignal));
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

    it("never gives the result of an earlier checkout to a newer request, after a reload or a second tap", async () => {
        const pay = vi
            .fn()
            .mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" })
            .mockResolvedValueOnce({ status: "paid", checkoutUrl: null, testPayment: false });
        const payments = make(pay, () => null);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "first" });
        await flush();
        // The page was reloaded (or asked again): it has a new id while the first checkout is still open
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "second" });
        // The same tap heard twice is not a new request
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "first" });
        await flush();
        expect(pay).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(3_000);
        // "paid" is for the first checkout only: the newer request was told "busy" and never hears "paid"
        expect(toldAll()).toEqual([
            { universe: "app-result", status: "started", request: "first" },
            { universe: "app-result", status: "busy", request: "second" },
            { universe: "app-result", status: "paid", request: "first" },
        ]);
        expect(toldAll().filter((m) => m.request === "second" && m.status === "paid")).toEqual([]);
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
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "first" });
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "second" });
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
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "first" });
        await flush();
        await vi.advanceTimersByTimeAsync(29_000);
        expect(get(payments.line)).toMatchObject({ checking: false, slow: false, problem: null });
        await vi.advanceTimersByTimeAsync(2_000);
        // The buyer's window says it is taking longer; the page has heard nothing, so it is still listening for its own request
        expect(get(payments.line)).toMatchObject({ checking: true, slow: true, problem: null, resume: null });
        expect(close).toHaveBeenCalled();
        expect(toldAll()).toEqual([]);
        // Its answer may still come, so no second checkout is made meanwhile: another request is told it is busy, under its own id
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "second" });
        await flush();
        expect(pay).toHaveBeenCalledTimes(1);
        expect(toldAll()).toEqual([{ universe: "app-result", status: "busy", request: "second" }]);
        // Dropped for good two minutes after the tap: the page hears "unavailable" once, and nothing is stuck
        await vi.advanceTimersByTimeAsync(90_000);
        expect(dropped.value).toBe(true);
        expect(get(payments.line)).toMatchObject({ checking: false, slow: false, problem: "unavailable" });
        expect(toldAll().at(-1)).toEqual({ universe: "app-result", status: "unavailable", request: "first" });
        expect(pageHears("first")).toEqual(["unavailable"]);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "third" });
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
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "first" });
        await flush();
        await vi.advanceTimersByTimeAsync(31_000);
        // Taking longer, and the page has not been told it failed
        expect(get(payments.line)).toMatchObject({ checking: true, slow: true, problem: null });
        expect(toldAll()).toEqual([]);
        // The page taps again while the first start is still out: refused as busy, no second checkout is made
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "second" });
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
        expect(get(payments.line).paid).toEqual({ test: false });
        // Everything about that order went out under the first request's id, and the second one only heard "busy"
        expect(toldAll()).toEqual([
            { universe: "app-result", status: "busy", request: "second" },
            { universe: "app-result", status: "started", request: "first" },
            { universe: "app-result", status: "paid", request: "first" },
        ]);
        // The page's own recipe keeps listening only while "started": it hears started, then paid, so it unlocks
        expect(pageHears("first")).toEqual(["started", "paid"]);
        payments.destroy();
    });

    it("never offers a late checkout to a page that was told 'unavailable': a start answered after it was dropped is never read", async () => {
        const dropped: { value: boolean; answer?: (value: ArtifactPay) => void } = { value: false };
        const pay = vi.fn().mockImplementationOnce(neverAnswers(dropped));
        const payments = make(pay, () => null);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "first" });
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
            .mockImplementationOnce(neverAnswers(dropped))
            .mockResolvedValueOnce({ orderId: "o2", checkoutUrl: "https://checkout.examplepay.com/c2", app: "Example" })
            .mockResolvedValue({ status: "paid", checkoutUrl: null, testPayment: false });
        const payments = make(pay, () => null);
        const stop = payments.line.subscribe((now) => {
            if (now.resume) links.push(now.resume.url);
        });
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "first" });
        await flush();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(dropped.value).toBe(true);
        // Only now can the buyer try again (a retry never runs beside the start that was waiting), and the page is listening anew
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "second" });
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
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "first" });
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
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "first" });
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
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "first" });
        await flush();
        await vi.advanceTimersByTimeAsync(31_000);
        answerLate({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" } as ArtifactPay);
        await flush();
        await vi.advanceTimersByTimeAsync(3_000);
        // The late order ended as not paid, under the first id; only now is a new request taken, under its own id
        expect(toldAll().at(-1)).toEqual({ universe: "app-result", status: "not_paid", request: "first" });
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "second" });
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
            );
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
        pay.mockResolvedValueOnce({ orderId: "o2", checkoutUrl: "https://checkout.examplepay.com/c2", app: "Example" });
        ask(payments);
        await flush();
        expect(pay).toHaveBeenCalledTimes(3);
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
