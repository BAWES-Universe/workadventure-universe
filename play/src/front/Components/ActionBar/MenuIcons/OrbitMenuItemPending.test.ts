import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { readable, writable } from "svelte/store";

vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {};
});

const openAdminModalFromMenu = vi.hoisted(() => vi.fn());
vi.mock("../../../Administration/AnalyticsClient", () => ({ analyticsClient: new Proxy({}, { get: () => () => {} }) }));
vi.mock("../../../Stores/MenuStore", () => ({
    adminDashboardActivatedStore: writable(false),
    adminDashboardPendingStore: writable(true),
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

import { adminDashboardActivatedStore, adminDashboardPendingStore } from "../../../Stores/MenuStore";
import OrbitMenuItem from "./OrbitMenuItem.svelte";

describe("OrbitMenuItem while Orbit is on its way back", () => {
    let component: OrbitMenuItem | undefined;
    let target: HTMLDivElement;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.append(target);
        adminDashboardActivatedStore.set(false);
        adminDashboardPendingStore.set(true);
        openAdminModalFromMenu.mockClear();
        component = new OrbitMenuItem({ target });
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
    });

    it("keeps its place, greyed out, and does not open Orbit", async () => {
        const button = target.querySelector<HTMLButtonElement>("button");
        expect(button).not.toBeNull();
        expect(button?.disabled).toBe(true);
        button?.click();
        await tick();
        expect(openAdminModalFromMenu).not.toHaveBeenCalled();
    });

    it("can be used once Orbit is ready", async () => {
        adminDashboardActivatedStore.set(true);
        await tick();
        const button = target.querySelector<HTMLButtonElement>("button");
        expect(button?.disabled).toBe(false);
        button?.click();
        await tick();
        expect(openAdminModalFromMenu).toHaveBeenCalledTimes(1);
    });
});
