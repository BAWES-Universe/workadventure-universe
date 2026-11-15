import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readable, writable } from "svelte/store";

// The tests run Svelte's server build, where onMount does nothing; the card needs the browser one
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../../VisitCard/VisitCard.svelte", async () => await import("./Empty.svelte"));
vi.mock("../../Woka/WokaFromUserId.svelte", async () => await import("./Empty.svelte"));
vi.mock("../../../Administration/AnalyticsClient", () => ({ analyticsClient: { clickPropertyMapEditor: vi.fn() } }));
vi.mock("../../../Chat/Stores/PeopleCardReturnStore", () => ({ peopleCardReturn: { dismissCard: vi.fn() } }));
vi.mock("../../../../i18n/i18n-svelte", async () => (await import("../../Woka/tests/i18nStub")).i18nStub);
// What the card reads from the running game
const worldUsers = writable<Map<string, { uuid: string; spaceUserId: string; tags: string[]; reactiveUser: unknown }>>(
    new Map()
);
vi.mock("../personCardContext", () => ({ worldUsersStore: () => worldUsers }));
vi.mock("../../../Stores/MediaStore", () => ({ availabilityStatusStore: readable(1) }));
vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: { getLocalUser: () => ({ uuid: "me-uuid" }) },
}));
vi.mock("../../../Chat/Stores/FriendsStore", () => ({
    relationshipsStore: readable(new Map()),
    friendsEnabledStore: readable(false),
}));
vi.mock("../../../Chat/Bots/BotStatusStore", () => ({ botStatusCache: { store: () => readable(undefined) } }));
const botInfo = writable<{ loading: boolean; description?: string; emotions?: null }>({ loading: true });
vi.mock("../../../external-modules/bots/botCardInfo", () => ({ botCardInfo: () => botInfo }));

import { wokaMenuStore } from "../../../Stores/WokaMenuStore";
import WokaMenu from "../WokaMenu.svelte";
import { settle } from "../../Woka/tests/i18nStub";

describe("WokaMenu: searching for someone far away", () => {
    let target: HTMLElement;
    let component: WokaMenu | undefined;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
        component = new WokaMenu({ target });
    });

    afterEach(() => {
        component?.$destroy();
        wokaMenuStore.clear();
        target.remove();
    });

    it("shows their Woka from People while their avatar isn't on your screen yet", async () => {
        wokaMenuStore.initialize("Stitch", -1, "", undefined, false, readable<string | undefined>("/stitch.png"));
        await settle();
        expect(target.querySelector("#woka img")?.getAttribute("src")).toBe("/stitch.png");
    });

    it("leaves the Woka space out when People had no picture for them (as before)", async () => {
        wokaMenuStore.initialize("Stitch", -1, "", undefined);
        await settle();
        expect(target.querySelector("#woka img")).toBeNull();
        expect(target.textContent).toContain("Stitch");
    });
});

