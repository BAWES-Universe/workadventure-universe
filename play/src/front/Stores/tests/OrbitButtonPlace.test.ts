import { get } from "svelte/store";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {};
});
vi.mock("../../Administration/AnalyticsClient", () => ({ analyticsClient: new Proxy({}, { get: () => () => {} }) }));

import { adminDashboardActivatedStore, adminDashboardPendingStore, rightActionBarMenuItems } from "../MenuStore";

const ids = () => get(rightActionBarMenuItems).map((item) => item.id);

describe("Orbit's place in the right-hand bar", () => {
    afterEach(() => {
        adminDashboardActivatedStore.set(false);
        adminDashboardPendingStore.set(false);
    });

    it("has no Orbit button when Orbit is neither ready nor on its way", () => {
        expect(ids()).not.toContain("orbit");
    });

    it("shows the Orbit button while Orbit is on its way back, so Tools is not shown in its place", () => {
        adminDashboardPendingStore.set(true);
        expect(ids().at(-1)).toBe("orbit");
    });

    it("shows the Orbit button once Orbit is ready", () => {
        adminDashboardActivatedStore.set(true);
        expect(ids().at(-1)).toBe("orbit");
    });
});
