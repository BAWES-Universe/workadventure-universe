import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The tests run Svelte's server build, where onMount does nothing; the screens need the browser one
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));

const mocks = vi.hoisted(() => ({ fetchWokaMine: vi.fn(), fetchWokaData: vi.fn() }));

vi.mock("../../../Phaser/Game/GameManager", () => ({
    gameManager: {
        currentMapRoom: { href: "http://play.test/@/u/w/r", backgroundColor: "#000000" },
        getCharacterTextureIds: () => ["teal"],
    },
}));
vi.mock("../../../Stores/JoinDesktopStore", async () => ({
    joinDesktopStore: (await import("svelte/store")).readable(false),
}));
vi.mock("../WokaData", () => ({
    wokaBodyPartOrder: ["body", "eyes", "hair", "clothes", "hat", "accessory", "woka"],
    fetchWokaData: mocks.fetchWokaData,
    fetchWokaMine: mocks.fetchWokaMine,
    getWokaTextureUrl: (url: string) => url,
}));
vi.mock("../../../../i18n/i18n-svelte", async () => (await import("./i18nStub")).i18nStub);

import WokaSelectScene from "../WokaSelectScene.svelte";
import { settle, stubBrowser } from "./i18nStub";

/** A whole outfit: a body and a costume on top, as Orbit draws them. */
function outfit(id: string, current = false) {
    return {
        textures: [
            { id: `${id}-body`, url: `/${id}-body.png` },
            { id: `${id}-costume`, url: `/${id}-costume.png` },
        ],
        name: id,
        ...(current ? { current: true } : {}),
    };
}

/** Just one WOKA from a collection, as a plain catalog outfit. */
function single(id: string, current = false) {
    return { textures: [{ id, url: `/${id}.png` }], name: id, ...(current ? { current: true } : {}) };
}

function catalog(names: string[]) {
    const collections = [
        { name: "Everyday", position: 0, textures: ["teal", "plum", "sky"] },
        { name: "Office", position: 1, textures: ["desk", "tie"] },
    ]
        .slice(0, names.length)
        .map((collection) => ({
            ...collection,
            textures: collection.textures.map((id, position) => ({ id, name: id, url: `/${id}.png`, position })),
        }));
    return { woka: { collections } };
}

