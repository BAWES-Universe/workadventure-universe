import { tick } from "svelte";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const game = vi.hoisted(() => ({
    getBrickDid: vi.fn<(brickId: string, before?: string) => Promise<unknown>>(),
    warn: vi.fn<(message: string) => void>(),
}));
// The tests run Svelte's server build, where onMount does nothing; the page reads on mount.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: { getBrickDid: game.getBrickDid },
}));
vi.mock("../../../Stores/MenuStore", async () => {
    const store = await import("svelte/store");
    return { userIsConnected: store.writable(true) };
});
vi.mock("../../../Stores/MobileLayoutStore", async () => {
    const store = await import("svelte/store");
    return { mobileLayoutStore: store.writable(true) };
});
vi.mock("../../../Stores/MapEditorStore", async () => {
    const store = await import("svelte/store");
    return { mapEditorVisibilityStore: store.writable(false) };
});
vi.mock("../../../Stores/ErrorStore", () => ({ warningMessageStore: { addWarningMessage: game.warn } }));

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import BrickDidPage from "../BrickDidPage.svelte";

const BOT = "0b7c1d2e-1111-4222-8333-944455556666";
const run = (over: Record<string, unknown> = {}) => ({
    runId: "r1",
    itemId: "i1",
    brickId: BOT,
    words: "Morning briefing",
    kind: "schedule",
    dueAt: "2026-11-16T04:30:00.000Z",
    finishedAt: "2026-11-16T04:31:00.000Z",
    state: "done",
    outcome: "quiet",
    result: null,
    error: null,
    late: false,
    fresh: false,
    ...over,
});

async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
        // eslint-disable-next-line no-await-in-loop
        await tick();
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
    }
    await tick();
}

describe("Everything Brick did page (#2002, mock t-5-closed)", () => {
    let target: HTMLElement;
    let page: { $destroy: () => void } | undefined;
    const onBack = vi.fn<() => void>();

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        target = document.createElement("div");
        document.body.appendChild(target);
    });
    afterEach(() => {
        page?.$destroy();
        page = undefined;
        target.remove();
    });

    const byId = <T extends HTMLElement = HTMLElement>(id: string) => target.querySelector<T>(`[data-testid="${id}"]`);
    const all = (id: string) => [...target.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
    const text = (el: Element | null = target) =>
        (el?.textContent ?? "").replace(new RegExp("[\\u202f\\u00a0]", "g"), " ").replace(/\s+/g, " ").trim();
    async function show(first: unknown) {
        game.getBrickDid.mockResolvedValueOnce(first);
        page = new BrickDidPage({ target, props: { botId: BOT, name: "Brick", onBack } });
        await settle();
    }

    it("lists each run newest first, a failed one saying why, with the Brick's name in the title", async () => {
        await show({
            runs: [
                run({ runId: "r2", words: "Check my visa status", state: "failed", error: "The site did not answer" }),
                run({ runId: "r1", outcome: "spoke", result: "Sent you the briefing" }),
            ],
            next: null,
        });
        expect(game.getBrickDid).toHaveBeenCalledWith(BOT);
        expect(text(byId("brickDidPage"))).toMatch(/^Everything Brick did/);
        const rows = all("brickDidRun");
        expect(rows.map((one) => one.dataset.state)).toEqual(["failed", "done"]);
        expect(text(rows[0])).toMatch(/^Check my visa status.* · Didn't work: The site did not answer$/);
        expect(text(rows[1])).toMatch(/^Morning briefing.* · Sent you the briefing$/);
        expect(byId("brickDidMore")).toBeNull();
    });

    it("shows more when Orbit has older runs, and says when it could not read them", async () => {
        await show({ runs: [run({ runId: "r2" })], next: "cursor-1" });
        game.getBrickDid.mockResolvedValueOnce({ runs: [run({ runId: "r1", words: "Older one" })], next: null });
        byId("brickDidMore")?.click();
        await settle();
        expect(game.getBrickDid).toHaveBeenLastCalledWith(BOT, "cursor-1");
        expect(all("brickDidRun")).toHaveLength(2);
        expect(byId("brickDidMore")).toBeNull();
        page?.$destroy();
        target.innerHTML = "";
        await show({ runs: [run()], next: "cursor-2" });
        game.getBrickDid.mockRejectedValueOnce(new Error("offline"));
        byId("brickDidMore")?.click();
        await settle();
        expect(game.warn).toHaveBeenCalledWith("Couldn't read what Brick did. Try again.");
        expect(all("brickDidRun")).toHaveLength(1);
    });

    it("says what it shows when there are no runs, and offers Try again when it cannot read", async () => {
        await show({ runs: [], next: null });
        expect(text(byId("brickDidNone"))).toBe(
            "Nothing yet. Each time Brick runs something by itself, it shows here with its result."
        );
        page?.$destroy();
        target.innerHTML = "";
        game.getBrickDid.mockRejectedValueOnce(new Error("offline"));
        page = new BrickDidPage({ target, props: { botId: BOT, name: "Brick", onBack } });
        await settle();
        expect(text(byId("brickDidFailed"))).toBe("Couldn't read what Brick did. Try again.");
        game.getBrickDid.mockResolvedValueOnce({ runs: [run()], next: null });
        byId("brickDidRetry")?.click();
        await settle();
        expect(all("brickDidRun")).toHaveLength(1);
    });
});
