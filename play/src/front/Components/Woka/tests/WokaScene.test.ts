import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

// The tests run Svelte's server build, where onMount does nothing; the screens need the browser one
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));

const mocks = vi.hoisted(() => ({
    saveTextures: vi.fn(),
    setCharacterTextureIds: vi.fn(),
    tryToStopScene: vi.fn(),
    tryResumingGame: vi.fn(),
}));

vi.mock("../../../Phaser/Game/GameManager", () => ({
    gameManager: {
        currentMapRoom: { href: "http://play.test/@/u/w/r", backgroundColor: "#000000" },
        canResumeGame: true,
        getCharacterTextureIds: () => ["teal"],
        setCharacterTextureIds: mocks.setCharacterTextureIds,
        tryToStopScene: mocks.tryToStopScene,
        tryResumingGame: mocks.tryResumingGame,
    },
}));
vi.mock("../../../Connection/ConnectionManager", () => ({
    connectionManager: { saveTextures: mocks.saveTextures },
}));
vi.mock("../../../Administration/AnalyticsClient", () => ({ analyticsClient: { validationWoka: vi.fn() } }));
vi.mock("../../../Phaser/Login/SelectCharacterScene", () => ({ SelectCharacterSceneName: "SelectCharacterScene" }));
vi.mock("../../../Phaser/Login/EnableCameraScene", () => ({ EnableCameraSceneName: "EnableCameraScene" }));
vi.mock("../../../Connection/LocalUserUtils", () => ({
    areCharacterTexturesValid: (ids: unknown) => Array.isArray(ids) && ids.length > 0,
}));
vi.mock("../../../Stores/JoinDesktopStore", async () => ({
    joinDesktopStore: (await import("svelte/store")).readable(false),
}));
vi.mock("../WokaData", () => ({
    wokaBodyPartOrder: ["body", "eyes", "hair", "clothes", "hat", "accessory", "woka"],
    fetchWokaData: () =>
        Promise.resolve({
            woka: {
                collections: [
                    {
                        name: "Everyday",
                        position: 0,
                        textures: [
                            { id: "teal", name: "Teal", url: "/teal.png", position: 0 },
                            { id: "plum", name: "Plum", url: "/plum.png", position: 1 },
                        ],
                    },
                ],
            },
        }),
    fetchWokaMine: () => Promise.resolve(undefined),
    getWokaTextureUrl: (url: string) => url,
    texturesByPart: () => ({}),
}));
vi.mock("../../../../i18n/i18n-svelte", async () => (await import("./i18nStub")).i18nStub);

import { refusedPickerStore, wokaRefusedStore } from "../../../Stores/WokaRefusedStore";
import { selectCharacterSceneVisibleStore } from "../../../Stores/SelectCharacterStore";
import WokaScene from "../WokaScene.svelte";
import { settle, stubBrowser } from "./i18nStub";

describe("the WOKA picker when it saves", () => {
    let component: WokaScene | undefined;
    let target: HTMLElement;

    beforeEach(async () => {
        stubBrowser();
        vi.clearAllMocks();
        refusedPickerStore.set(undefined);
        wokaRefusedStore.set(undefined);
        target = document.createElement("div");
        document.body.appendChild(target);
        component = new WokaScene({ target });
        await settle();
        // Pick the second WOKA: Continue saves it
        target.querySelector<HTMLElement>("#woka-plum")?.click();
        await settle();
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
    });

    async function continueToSave() {
        target.querySelector<HTMLElement>(".selectCharacterSceneFormSubmit")?.click();
        await settle();
    }

    it("closes and keeps the pick only once the save went through", async () => {
        mocks.saveTextures.mockResolvedValue("saved");
        await continueToSave();

        expect(mocks.saveTextures).toHaveBeenCalledWith(["plum"]);
        expect(mocks.setCharacterTextureIds).toHaveBeenCalledWith(["plum"]);
        expect(mocks.tryResumingGame).toHaveBeenCalled();
        expect(target.querySelector("[role=alert]")).toBeNull();
    });

    it("stays open with the message, and wears the same WOKA, when the save failed", async () => {
        mocks.saveTextures.mockResolvedValue("failed");
        await continueToSave();

        expect(target.querySelector("[role=alert]")?.textContent).toContain("woka.selectWoka.saveFailed");
        expect(target.querySelector("#woka-plum")).not.toBeNull();
        expect(mocks.setCharacterTextureIds).not.toHaveBeenCalled();
        expect(mocks.tryResumingGame).not.toHaveBeenCalled();
    });

    it("stays open with the other message when the place does not allow it", async () => {
        mocks.saveTextures.mockResolvedValue("notAllowed");
        await continueToSave();

        expect(target.querySelector("[role=alert]")?.textContent).toContain("woka.selectWoka.saveNotAllowed");
        expect(mocks.setCharacterTextureIds).not.toHaveBeenCalled();
        expect(mocks.tryResumingGame).not.toHaveBeenCalled();
    });

    it("lets you try again, and the message goes away once it saved", async () => {
        mocks.saveTextures.mockResolvedValueOnce("failed").mockResolvedValueOnce("saved");
        await continueToSave();
        expect(target.querySelector("[role=alert]")).not.toBeNull();

        await continueToSave();
        expect(mocks.setCharacterTextureIds).toHaveBeenCalledWith(["plum"]);
        expect(mocks.tryResumingGame).toHaveBeenCalledTimes(1);
    });

    it("opened from the popup, its close leads back to the popup and not into the room", async () => {
        component?.$destroy();
        target.innerHTML = "";
        refusedPickerStore.set("woka");
        selectCharacterSceneVisibleStore.set(true);
        component = new WokaScene({ target });
        await settle();

        target.querySelector<HTMLElement>(".selectCharacterSceneClose")?.click();
        await settle();

        expect(get(wokaRefusedStore)).toBe("woka");
        expect(get(refusedPickerStore)).toBeUndefined();
        expect(get(selectCharacterSceneVisibleStore)).toBe(false);
        expect(mocks.tryResumingGame).not.toHaveBeenCalled();
    });
});