describe("the Recent row in the WOKA picker", () => {
    let component: WokaSelectScene | undefined;
    let target: HTMLElement;
    const saveAndContinue = vi.fn();

    beforeEach(() => {
        stubBrowser();
        vi.clearAllMocks();
        mocks.fetchWokaData.mockResolvedValue(catalog(["Everyday", "Office"]));
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
    });

    async function open(recent: ReturnType<typeof outfit>[] | undefined) {
        mocks.fetchWokaMine.mockResolvedValue(recent === undefined ? undefined : { recent });
        component = new WokaSelectScene({ target, props: { customize: vi.fn(), saveAndContinue } });
        await settle();
    }

    const pills = () => Array.from(target.querySelectorAll<HTMLElement>("[role=tab]"));
    const recentTiles = () => Array.from(target.querySelectorAll<HTMLElement>("[id^=woka-recent-]"));
    const gridTiles = () => Array.from(target.querySelectorAll<HTMLElement>("#woka-grid [role=radio]"));
    const checked = () => Array.from(target.querySelectorAll<HTMLElement>("[role=radio][aria-checked=true]"));
    const press = (key: string) => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
        return settle();
    };

    it("asks for a fresh WOKA list each time it opens, so a WOKA granted meanwhile shows (#912)", async () => {
        await open([]);
        expect(mocks.fetchWokaData).toHaveBeenCalledWith({ fresh: true });
    });

    it("is not there for a guest, or when the request failed: the grid opens on your WOKA", async () => {
        await open(undefined);

        expect(target.querySelector(".woka-recent-row")).toBeNull();
        expect(recentTiles()).toHaveLength(0);
        // No empty row either: the pills follow the preview straight away
        expect(pills().map((pill) => pill.getAttribute("aria-selected"))).toEqual(["true", "false"]);
        expect(target.querySelector("#woka-teal")?.getAttribute("aria-checked")).toBe("true");
    });

    it("is not there when nothing was worn lately", async () => {
        await open([]);
        expect(target.querySelector(".woka-recent-row")).toBeNull();
        expect(gridTiles().length).toBeGreaterThan(0);
    });

    it("is one row above the pills, never a pill, and the grid is open under them on Default", async () => {
        await open([outfit("teal", true), outfit("plum"), outfit("sky")]);

        const row = target.querySelector(".woka-recent-row");
        expect(row?.textContent).toContain("woka.selectWoka.recentLabel");
        // Above the pills in the page
        expect(row && pills()[0].compareDocumentPosition(row) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
        // The pills hold only the collections, the first one on, and the grid is on screen
        expect(pills().map((pill) => pill.textContent?.trim())).toEqual([
            expect.stringContaining("Everyday"),
            expect.stringContaining("Office"),
        ]);
        expect(pills()[0].getAttribute("aria-selected")).toBe("true");
        expect(gridTiles()).toHaveLength(3);
        // The WOKA you wear is the one check on the screen
        expect(recentTiles().map((tile) => tile.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
        expect(checked()).toHaveLength(1);
        // "Now" is on the one you wear, and only on it
        expect(recentTiles()[0].textContent).toContain("woka.selectWoka.now");
        expect(recentTiles()[1].textContent).not.toContain("woka.selectWoka.now");
    });

    it("opens the grid on the collection of the plain WOKA you wear, and on Default for a built outfit", async () => {
        await open([single("desk", true), outfit("plum")]);
        expect(pills().map((pill) => pill.getAttribute("aria-selected"))).toEqual(["false", "true"]);
        expect(checked().map((tile) => tile.id)).toEqual(["woka-recent-0"]);

        component?.$destroy();
        target.innerHTML = "";
        await open([outfit("teal", true)]);
        expect(pills()[0].getAttribute("aria-selected")).toBe("true");
    });

    it("shows at most 4 tiles", async () => {
        await open([outfit("a", true), outfit("b"), outfit("c"), outfit("d"), outfit("e"), outfit("f")]);

        expect(recentTiles()).toHaveLength(4);
        expect(pills()).toHaveLength(2);
    });

    it("Continue on a Recent tile saves the whole outfit, every layer", async () => {
        await open([outfit("teal", true), outfit("plum")]);

        recentTiles()[1].click();
        await settle();
        expect(recentTiles().map((tile) => tile.getAttribute("aria-checked"))).toEqual(["false", "true"]);
        target.querySelector<HTMLElement>(".selectCharacterSceneFormSubmit")?.click();

        expect(saveAndContinue).toHaveBeenCalledWith(["plum-body", "plum-costume"]);
    });

    it("Continue on the current Recent tile saves its ids too", async () => {
        await open([outfit("teal", true), outfit("plum")]);

        target.querySelector<HTMLElement>(".selectCharacterSceneFormSubmit")?.click();

        expect(saveAndContinue).toHaveBeenCalledWith(["teal-body", "teal-costume"]);
    });

    it("picking a tile of a collection afterwards saves just that tile", async () => {
        await open([outfit("teal", true)]);

        target.querySelector<HTMLElement>("#woka-plum")?.click();
        await settle();
        // One check on the screen: it left the row for the grid
        expect(checked().map((tile) => tile.id)).toEqual(["woka-plum"]);
        target.querySelector<HTMLElement>(".selectCharacterSceneFormSubmit")?.click();

        expect(saveAndContinue).toHaveBeenCalledWith(["plum"]);
    });

    it("keeps the row while another collection is open, and picking there moves the one check", async () => {
        await open([outfit("teal", true), outfit("plum")]);

        pills()[1].click();
        await settle();

        expect(recentTiles()).toHaveLength(2);
        expect(gridTiles().map((tile) => tile.id)).toEqual(["woka-desk", "woka-tie"]);
        recentTiles()[1].click();
        await settle();
        expect(checked().map((tile) => tile.id)).toEqual(["woka-recent-1"]);
        target.querySelector<HTMLElement>("#woka-tie")?.click();
        await settle();
        expect(checked().map((tile) => tile.id)).toEqual(["woka-tie"]);
    });

    it("a world with one collection still shows its pill, and no swipe hint", async () => {
        mocks.fetchWokaData.mockResolvedValue(catalog(["Everyday"]));
        await open([outfit("teal", true)]);

        expect(pills()).toHaveLength(1);
        expect(pills()[0].getAttribute("aria-selected")).toBe("true");
        expect(target.querySelector(".woka-swipe-hint")).toBeNull();
        expect(recentTiles()).toHaveLength(1);
    });

    it("with one recent WOKA the row is that tile alone", async () => {
        await open([outfit("teal", true)]);
        expect(recentTiles()).toHaveLength(1);
        expect(target.querySelectorAll(".woka-recent-row [role=radio]")).toHaveLength(1);
    });

    describe("arrow keys on a computer", () => {
        it("walk along the row, down into the grid and back up into the row", async () => {
            await open([outfit("teal", true), outfit("plum"), outfit("sky")]);

            await press("ArrowRight");
            expect(checked().map((tile) => tile.id)).toEqual(["woka-recent-1"]);
            // Down goes into the grid, to the tile in the same column
            await press("ArrowDown");
            expect(checked().map((tile) => tile.id)).toEqual(["woka-plum"]);
            await press("ArrowLeft");
            expect(checked().map((tile) => tile.id)).toEqual(["woka-teal"]);
            // Up from the top row of the grid goes back to the row
            await press("ArrowUp");
            expect(checked().map((tile) => tile.id)).toEqual(["woka-recent-0"]);
        });

        it("Enter saves what is checked", async () => {
            await open([outfit("teal", true), outfit("plum")]);
            await press("ArrowDown");
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            document.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));

            expect(saveAndContinue).toHaveBeenCalledWith(["teal"]);
        });
    });

    describe("swiping on a phone", () => {
        /** A finger going from one point to another, as the browser sends it (jsdom has no Touch). */
        function drag(node: Element, from: [number, number], to: [number, number]) {
            const send = (type: string, point: [number, number] | undefined) => {
                const event = new Event(type, { bubbles: true, cancelable: true });
                const touches = point ? [{ clientX: point[0], clientY: point[1] }] : [];
                Object.assign(event, { touches, changedTouches: touches });
                node.dispatchEvent(event);
            };
            send("touchstart", from);
            send("touchmove", to);
            send("touchend", undefined);
        }

        // The page slides for 220ms before the collection changes
        const slid = async () => {
            // eslint-disable-next-line no-promise-executor-return
            await new Promise((resolve) => setTimeout(resolve, 300));
            await settle();
        };

        it("changes the collection from the empty space under the tiles, not only from the tiles", async () => {
            await open([outfit("teal", true), outfit("plum")]);
            const area = target.querySelector(".woka-swipe-area");
            const pages = target.querySelector(".woka-pages");
            expect(area).not.toBeNull();
            // The swipe lives on the whole area, so it reaches past where the tiles end
            expect(pages && area?.contains(pages)).toBe(true);
            expect(pills()[0].getAttribute("aria-selected")).toBe("true");

            drag(target.querySelector(".woka-swipe-hint") ?? area!, [250, 300], [100, 300]);
            await slid();
            expect(pills()[1].getAttribute("aria-selected")).toBe("true");

            drag(target.querySelector(".woka-swipe-hint") ?? area!, [100, 300], [250, 300]);
            await slid();
            expect(pills()[0].getAttribute("aria-selected")).toBe("true");
        });

        it("keeps an up and down drag for scrolling, and ignores a short sideways one", async () => {
            await open([outfit("teal", true), outfit("plum")]);
            const area = target.querySelector(".woka-swipe-area")!;

            drag(area, [200, 400], [190, 150]);
            await slid();
            drag(area, [200, 400], [170, 400]);
            await slid();

            expect(pills()[0].getAttribute("aria-selected")).toBe("true");
        });

        it("a swipe on the Recent row does not change the collection: the row is fixed", async () => {
            await open([outfit("teal", true), outfit("plum")]);

            drag(target.querySelector(".woka-recent-row")!, [250, 300], [100, 300]);
            await slid();

            expect(pills()[0].getAttribute("aria-selected")).toBe("true");
        });

        it("the hint no longer talks about the tiles", async () => {
            await open([outfit("teal", true)]);
            expect(target.querySelector(".woka-swipe-hint")?.textContent).toContain("woka.selectWoka.swipeHint");
        });
    });
});
