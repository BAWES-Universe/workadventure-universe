import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

const api = vi.hoisted(() => ({
    getRoomId: vi.fn<() => string | null>(),
    getRoomBricks: vi.fn<(roomUrl: string) => Promise<unknown>>(),
    takeBrickOut: vi.fn<(id: string) => Promise<void>>(),
    notifyRoomEnter: vi.fn<(roomUrl: string) => Promise<unknown>>(),
}));
const ui = vi.hoisted(() => ({
    openModal: vi.fn<(component: unknown, props?: Record<string, unknown>) => void>(),
    closeModal: vi.fn<() => void>(),
    warn: vi.fn<(message: string) => void>(),
}));
// The tests run Svelte's server build, where onMount does nothing; the list reads the Bricks on mount
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../services/BotApiService", () => ({ botApiService: api }));
vi.mock("svelte-modals", () => ({ openModal: ui.openModal, closeModal: ui.closeModal }));
vi.mock("../../../Stores/ErrorStore", () => ({ warningMessageStore: { addWarningMessage: ui.warn } }));
vi.mock("../../../Enum/ComputedConst", () => ({ ABSOLUTE_PUSHER_URL: "http://pusher.test/" }));
vi.mock("../stores/BotWokaCatalogStore", () => ({
    botWokaCatalogStore: { subscribe: (run: (value: unknown) => void) => (run(null), () => undefined) },
    ensureBotWokaCatalog: () => Promise.resolve(),
}));

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import AddBrickSheet from "../../../Chat/Bricks/AddBrickSheet.svelte";
import { forgetRoomBricks, loadRoomBricks } from "../stores/RoomBricksStore";
import RoomBricksSection from "./RoomBricksSection.svelte";

const ROOM = "/@/team/universe/room";
const settle = async () => {
    for (let i = 0; i < 3; i++) {
        // eslint-disable-next-line no-await-in-loop
        await tick();
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
    }
};
const answer = (over: Record<string, unknown> = {}) => ({
    roomName: "Headquarters",
    here: [
        {
            id: "b1",
            name: "Recipe Brick",
            characterTextureId: "brick-red",
            ownerName: "Khalid",
            mine: false,
            since: "2026-11-10T09:00:00.000Z",
        },
        {
            id: "b2",
            name: "Studio Brick",
            characterTextureId: "brick-violet",
            ownerName: "Sara",
            mine: true,
            since: "2026-11-11T09:00:00.000Z",
        },
    ],
    mine: [
        {
            id: "m1",
            name: "Brick",
            description: "Your own Brick",
            characterTextureId: "brick-orange",
            homeElsewhere: false,
        },
        {
            id: "m2",
            name: "Recipe Brick",
            description: "Keeps the family recipes",
            characterTextureId: "brick-red",
            homeElsewhere: true,
        },
    ],
    ...over,
});