describe("WokaMenu: the buttons", () => {
    let target: HTMLElement;
    let component: WokaMenu | undefined;
    const walk = vi.fn();
    const block = vi.fn();

    const tile = (testId: string) => target.querySelector(`[data-testid="${testId}"]`);
    const skeletons = () => target.querySelectorAll(".tile.wait").length;

    function openPlayer() {
        wokaMenuStore.initialize("Sara", 7, "sara-uuid", undefined);
        wokaMenuStore.addAction({ actionName: "Walk to", testId: "walk", priority: 2, callback: walk });
        wokaMenuStore.addAction({
            actionName: "Block or report",
            testId: "block",
            priority: -1,
            overflow: true,
            style: "text-red-500",
            callback: block,
        });
    }

    beforeEach(() => {
        walk.mockClear();
        block.mockClear();
        botInfo.set({ loading: true });
        target = document.createElement("div");
        document.body.appendChild(target);
        component = new WokaMenu({ target });
    });

    afterEach(() => {
        component?.$destroy();
        wokaMenuStore.clear();
        target.remove();
    });

    it("shows the buttons at once when there is nothing to wait for", async () => {
        openPlayer();
        await settle();
        expect(tile("walk")).not.toBeNull();
        expect(tile("wokamenu-more-button")).not.toBeNull();
        expect(skeletons()).toBe(0);
    });

    it("holds every button back, in empty tiles, until the last answer is in", async () => {
        openPlayer();
        wokaMenuStore.expect("sara-uuid", "membership");
        wokaMenuStore.expect("sara-uuid", "bot-message");
        await settle();
        expect(skeletons()).toBe(4);
        expect(tile("walk")).toBeNull();

        wokaMenuStore.addAction({ actionName: "Membership", testId: "membership", priority: -0.1, callback: vi.fn() });
        wokaMenuStore.settle("sara-uuid", "membership");
        await settle();
        // One answer is still missing: nothing shows yet, so nothing can shift when it comes
        expect(skeletons()).toBe(4);
        expect(tile("membership")).toBeNull();

        wokaMenuStore.settle("sara-uuid", "bot-message");
        await settle();
        expect(skeletons()).toBe(0);
        expect(tile("walk")).not.toBeNull();
        expect(tile("membership")).not.toBeNull();
    });

    it("runs an action and closes the card when its tile is pressed", async () => {
        openPlayer();
        await settle();
        (tile("walk") as HTMLButtonElement).click();
        expect(walk).toHaveBeenCalledTimes(1);
        await settle();
        expect(target.querySelector('[data-testid="person-card"]')).toBeNull();
    });

    it("keeps Block or report under More until More is opened", async () => {
        openPlayer();
        await settle();
        expect(tile("block")).toBeNull();
        (tile("wokamenu-more-button") as HTMLButtonElement).click();
        await settle();
        (tile("block") as HTMLButtonElement).click();
        expect(block).toHaveBeenCalledTimes(1);
    });

    it("gives a bot no More and no Block or report", async () => {
        wokaMenuStore.initialize("Attio", 9, "bot-attio", undefined);
        wokaMenuStore.addAction({ actionName: "Walk to", testId: "walk", priority: 2, callback: walk });
        wokaMenuStore.addAction({ actionName: "Block or report", testId: "block", overflow: true, callback: block });
        botInfo.set({ loading: false, description: "Keeps our customer list.", emotions: null });
        await settle();
        expect(tile("walk")).not.toBeNull();
        expect(tile("wokamenu-more-button")).toBeNull();
        expect(tile("block")).toBeNull();
        expect(target.textContent).toContain("Keeps our customer list.");
    });

    it("holds a bot's buttons back until its description and feelings are in", async () => {
        wokaMenuStore.initialize("Attio", 9, "bot-attio", undefined);
        wokaMenuStore.addAction({ actionName: "Walk to", testId: "walk", priority: 2, callback: walk });
        await settle();
        expect(skeletons()).toBe(4);
        expect(tile("walk")).toBeNull();
        botInfo.set({ loading: false, emotions: null });
        await settle();
        expect(skeletons()).toBe(0);
        expect(tile("walk")).not.toBeNull();
    });

    it("says it is you on your own card", async () => {
        wokaMenuStore.initialize("Khalid", 1, "me-uuid", undefined, true);
        await settle();
        expect(target.textContent).toContain('chat.personCard.youSuffix {"status":"chat.status.online"}');
    });
});

describe("WokaMenu: a Brick that walks beside someone (#2005)", () => {
    let target: HTMLElement;
    let component: WokaMenu | undefined;

    function openBrick(tags: string[]) {
        worldUsers.set(
            new Map([
                [
                    "bot-brick",
                    {
                        uuid: "bot-brick",
                        spaceUserId: "space_9",
                        tags,
                        reactiveUser: { availabilityStatus: readable(undefined) },
                    },
                ],
            ])
        );
        wokaMenuStore.initialize("Brick", 9, "bot-brick", undefined);
        botInfo.set({ loading: false, description: "Your everyday helper", emotions: null });
    }

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
        component = new WokaMenu({ target });
    });

    afterEach(() => {
        component?.$destroy();
        wokaMenuStore.clear();
        worldUsers.set(new Map());
        target.remove();
    });

    it("says whose it is and who it is with, and what it never does for someone else", async () => {
        openBrick(["bot", "visiting:Khalid"]);
        await settle();
        expect(target.textContent).toContain(
            'chat.brick.madeBy {"name":"Khalid"} · chat.brick.visitingWith {"name":"Khalid"}'
        );
        expect(target.querySelector('[data-testid="visitingBrickLine"]')?.textContent?.trim()).toBe(
            'chat.brick.visitingCardLine {"name":"Khalid"}'
        );
    });

    it("says nothing of the kind about a bot that is not visiting", async () => {
        openBrick(["bot"]);
        await settle();
        expect(target.textContent).not.toContain("chat.brick.visitingWith");
        expect(target.querySelector('[data-testid="visitingBrickLine"]')).toBeNull();
        expect(target.textContent).toContain("chat.botStatus.online");
    });
});
