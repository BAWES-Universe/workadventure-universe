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

const frameWindow = { postMessage: vi.fn() } as unknown as Window;
const otherWindow = { postMessage: vi.fn() } as unknown as Window;

function ask(payments: ReturnType<typeof pagePayments>, source: Window = frameWindow, data: unknown = { universe: "use-app", app: "tap" }) {
    payments.onMessage({ source, data } as unknown as MessageEvent);
}
const flush = async () => {
    await vi.advanceTimersByTimeAsync(0);
};
const told = () => (frameWindow.postMessage as ReturnType<typeof vi.fn>).mock.calls.map((call) => (call[0] as { status: string }).status);

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
        expect(safeCheckout("https://checkout.tap.company/x?y=1")).toBe("https://checkout.tap.company/x?y=1");
        expect(safeCheckout("http://checkout.tap.company/x")).toBeUndefined();
        expect(safeCheckout("javascript:alert(1)")).toBeUndefined();
        expect(safeCheckout("https://user:pw@checkout.tap.company/x")).toBeUndefined();
        expect(safeCheckout("not a url")).toBeUndefined();
        expect(safeCheckout(null)).toBeUndefined();
    });

    it("listens only to its own frame, and only to the one message", async () => {
        const pay = vi.fn(() => Promise.resolve({} as ArtifactPay));
        const payments = make(pay);
        ask(payments, otherWindow);
        ask(payments, frameWindow, { universe: "other", app: "tap" });
        ask(payments, frameWindow, { universe: "use-app" });
        ask(payments, frameWindow, null);
        await flush();
        expect(pay).not.toHaveBeenCalled();
    });

    it("starts the owner's checkout, sends the buyer there, and tells the page only a status", async () => {
        const popup = { location: { href: "" }, close: vi.fn(), opener: {} } as unknown as Window;
        const pay = vi
            .fn()
            .mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "https://checkout.tap.company/c1", app: "Tap" })
            .mockResolvedValueOnce({ status: "checking", checkoutUrl: null, testPayment: false })
            .mockResolvedValueOnce({ status: "paid", checkoutUrl: null, testPayment: true });
        const payments = make(pay, () => popup);
        ask(payments, frameWindow, { universe: "use-app", app: "tap", amount: "1.000", job: "x" });
        await flush();
        // The message carried no amount and none is sent
        expect(pay).toHaveBeenNthCalledWith(1, "a1", undefined, { start: true });
        expect(popup.location.href).toBe("https://checkout.tap.company/c1");
        expect(popup.opener).toBeNull();
        expect(get(payments.line)).toMatchObject({ checking: true, resume: null });
        await vi.advanceTimersByTimeAsync(3_000);
        expect(get(payments.line).checking).toBe(true);
        await vi.advanceTimersByTimeAsync(3_000);
        expect(pay).toHaveBeenNthCalledWith(3, "a1", undefined, { order: "o1" });
        expect(get(payments.line)).toMatchObject({ checking: false, paid: { test: true } });
        expect(told()).toEqual(["started", "paid"]);
        // Nothing but a status went to the page
        expect(JSON.stringify((frameWindow.postMessage as ReturnType<typeof vi.fn>).mock.calls)).not.toContain("checkout");
    });

    it("goes on in a new tab with the same checkout when the pop-up was blocked", async () => {
        const pay = vi.fn().mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "https://checkout.tap.company/c1", app: "Tap" });
        const payments = make(pay, () => null);
        ask(payments);
        await flush();
        expect(get(payments.line).resume).toEqual({ url: "https://checkout.tap.company/c1", app: "Tap" });
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

    it("says it is too many tries on a limit, and refuses an address that is not https", async () => {
        const limited = make(vi.fn().mockRejectedValueOnce(new ArtifactRequestError(429, "limit")));
        ask(limited);
        await flush();
        expect(get(limited.line).problem).toBe("limit");

        const unsafe = make(vi.fn().mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "http://x.example/c", app: "Tap" }));
        ask(unsafe);
        await flush();
        expect(get(unsafe.line).problem).toBe("unavailable");
    });

    it("takes one payment at a time, and ends on a payment that did not go through", async () => {
        const pay = vi
            .fn()
            .mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "https://checkout.tap.company/c1", app: "Tap" })
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
            .mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "https://checkout.tap.company/c1", app: "Tap" })
            .mockResolvedValue({ status: "checking" });
        const payments = make(pay, () => null);
        ask(payments);
        await flush();
        await vi.advanceTimersByTimeAsync(21 * 60_000);
        expect(get(payments.line)).toMatchObject({ checking: false, problem: "cant_confirm" });
        expect(told().at(-1)).toBe("cant_confirm");
    });

    it("stops asking when the window is closed", async () => {
        const pay = vi
            .fn()
            .mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "https://checkout.tap.company/c1", app: "Tap" })
            .mockResolvedValue({ status: "checking" });
        const payments = make(pay, () => null);
        ask(payments);
        await flush();
        payments.destroy();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(pay).toHaveBeenCalledTimes(1);
    });
});
