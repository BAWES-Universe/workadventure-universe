import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

// The tests run Svelte's server build, where onMount does nothing; the screens need the browser one
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));

const mocks = vi.hoisted(() => ({
    saveTextures: vi.fn(),
    saveCompanionTexture: vi.fn(),
    setCharacterTextureIds: vi.fn(),
    setCompanionTextureId: vi.fn(),
    tryToStopScene: vi.fn(),
    tryResumingGame: vi.fn(),
    fetchWokaMine: vi.fn(),
    fetchWokaData: vi.fn(),
}));

vi.mock("../../../Phaser/Game/GameManager", () => ({
    gameManager: {
        currentMapRoom: { href: "http://play.test/@/u/w/r", backgroundColor: "#000000", roomName: "Acme Office" },
        canResumeGame: true,
        getCharacterTextureIds: () => ["old-crown"],
        setCharacterTextureIds: mocks.setCharacterTextureIds,
        setCompanionTextureId: mocks.setCompanionTextureId,
        tryToStopScene: mocks.tryToStopScene,
        tryResumingGame: mocks.tryResumingGame,
    },
}));
vi.mock("../../../Connection/ConnectionManager", () => ({
    connectionManager: { saveTextures: mocks.saveTextures, saveCompanionTexture: mocks.saveCompanionTexture },
}));
vi.mock("../../../Connection/LocalUserStore", () => ({ localUserStore: { setCompanionTextureId: vi.fn() } }));
vi.mock("../../../Phaser/Login/SelectCharacterScene", () => ({ SelectCharacterSceneName: "SelectCharacterScene" }));
vi.mock("../../../Phaser/Login/SelectCompanionScene", () => ({ SelectCompanionSceneName: "SelectCompanionScene" }));
vi.mock("../../../Phaser/Login/EnableCameraScene", () => ({ EnableCameraSceneName: "EnableCameraScene" }));
vi.mock("../WokaData", () => ({
    wokaBodyPartOrder: ["body", "eyes", "hair", "clothes", "hat", "accessory", "woka"],
    fetchWokaData: mocks.fetchWokaData,
    fetchWokaMine: mocks.fetchWokaMine,
    getWokaTextureUrl: (url: string) => url,
}));
vi.mock("../../../../i18n/i18n-svelte", async () => (await import("./i18nStub")).i18nStub);

import { refusedPickerStore, showWokaRefused, wokaRefusedStore } from "../../../Stores/WokaRefusedStore";
import { selectCharacterSceneVisibleStore } from "../../../Stores/SelectCharacterStore";
import { selectCompanionSceneVisibleStore } from "../../../Stores/SelectCompanionStore";
import WokaRefusedPopup from "../WokaRefusedPopup.svelte";
import { settle, stubBrowser } from "./i18nStub";

/** What Orbit says about Sara: the Gold crown belongs to Default world, so Acme Office offers her teal WOKA. */
const MINE = {
    current: {
        textures: [{ id: "crown", url: "/crown.png" }],
        name: "Gold crown",
        wearableHere: false,
        reason: "other_place" as const,
        placeName: "Default world",
    },
    suggestion: { textures: [{ id: "teal", url: "/teal.png" }], name: "Teal", lastWorn: true },
    recent: [],
    companion: { id: "dog1", url: "/dog.png", wearableHere: false },
};

const ROOM_LIST = {
    woka: {
        collections: [
            {
                name: "Acme",
                position: 0,
                textures: [{ id: "acme1", name: "Acme staff", url: "/acme1.png", position: 0 }],
            },
        ],
    },
};

