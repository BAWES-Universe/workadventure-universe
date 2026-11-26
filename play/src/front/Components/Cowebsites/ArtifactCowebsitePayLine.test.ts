import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import type * as SvelteRuntime from "svelte";
import { writable } from "svelte/store";

// The tests run Svelte's server build, where onMount does nothing: the window listens for the page's messages on mount.
vi.mock("svelte", async (importOriginal) => {
    const svelte = await importOriginal<typeof SvelteRuntime>();
    // eslint-disable-next-line svelte/no-svelte-internal
    const { onMount, onDestroy } = await import("svelte/internal");
    return { ...svelte, onMount, onDestroy };
});

vi.hoisted(() => {
    (window as unknown as { env: Record<string, unknown> }).env = {};
});

const api = vi.hoisted(() => ({
    fetchArtifact: vi.fn(),
    payOnArtifact: vi.fn(),
}));
vi.mock("../../Artifacts/ArtifactApi", () => {
    class ArtifactRequestError extends Error {
        constructor(public readonly status: number, public readonly code: string) {
            super(code);
        }
    }
    return {
        ArtifactRequestError,
        artifactLink: (id: string) => `https://play.test/a/${id}`,
        fetchArtifact: api.fetchArtifact,
        fetchArtifactCode: vi.fn(),
        fetchArtifactVersions: vi.fn(() => Promise.resolve([])),
        restoreArtifactVersion: vi.fn(),
        shareArtifact: vi.fn(),
        payOnArtifact: api.payOnArtifact,
    };
});
vi.mock("../EmbedScreens/OpenHereRow.svelte", async () => ({
    default: (await import("./ArtifactTestStub.svelte")).default,
}));
vi.mock("../EmbedScreens/OpenHereItemIcon.svelte", async () => ({
    default: (await import("./ArtifactTestStub.svelte")).default,
}));
vi.mock("./FileViewer/CodeView.svelte", async () => ({ default: (await import("./ArtifactTestStub.svelte")).default }));

import { loadLocale } from "../../../i18n/i18n-util.sync";
import { setLocale } from "../../../i18n/i18n-svelte";
import ArtifactCowebsiteComponent from "./ArtifactCowebsiteComponent.svelte";

const opened = (owner: boolean, openScope: string, published: { version: number; at: string } | null = null) => ({
    artifact: {
        id: "a1",
        title: "Coffee Club",
        kind: "html",
        makerName: "Nova",
        version: 3,
        openScope,
        changeScope: "owner",
        chatKind: null,
        expiresAt: null,
        published,
    },
    version: {
        number: 3,
        summary: null,
        askedByName: null,
        sizeBytes: 10,
        createdAt: "2026-11-11T10:00:00.000Z",
        url: "https://files.test/3",
        urlLifeMs: 300_000,
        urlHasMedia: false,
    },
    you: { owner, change: owner, manage: owner, copy: owner },
});

const settle = async () => {
    await vi.advanceTimersByTimeAsync(0);
    await tick();
};

