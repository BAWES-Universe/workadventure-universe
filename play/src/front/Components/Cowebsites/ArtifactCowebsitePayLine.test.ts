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

const opened = (owner: boolean, openScope: string) => ({
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

    async function mount(owner = false, openScope = "link") {
        vi.useFakeTimers();
        api.fetchArtifact.mockResolvedValue(opened(owner, openScope));
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
        return { target, view, say, line, text, press, heard };
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
            "Paid. Thank you. Save your receipt link. It brings this purchase back on any device. Copy receipt link"
        );
        await press("copy");
        expect(written).toHaveLength(1);
        expect(written[0]).toMatch(/^https:\/\/play\.test\/a\/a1#receipt=[A-Za-z0-9_-]{43}$/);
        expect(text()).toBe("Receipt link copied. Keep it somewhere safe, like your notes or email. Copied");
        expect((target.querySelector('[data-testid="artifactPay-copy"]') as HTMLButtonElement).disabled).toBe(true);
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
            "We haven't heard back about your payment yet. If you paid, it still counts. You can check now. Check payment"
        );
        api.payOnArtifact.mockResolvedValueOnce({ status: "not_paid", orderId: "o1", pollAfterMs: 3000 });
        await press("check");
        expect(api.payOnArtifact).toHaveBeenLastCalledWith("a1", undefined, {
            check: true,
            intentId: expect.stringMatching(/^[A-Za-z0-9_-]{24}$/),
            recoveryCode: expect.any(String),
        });
        expect(text()).toBe("Not paid yet. If you just paid, it can take a few minutes to show. Check payment");
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
            "This page's pay button needs an update. If you already paid, you can check it here. Check payment"
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
            "Paid. Thank you. It's saved to your account, so it comes back whenever you open this page."
        );
        view.$destroy();
    });
});
