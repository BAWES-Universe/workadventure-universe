import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {};
});
import { tick } from "svelte";
import { readable, writable } from "svelte/store";

const closeAll = vi.hoisted(() => vi.fn());
const openAdminModalFromMenu = vi.hoisted(() => vi.fn());
vi.mock("../../../Administration/AnalyticsClient", () => ({ analyticsClient: new Proxy({}, { get: () => () => {} }) }));
vi.mock("../../../Stores/MenuStore", () => ({
    adminDashboardActivatedStore: writable(true),
    openedMenuStore: { closeAll },
    helpTextDisabledStore: writable(false),
}));
vi.mock("../../../external-modules/admin-api/index", () => ({ openAdminModalFromMenu }));
vi.mock("../../../Api/IframeListener", () => ({ iframeListener: { sendModalCloseTriggered: vi.fn() } }));
vi.mock("../../../Stores/ModalStore", () => ({
    modalVisibilityStore: writable(false),
    modalIframeStore: writable(null),
}));
vi.mock("../../../Stores/OrbitAttentionStore", () => ({ orbitAttentionCountStore: writable(0) }));
vi.mock("../../../../i18n/i18n-svelte", () => {
    const fn: unknown = new Proxy(() => "x", { get: () => fn, apply: () => "x" });
    return { default: readable(fn), LL: readable(fn) };
});

import { modalIframeStore, modalVisibilityStore } from "../../../Stores/ModalStore";
import OrbitMenuItem from "./OrbitMenuItem.svelte";

describe("OrbitMenuItem", () => {
    let component: OrbitMenuItem | undefined;
    let target: HTMLDivElement;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.append(target);
        modalVisibilityStore.set(false);
        modalIframeStore.set(null);
        closeAll.mockClear();
        openAdminModalFromMenu.mockClear();
        component = new OrbitMenuItem({ target });
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
    });

    it("closes the bar's open menu before it opens Orbit, so the bar does not stay in front of Orbit", async () => {
        target.querySelector<HTMLElement>("button")?.click();
        await tick();
        expect(closeAll).toHaveBeenCalledTimes(1);
        expect(openAdminModalFromMenu).toHaveBeenCalledTimes(1);
        expect(closeAll.mock.invocationCallOrder[0]).toBeLessThan(openAdminModalFromMenu.mock.invocationCallOrder[0]);
    });
});