describe("the line under a paying page in the artifact window (the approved mock M1)", () => {
    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = "";
        vi.clearAllMocks();
    });

    async function mount(owner = false, openScope = "link", published: { version: number; at: string } | null = null) {
        vi.useFakeTimers();
        api.fetchArtifact.mockResolvedValue(opened(owner, openScope, published));
        const target = document.createElement("div");
        document.body.appendChild(target);
        const cowebsite = {
            artifactId: "a1",
            chat: undefined,
            version: writable<number | undefined>(undefined),
            summary: writable({ title: "Coffee Club", kind: "html", makerName: "Nova" }),
        };
        const view = new ArtifactCowebsiteComponent({
            target,
            props: { actualCowebsite: cowebsite as never, visible: true },
        });
        await settle();
        const frame = target.querySelector("iframe") as HTMLIFrameElement;
        // The page has loaded, so what it is told reaches it
        frame.dispatchEvent(new Event("load"));
        await settle();
        const heard: unknown[] = [];
        vi.spyOn(frame.contentWindow as Window, "postMessage").mockImplementation(
            (message: unknown) => void heard.push(message)
        );
        const say = async (data: unknown) => {
            window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data }));
            await settle();
        };
        const line = () => target.querySelector('[data-testid="artifactPayLine"]');
        const text = () => line()?.textContent?.replace(/\s+/g, " ").trim() ?? null;
        const press = async (kind: string) => {
            (target.querySelector(`[data-testid="artifactPay-${kind}"]`) as HTMLButtonElement).click();
            await settle();
        };
        return { target, view, say, line, text, press, heard, cowebsite, frame };
    }

    it("g5: asks for the purchase back when the page loads, and says it is back with the day it was bought; the page hears paid", async () => {
        api.payOnArtifact.mockResolvedValue({
            status: "paid",
            testPayment: false,
            orderId: "o9",
            paidAt: "2026-11-19T08:00:00.000Z",
        });
        const { say, text, heard, view } = await mount();
        await say({ universe: "use-app", app: "examplepay", request: "load1", session: "s1", restore: true });
        expect(api.payOnArtifact).toHaveBeenCalledWith("a1", undefined, {
            restore: true,
            recoveryCode: expect.any(String),
        });
        expect(text()).toBe("Your purchase from 19 Nov is back.");
        expect(heard).toEqual([{ universe: "app-result", status: "paid", request: "load1", session: "s1" }]);
        view.$destroy();
    });

    it("o1, o2: a guest who paid is given the receipt link to keep (the code in its fragment) and told once it is copied", async () => {
        api.payOnArtifact
            .mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" })
            .mockResolvedValue({ status: "paid", testPayment: false });
        const written: string[] = [];
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText: (value: string) => (written.push(value), Promise.resolve()) },
        });
        vi.spyOn(window, "open").mockReturnValue(null);
        const { say, text, press, target, view } = await mount();
        await say({ universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
        expect(text()).toContain("Checking your payment…");
        await vi.advanceTimersByTimeAsync(3_000);
        await settle();
        expect(text()).toBe(
            "Paid. Thank you. A guest purchase on this browser. Save your private receipt link: it brings this purchase back on any device, so share it with no one. Copy private receipt link"
        );
        await press("copy");
        expect(written).toHaveLength(1);
        expect(written[0]).toMatch(/^https:\/\/play\.test\/a\/a1#receipt=[A-Za-z0-9_-]{43}$/);
        expect(text()).toBe(
            "Private receipt link copied. Keep it somewhere safe, like your notes or email. Anyone who has it can bring this purchase back. Copied"
        );
        expect((target.querySelector('[data-testid="artifactPay-copy"]') as HTMLButtonElement).disabled).toBe(true);
        view.$destroy();
    });

    it("gives a guest who paid on a published Public page the receipt link too, and none on one that was never published", async () => {
        api.payOnArtifact
            .mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" })
            .mockResolvedValue({ status: "paid", testPayment: false });
        const written: string[] = [];
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText: (value: string) => (written.push(value), Promise.resolve()) },
        });
        vi.spyOn(window, "open").mockReturnValue(null);
        const published = await mount(false, "public", { version: 3, at: "2026-11-20T09:12:00Z" });
        await published.say({ universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
        await vi.advanceTimersByTimeAsync(3_000);
        await settle();
        await published.press("copy");
        expect(written[0]).toMatch(/^https:\/\/play\.test\/a\/a1#receipt=[A-Za-z0-9_-]{43}$/);
        published.view.$destroy();
        document.body.innerHTML = "";

        // Nothing published: Orbit has no public page for it, so there is no receipt link to give
        api.payOnArtifact
            .mockResolvedValueOnce({ orderId: "o2", checkoutUrl: "https://checkout.examplepay.com/c2", app: "Example" })
            .mockResolvedValue({ status: "paid", testPayment: false });
        const never = await mount(false, "public", null);
        await never.say({ universe: "use-app", app: "examplepay", request: "r2", session: "s2" });
        await vi.advanceTimersByTimeAsync(3_000);
        await settle();
        expect(never.target.querySelector('[data-testid="artifactPay-copy"]')).toBeNull();
        never.view.$destroy();
    });

    it("shows the receipt link to copy by hand when the browser would not copy it", async () => {
        api.payOnArtifact
            .mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" })
            .mockResolvedValue({ status: "paid", testPayment: false });
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText: () => Promise.reject(new Error("denied")) },
        });
        vi.spyOn(window, "open").mockReturnValue(null);
        const { say, press, target, view } = await mount();
        await say({ universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
        await vi.advanceTimersByTimeAsync(3_000);
        await settle();
        expect(target.querySelector('[data-testid="artifactReceiptText"]')).toBeNull();
        await press("copy");
        await settle();
        expect(target.querySelector('[data-testid="artifactPayLine"]')?.textContent).toContain("Could not copy it");
        expect(target.querySelector('[data-testid="artifactReceiptText"]')?.getAttribute("aria-label")).toBe(
            "Private receipt link"
        );
        expect(target.querySelector('[data-testid="artifactReceiptText"]')?.textContent).toMatch(
            /^https:\/\/play\.test\/a\/a1#receipt=[A-Za-z0-9_-]{43}$/
        );
        view.$destroy();
    });

    it("does not show a copy that failed, or say it is copied, on a newer checkout that took the line meanwhile", async () => {
        let deny: (error: Error) => void = () => undefined;
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
                writeText: () =>
                    new Promise<void>((_resolve, reject) => {
                        deny = reject;
                    }),
            },
        });
        api.payOnArtifact
            .mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" })
            .mockResolvedValueOnce({ status: "paid", testPayment: false })
            // The next checkout starts, and its order is never answered about: the line is on "checking"
            .mockResolvedValueOnce({ orderId: "o2", checkoutUrl: "https://checkout.examplepay.com/c2", app: "Example" })
            .mockImplementation(
                () =>
                    new Promise(() => {
                        // never answered
                    })
            );
        vi.spyOn(window, "open").mockReturnValue(null);
        const { say, press, target, view, text } = await mount();
        await say({ universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
        await vi.advanceTimersByTimeAsync(3_000);
        await settle();
        await press("copy");
        // The page asks again before the browser answers the copy
        await say({ universe: "use-app", app: "examplepay", request: "r2", session: "s1" });
        await vi.advanceTimersByTimeAsync(1_000);
        await settle();
        expect(text()).toContain("Checking your payment");
        expect(text()).not.toContain("Copy private receipt link");
        deny(new Error("denied"));
        await settle();
        expect(text()).not.toContain("Could not copy it");
        expect(target.querySelector('[data-testid="artifactReceiptText"]')).toBeNull();
        view.$destroy();
    });

    it("does not say a copy that went through is copied on a newer, paid checkout that took the line meanwhile", async () => {
        let allow: () => void = () => undefined;
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
                writeText: () =>
                    new Promise<void>((resolve) => {
                        allow = resolve;
                    }),
            },
        });
        api.payOnArtifact
            .mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" })
            .mockResolvedValueOnce({ status: "paid", testPayment: false })
            .mockResolvedValueOnce({ orderId: "o2", checkoutUrl: "https://checkout.examplepay.com/c2", app: "Example" })
            .mockResolvedValue({ status: "paid", testPayment: false });
        vi.spyOn(window, "open").mockReturnValue(null);
        const { say, press, target, view, text } = await mount();
        await say({ universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
        await vi.advanceTimersByTimeAsync(3_000);
        await settle();
        await press("copy");
        // The page asks again, and the newer checkout is paid, all before the browser answers the first copy
        await say({ universe: "use-app", app: "examplepay", request: "r2", session: "s1" });
        await vi.advanceTimersByTimeAsync(3_000);
        await settle();
        expect(text()).toContain("Copy private receipt link");
        allow();
        await settle();
        // The newer line is as it was: its own button, ready to copy its own link
        expect(text()).not.toContain("copied");
        expect(text()).toContain("Copy private receipt link");
        expect((target.querySelector('[data-testid="artifactPay-copy"]') as HTMLButtonElement).disabled).toBe(false);
        expect(target.querySelector('[data-testid="artifactReceiptText"]')).toBeNull();
        view.$destroy();
    });

    it("says an earlier payment is still being checked, with Check payment, when the order is a long wait, and does not watch it for twenty minutes", async () => {
        api.payOnArtifact
            .mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" })
            .mockResolvedValue({ status: "checking", orderId: "o1", longWait: true, pollAfterMs: 3000 });
        vi.spyOn(window, "open").mockReturnValue(null);
        const { say, text, view } = await mount();
        await say({ universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
        await vi.advanceTimersByTimeAsync(3_000);
        await settle();
        expect(text()).toBe(
            "We're still checking your earlier payment. If you paid, it will show up here when your payment service confirms it. Buying again starts a new payment. Check payment"
        );
        const calls = api.payOnArtifact.mock.calls.length;
        await vi.advanceTimersByTimeAsync(25 * 60_000);
        await settle();
        expect(api.payOnArtifact).toHaveBeenCalledTimes(calls);
        view.$destroy();
    });

    it("g1, g4: a payment not heard back about says so and offers Check payment, which asks the server and says what it says", async () => {
        api.payOnArtifact
            .mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" })
            .mockResolvedValue({ status: "checking", pollAfterMs: 30_000 });
        vi.spyOn(window, "open").mockReturnValue(null);
        const { say, text, press, view } = await mount();
        await say({ universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
        await vi.advanceTimersByTimeAsync(20 * 60_000);
        await settle();
        expect(text()).toBe(
            "We haven't heard back about your payment yet. If you paid, it still counts. Check it here before paying again. Check payment"
        );
        api.payOnArtifact.mockResolvedValueOnce({ status: "not_paid", orderId: "o1", pollAfterMs: 3000 });
        await press("check");
        expect(api.payOnArtifact).toHaveBeenLastCalledWith("a1", undefined, {
            check: true,
            intentId: expect.stringMatching(/^[A-Za-z0-9_-]{24}$/),
            recoveryCode: expect.any(String),
        });
        expect(text()).toBe(
            "Not paid yet. If you already paid, it can take a while to show. Check it here before paying again. Check payment"
        );
        api.payOnArtifact.mockResolvedValueOnce({
            status: "paid",
            testPayment: true,
            orderId: "o1",
            pollAfterMs: 3000,
        });
        await press("check");
        expect(text()).toBe("Test payment received. No money moved. Only a live payment counts as a purchase.");
        view.$destroy();
    });

    it("u2, u3: a page with no request id of its own gets a line that says it needs an update: Check payment for a buyer, 'ask Nova' for the owner", async () => {
        const buyer = await mount(false);
        await buyer.say({ universe: "use-app", app: "examplepay" });
        expect(buyer.text()).toBe(
            "This page's pay button needs an update. If you already paid, check it here before paying again. Check payment"
        );
        expect(buyer.heard).toEqual([]);
        buyer.view.$destroy();
        document.body.innerHTML = "";

        const owner = await mount(true);
        await owner.say({ universe: "use-app", app: "examplepay" });
        expect(owner.text()).toBe(
            "This page's pay button needs an update. Ask Nova to make the page again. Check payment"
        );
        owner.view.$destroy();
    });

    it("o3, o4: a page that asked for its purchase and found none gets a quiet Bought this before? that can be closed", async () => {
        api.payOnArtifact.mockResolvedValue({ status: "none", testPayment: false, orderId: null, pollAfterMs: 3000 });
        const { say, text, press, line, view } = await mount();
        await say({ universe: "use-app", app: "examplepay", request: "load1", session: "s1", restore: true });
        expect(text()).toBe("× Bought this before? Restore purchase");
        await press("restore");
        expect(text()).toBe(
            "× No purchase found in this browser. Open the receipt link you saved when you paid. It brings your purchase back here."
        );
        (document.querySelector('[data-testid="artifactPayClose"]') as HTMLButtonElement).click();
        await settle();
        expect(line()).toBeNull();
        view.$destroy();
    });

    it("gives no receipt link to keep when the page is not shared by link", async () => {
        api.payOnArtifact
            .mockResolvedValueOnce({ orderId: "o1", checkoutUrl: "https://checkout.examplepay.com/c1", app: "Example" })
            .mockResolvedValue({ status: "paid", testPayment: false });
        vi.spyOn(window, "open").mockReturnValue(null);
        const { say, text, view } = await mount(false, "me");
        await say({ universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
        await vi.advanceTimersByTimeAsync(3_000);
        await settle();
        expect(text()).toBe(
            "Paid. Thank you. It's kept in this browser, so it comes back whenever you open this page here."
        );
        view.$destroy();
    });

    it("says the version whose page has loaded, and none while another version's page is still on its way in (CodeRabbit, 26 Nov)", async () => {
        api.payOnArtifact.mockReturnValue(new Promise<never>(() => {}));
        vi.spyOn(window, "open").mockReturnValue(null);
        const { say, view } = await mount();
        await say({ universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
        expect(api.payOnArtifact.mock.calls[0][2]).toMatchObject({ start: true, shownVersion: 3 });
        view.$destroy();

        // Another version is asked for: the window has it, but its page has not loaded in the frame yet
        const next = await mount();
        const four = opened(false, "link");
        api.fetchArtifact.mockResolvedValue({
            ...four,
            version: { ...four.version, number: 4, url: "https://files.test/4" },
        });
        next.cowebsite.version.set(4);
        await settle();
        api.payOnArtifact.mockClear();
        await next.say({ universe: "use-app", app: "examplepay", request: "r2", session: "s2" });
        expect(api.payOnArtifact.mock.calls[0][2]).toMatchObject({ start: true });
        expect(api.payOnArtifact.mock.calls[0][2]).not.toHaveProperty("shownVersion");
        next.view.$destroy();
    });

    it("offers the latest version on a page that was updated since it was opened, and opens it fresh with one tap (CodeRabbit, 26 Nov)", async () => {
        const { ArtifactRequestError } = await import("../../Artifacts/ArtifactApi");
        api.payOnArtifact.mockRejectedValueOnce(new ArtifactRequestError(409, "page_changed"));
        vi.spyOn(window, "open").mockReturnValue(null);
        const { say, text, press, line, view } = await mount();
        await say({ universe: "use-app", app: "examplepay", request: "r1", session: "s1" });
        expect(text()).toBe("This page was updated. Open the latest version to see it before you pay. Back to latest");
        api.fetchArtifact.mockClear();
        await press("latest");
        expect(api.fetchArtifact).toHaveBeenCalledWith("a1", undefined, undefined);
        expect(line()).toBeNull();
        view.$destroy();
    });
});
