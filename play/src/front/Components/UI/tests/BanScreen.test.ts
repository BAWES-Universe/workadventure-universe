import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

vi.mock("../../../Connection/ConnectionManager", () => ({
    connectionManager: { currentRoom: { key: "https://play.test/@/universe/office/lobby" } },
}));
vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: { getAuthToken: () => "token", setLastRoomUrl: vi.fn(() => Promise.resolve()) },
}));
vi.mock("../../../Enum/ComputedConst", () => ({ ABSOLUTE_PUSHER_URL: "https://pusher.test/" }));
vi.mock("../../../Stores/UserInputStore", async () => {
    const { writable } = await import("svelte/store");
    return { inputFormFocusStore: writable(false) };
});
vi.mock("../../../Stores/ExploreStore", async () => {
    const { readable } = await import("svelte/store");
    return { exploreStore: readable({ status: "loading" }) };
});

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import BanScreen from "../BanScreen.svelte";

function answer(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Lets the fetch promises and the component's updates settle.
async function settle(): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
    });
    await tick();
}

describe("BanScreen", () => {
    let component: BanScreen | undefined;
    let target: HTMLElement;
    const fetchMock = vi.fn<typeof fetch>();

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });

    beforeEach(() => {
        vi.stubGlobal("fetch", fetchMock);
        target = document.createElement("div");
        document.body.append(target);
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        document.body.innerHTML = "";
        fetchMock.mockReset();
        vi.unstubAllGlobals();
    });

    const text = () => target.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const appealBox = () => target.querySelector<HTMLTextAreaElement>("[data-testid=banAppealText]");

    it("says what the admin said: world, end date, days left, reason, and offers one appeal", async () => {
        const expiresAt = new Date(Date.now() + 5.5 * 86_400_000).toISOString();
        fetchMock.mockResolvedValueOnce(
            answer(200, { banned: true, worldName: "Office", expiresAt, reason: "Spamming links", appeal: null })
        );
        component = new BanScreen({ target });

        // Generic until the admin answers.
        expect(text()).toContain("You can’t enter this world right now");
        await settle();

        expect(fetchMock.mock.calls[0][0] as string).toBe(
            "https://pusher.test/ban/details?roomUrl=" + encodeURIComponent("https://play.test/@/universe/office/lobby")
        );
        expect(text()).toContain("You can’t enter Office right now");
        expect(text()).toContain("An admin of Office banned you until");
        expect(text()).toContain("(6 days left). You can still go anywhere else in Universe.");
        expect(text()).toContain("“Spamming links”");
        expect(appealBox()).not.toBeNull();
        expect(target.querySelector<HTMLButtonElement>("[data-testid=banAppealSend]")?.disabled).toBe(true);
    });

    it("sends the appeal once and confirms it", async () => {
        fetchMock
            .mockResolvedValueOnce(answer(200, { banned: true, worldName: "Office", expiresAt: null, appeal: null }))
            .mockResolvedValueOnce(answer(200, { ok: true }));
        component = new BanScreen({ target });
        await settle();
        expect(text()).toContain("An admin of Office banned you. You can still go anywhere else in Universe.");

        const box = appealBox();
        if (!box) throw new Error("No appeal box");
        box.value = "  I am sorry  ";
        box.dispatchEvent(new Event("input"));
        await tick();
        target.querySelector<HTMLButtonElement>("[data-testid=banAppealSend]")?.click();
        await settle();

        const [url, init] = fetchMock.mock.calls[1];
        expect(url as string).toBe("https://pusher.test/ban/appeal");
        expect(JSON.parse(init?.body as string)).toEqual({
            roomUrl: "https://play.test/@/universe/office/lobby",
            text: "I am sorry",
        });
        expect(appealBox()).toBeNull();
        expect(text()).toContain("Appeal sent. The admins of Office decide, and you’ll see their answer here.");
    });

    it("shows the admins' answer instead of the form", async () => {
        fetchMock.mockResolvedValueOnce(
            answer(200, { banned: true, worldName: "Office", appeal: { sentAt: "2026-10-01", decision: "kept" } })
        );
        component = new BanScreen({ target });
        await settle();
        expect(text()).toContain("The admins kept the ban.");
        expect(appealBox()).toBeNull();
    });

    it("lets the player back in once the ban is lifted", async () => {
        fetchMock.mockResolvedValueOnce(
            answer(200, { banned: false, worldName: "Office", appeal: { sentAt: "2026-10-01", decision: "lifted" } })
        );
        component = new BanScreen({ target });
        await settle();
        expect(text()).toContain("Your ban was lifted");
        expect(text()).toContain("Enter Office");
    });

    it("names the world by its slug when the admin sends no name", async () => {
        fetchMock.mockResolvedValueOnce(answer(200, { banned: true }));
        component = new BanScreen({ target });
        await settle();
        expect(text()).toContain("You can’t enter office right now");
    });

    it("keeps the generic screen and the way out when the details can't be loaded", async () => {
        fetchMock.mockResolvedValueOnce(answer(502, "down"));
        component = new BanScreen({ target });
        await settle();
        expect(text()).toContain("You can’t enter this world right now");
        expect(text()).toContain("Go somewhere else");
        expect(appealBox()).toBeNull();
    });
});
