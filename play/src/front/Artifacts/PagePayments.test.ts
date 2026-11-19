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
        expect(pay).toHaveBeenNthCalledWith(1, "a1", undefined, { start: true });
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

    it("does not stay starting when the server never answers the start, and can be asked again", async () => {
        const close = vi.fn();
        const popup = { location: { href: "" }, close } as unknown as Window;
        const pay = vi
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise<ArtifactPay>(() => {
                        // never answers
                    })
            )
            .mockResolvedValueOnce({
                orderId: "o2",
                checkoutUrl: "https://checkout.examplepay.com/c2",
                app: "Example",
            });
        const payments = make(pay, () => popup);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "first" });
        await flush();
        await vi.advanceTimersByTimeAsync(29_000);
        expect(get(payments.line)).toMatchObject({ checking: false, problem: null });
        await vi.advanceTimersByTimeAsync(2_000);
        expect(get(payments.line)).toMatchObject({ checking: false, problem: "unavailable" });
        expect(close).toHaveBeenCalled();
        expect(toldAll()).toEqual([{ universe: "app-result", status: "unavailable", request: "first" }]);
        // Nothing is stuck: another start is taken
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "second" });
        await flush();
        expect(pay).toHaveBeenCalledTimes(2);
        payments.destroy();
    });

    it("takes up a checkout that was made while its answer stalled, with its link on the line, when nothing else is on its way", async () => {
        let answerLate: (value: ArtifactPay) => void = () => undefined;
        const pay = vi
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise<ArtifactPay>((resolve) => {
                        answerLate = resolve;
                    })
            )
            .mockResolvedValue({ status: "checking", checkoutUrl: null, testPayment: false });
        const payments = make(pay, () => null);
        ask(payments);
        await flush();
        await vi.advanceTimersByTimeAsync(31_000);
        expect(get(payments.line).problem).toBe("unavailable");
        answerLate({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" } as ArtifactPay);
        await flush();
        // The order is not lost: the window shows it again, with the link to go on, and asks how it stands
        expect(get(payments.line)).toMatchObject({
            checking: true,
            problem: null,
            resume: { url: "https://checkout.examplepay.com/c1", app: "Example" },
        });
        await vi.advanceTimersByTimeAsync(3_000);
        expect(pay).toHaveBeenLastCalledWith("a1", undefined, { order: "o1" });
        payments.destroy();
    });

    it("leaves a checkout whose answer came late alone when another one is already on its way", async () => {
        let answerLate: (value: ArtifactPay) => void = () => undefined;
        const pay = vi
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise<ArtifactPay>((resolve) => {
                        answerLate = resolve;
                    })
            )
            .mockResolvedValueOnce({ orderId: "o2", checkoutUrl: "https://checkout.examplepay.com/c2", app: "Example" })
            .mockResolvedValue({ status: "checking", checkoutUrl: null, testPayment: false });
        const payments = make(pay, () => null);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "first" });
        await flush();
        await vi.advanceTimersByTimeAsync(31_000);
        ask(payments, frameWindow, { universe: "use-app", app: "examplepay", request: "second" });
        await flush();
        expect(get(payments.line).resume?.url).toBe("https://checkout.examplepay.com/c2");
        answerLate({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" } as ArtifactPay);
        await flush();
        expect(get(payments.line).resume?.url).toBe("https://checkout.examplepay.com/c2");
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
