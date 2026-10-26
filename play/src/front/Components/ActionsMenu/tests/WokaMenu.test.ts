import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readable } from "svelte/store";

// The tests run Svelte's server build, where onMount does nothing; the card needs the browser one
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../../VisitCard/VisitCard.svelte", async () => await import("./Empty.svelte"));
vi.mock("../../Woka/WokaFromUserId.svelte", async () => await import("./Empty.svelte"));
vi.mock("../../../Administration/AnalyticsClient", () => ({ analyticsClient: {} }));
vi.mock("../../../Chat/Stores/PeopleCardReturnStore", () => ({ peopleCardReturn: { dismissCard: vi.fn() } }));
vi.mock("../../../../i18n/i18n-svelte", async () => (await import("../../Woka/tests/i18nStub")).i18nStub);

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
        expect(target.querySelector("#woka")).toBeNull();
        expect(target.textContent).toContain("Stitch");
    });
});