describe("the popup when a world cannot show your WOKA", () => {
    let component: WokaRefusedPopup | undefined;
    let target: HTMLElement;

    beforeEach(() => {
        stubBrowser();
        vi.clearAllMocks();
        mocks.fetchWokaMine.mockResolvedValue(MINE);
        mocks.fetchWokaData.mockResolvedValue(ROOM_LIST);
        refusedPickerStore.set(undefined);
        wokaRefusedStore.set("woka");
        selectCharacterSceneVisibleStore.set(false);
        selectCompanionSceneVisibleStore.set(false);
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
    });

    async function open(kind: "woka" | "companion" = "woka") {
        component = new WokaRefusedPopup({ target, props: { kind } });
        await settle();
    }

    const button = (label: string) =>
        Array.from(target.querySelectorAll("button")).find((b) => b.textContent?.includes(label));

    it("shows both outfits, why the first cannot be worn, and the two buttons", async () => {
        await open();

        const text = target.textContent ?? "";
        expect(text).toContain("Acme Office");
        expect(text).toContain("woka.refused.wokaTitle");
        expect(text).toContain("Gold crown");
        expect(text).toContain('woka.refused.onlyIn {"place":"Default world"}');
        expect(text).toContain("Teal");
        expect(text).toContain("woka.refused.lastWorn");
        expect(text).toContain("woka.refused.text");
        expect(button("woka.refused.wearThis")).toBeDefined();
        expect(button("woka.refused.chooseAnother")).toBeDefined();
    });

    it.each([
        ["removed", "woka.refused.noLongerAvailable"],
        ["no_access", "woka.refused.notAvailableToYou"],
    ] as const)("writes the %s reason under the faded WOKA", async (reason, line) => {
        mocks.fetchWokaMine.mockResolvedValue({ ...MINE, current: { ...MINE.current, reason } });
        await open();
        expect(target.textContent).toContain(line);
    });

    it("says 'not available here' when no single place is named", async () => {
        mocks.fetchWokaMine.mockResolvedValue({ ...MINE, current: { ...MINE.current, placeName: null } });
        await open();
        expect(target.textContent).toContain("woka.refused.notAvailableHere");
    });

    it("Wear this saves the suggestion, then joins again", async () => {
        mocks.saveTextures.mockResolvedValue("saved");
        await open();

        button("woka.refused.wearThis")?.click();
        await settle();

        expect(mocks.saveTextures).toHaveBeenCalledWith(["teal"]);
        expect(mocks.setCharacterTextureIds).toHaveBeenCalledWith(["teal"]);
        expect(mocks.tryToStopScene).toHaveBeenCalledWith("SelectCharacterScene");
        expect(mocks.tryResumingGame).toHaveBeenCalledTimes(1);
        expect(get(wokaRefusedStore)).toBeUndefined();
    });

    it.each([
        ["failed", "woka.refused.saveFailed"],
        ["notAllowed", "woka.refused.saveNotAllowed"],
    ] as const)("Wear this that is %s keeps the popup open and says so", async (result, message) => {
        mocks.saveTextures.mockResolvedValue(result);
        await open();

        button("woka.refused.wearThis")?.click();
        await settle();

        expect(target.querySelector("[role=alert]")?.textContent).toContain(message);
        expect(mocks.setCharacterTextureIds).not.toHaveBeenCalled();
        expect(mocks.tryResumingGame).not.toHaveBeenCalled();
        expect(get(wokaRefusedStore)).toBe("woka");
    });

    it("Choose another opens the picker, which comes back here when it is closed", async () => {
        await open();

        button("woka.refused.chooseAnother")?.click();
        await settle();

        expect(get(wokaRefusedStore)).toBeUndefined();
        expect(get(selectCharacterSceneVisibleStore)).toBe(true);
        expect(get(refusedPickerStore)).toBe("woka");
        expect(mocks.tryResumingGame).not.toHaveBeenCalled();
    });

    it("a guest (or a failed request) is offered the room's first WOKA, with no reason line", async () => {
        mocks.fetchWokaMine.mockResolvedValue(undefined);
        await open();

        const text = target.textContent ?? "";
        expect(text).toContain("Acme staff");
        expect(text).toContain("woka.refused.availableHere");
        expect(text).not.toContain("woka.refused.onlyIn");
        expect(text).not.toContain("woka.refused.lastWorn");

        mocks.saveTextures.mockResolvedValue("saved");
        button("woka.refused.wearThis")?.click();
        await settle();
        expect(mocks.saveTextures).toHaveBeenCalledWith(["acme1"]);
    });

    it("falls back to the picker when there is nothing to suggest at all", async () => {
        mocks.fetchWokaMine.mockResolvedValue(undefined);
        mocks.fetchWokaData.mockRejectedValue(new Error("no list"));
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        await open();

        expect(get(wokaRefusedStore)).toBeUndefined();
        expect(get(selectCharacterSceneVisibleStore)).toBe(true);
    });

    describe("for a companion", () => {
        beforeEach(() => wokaRefusedStore.set("companion"));

        it("asks about the companion and offers to choose another or go without one", async () => {
            await open("companion");

            expect(target.textContent).toContain("woka.refused.companionTitle");
            expect(button("woka.refused.chooseAnother")).toBeDefined();
            expect(button("woka.refused.goWithoutOne")).toBeDefined();
            expect(button("woka.refused.wearThis")).toBeUndefined();
        });

        it("Go without one saves no companion, then joins again", async () => {
            mocks.saveCompanionTexture.mockResolvedValue("saved");
            await open("companion");

            button("woka.refused.goWithoutOne")?.click();
            await settle();

            expect(mocks.saveCompanionTexture).toHaveBeenCalledWith(null);
            expect(mocks.setCompanionTextureId).toHaveBeenCalledWith(null);
            expect(mocks.tryToStopScene).toHaveBeenCalledWith("SelectCompanionScene");
            expect(mocks.tryResumingGame).toHaveBeenCalledTimes(1);
        });

        it("Go without one that fails keeps the popup open", async () => {
            mocks.saveCompanionTexture.mockResolvedValue("failed");
            await open("companion");

            button("woka.refused.goWithoutOne")?.click();
            await settle();

            expect(target.querySelector("[role=alert]")?.textContent).toContain("woka.refused.companionSaveFailed");
            expect(mocks.tryResumingGame).not.toHaveBeenCalled();
        });

        it("Choose another opens the companion picker", async () => {
            await open("companion");

            button("woka.refused.chooseAnother")?.click();
            await settle();

            expect(get(selectCompanionSceneVisibleStore)).toBe(true);
            expect(get(refusedPickerStore)).toBe("companion");
            expect(get(wokaRefusedStore)).toBeUndefined();
        });
    });
});

describe("a refused join", () => {
    it("opens the popup and not the picker", () => {
        selectCharacterSceneVisibleStore.set(true);
        showWokaRefused("woka");

        expect(get(wokaRefusedStore)).toBe("woka");
        expect(get(selectCharacterSceneVisibleStore)).toBe(false);
    });
});