describe("the map editor's list of a room's Bricks (#2005)", () => {
    let target: HTMLElement;
    let destroy: () => void = () => undefined;
    const byId = (id: string) => target.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const all = (id: string) => [...target.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
    const text = () => target.textContent?.replace(/\s+/g, " ").trim() ?? "";

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        forgetRoomBricks();
        api.getRoomId.mockReturnValue(ROOM);
        api.getRoomBricks.mockResolvedValue(answer());
        api.notifyRoomEnter.mockResolvedValue({ botsSpawned: 0 });
        target = document.createElement("div");
        document.body.append(target);
    });
    afterEach(() => {
        destroy();
        target.remove();
    });

    async function open() {
        const section = new RoomBricksSection({ target, props: { onAddHere: vi.fn() } });
        destroy = () => section.$destroy();
        await settle();
        return section;
    }

    it("shows the Bricks placed by others, each with Take out and since when, and not the ones the person placed", async () => {
        await open();
        expect(byId("roomBricksOthers")?.textContent?.trim()).toBe("Placed by others · 1");
        expect(all("roomBrickRow").map((row) => row.textContent?.replace(/\s+/g, " ").trim())).toEqual([
            "Recipe Brick Khalid's Brick · here since 10 Nov Take out",
        ]);
    });

    it("has 'Add one of your Bricks' with its line", async () => {
        await open();
        expect(byId("roomBricksAdd")?.textContent?.replace(/\s+/g, " ").trim()).toBe(
            "Add one of your Bricks It gets a home in this room and stays yours"
        );
    });

    it("shows nothing about Bricks when Orbit does not answer", async () => {
        api.getRoomBricks.mockRejectedValue(new Error("403"));
        await open();
        expect(text()).toBe("");
        expect(byId("roomBricksAdd")).toBeNull();
    });

    it("takes a Brick out, then lists the room again", async () => {
        api.takeBrickOut.mockResolvedValue(undefined);
        await open();
        api.getRoomBricks.mockResolvedValue(answer({ here: [] }));
        byId("roomBrickTakeOut")?.click();
        await settle();
        expect(api.takeBrickOut).toHaveBeenCalledWith("b1");
        expect(byId("roomBricksOthers")).toBeNull();
        expect(ui.warn).not.toHaveBeenCalled();
    });

    it("says so when it could not be taken out, and keeps the Brick listed", async () => {
        api.takeBrickOut.mockRejectedValue(new Error("offline"));
        await open();
        byId("roomBrickTakeOut")?.click();
        await settle();
        expect(ui.warn).toHaveBeenCalledWith("Couldn't take Recipe Brick out. Try again.");
        expect(all("roomBrickRow")).toHaveLength(1);
    });

    it("opens the sheet from the row, with the way to start placing", async () => {
        const onAddHere = vi.fn();
        const section = new RoomBricksSection({ target, props: { onAddHere } });
        destroy = () => section.$destroy();
        await settle();
        byId("roomBricksAdd")?.click();
        expect(ui.openModal).toHaveBeenCalledWith(AddBrickSheet, { onAddHere });
    });
});

describe("the sheet 'Add one of your Bricks' (#2005)", () => {
    let target: HTMLElement;
    let sheet: AddBrickSheet | undefined;
    const byId = (id: string) => target.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const text = () => target.textContent?.replace(/\s+/g, " ").trim() ?? "";

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    beforeEach(async () => {
        vi.clearAllMocks();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        forgetRoomBricks();
        api.getRoomId.mockReturnValue(ROOM);
        api.getRoomBricks.mockResolvedValue(answer());
        await loadRoomBricks();
        target = document.createElement("div");
        document.body.append(target);
    });
    afterEach(() => {
        sheet?.$destroy();
        sheet = undefined;
        target.remove();
    });

    it("says where it would stand, lists the person's Bricks with Add here, and what stays between the two", async () => {
        sheet = new AddBrickSheet({ target, props: { isOpen: true, onAddHere: vi.fn() } });
        await settle();
        expect(text()).toContain(
            "It stands at a spot you choose in Headquarters. Anyone in the room can talk to it. Your own chat with it carries on as before."
        );
        expect(text()).toContain(
            "With other people it never uses apps signed in as you, and it keeps what you told it to itself."
        );
        const rows = [...target.querySelectorAll<HTMLElement>('[data-testid="addBrickRow"]')];
        expect(rows.map((row) => row.textContent?.replace(/\s+/g, " ").trim())).toEqual([
            "Brick Your own Brick Add here",
            "Recipe Brick Keeps the family recipes Move here",
        ]);
    });

    it("closes and starts placing the Brick that was picked", async () => {
        const onAddHere = vi.fn();
        sheet = new AddBrickSheet({ target, props: { isOpen: true, onAddHere } });
        await settle();
        target.querySelectorAll<HTMLElement>('[data-testid="addBrickHere"]')[0].click();
        expect(ui.closeModal).toHaveBeenCalled();
        expect(onAddHere).toHaveBeenCalledWith({
            id: "m1",
            name: "Brick",
            description: "Your own Brick",
            look: "brick-orange",
        });
    });

    it("says so when the person has no Brick to add", async () => {
        api.getRoomBricks.mockResolvedValue(answer({ mine: [] }));
        await loadRoomBricks();
        sheet = new AddBrickSheet({ target, props: { isOpen: true, onAddHere: vi.fn() } });
        await settle();
        expect(byId("addBrickNone")).not.toBeNull();
        expect(byId("addBrickRow")).toBeNull();
    });
});
