import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import type { VersionPolicy } from "../AppUpdateCheck";
import { AppUpdateManager } from "../AppUpdateManager";

const TEST_POLICY: VersionPolicy = {
    webVersion: "2026.05.15",
    minNativeVersion: "1.1.0",
    latestNativeVersion: "1.3.0",
    updateUrl: {
        android: "https://play.google.com/store/apps/details?id=net.bawes.universe",
        ios: "https://apps.apple.com/app/id6740000000",
    },
};

function createMockServiceWorkerTarget(initialController: unknown) {
    const listeners = new Set<() => void>();
    return {
        controller: initialController,
        addEventListener: (_type: "controllerchange", listener: () => void) => {
            listeners.add(listener);
        },
        removeEventListener: (_type: "controllerchange", listener: () => void) => {
            listeners.delete(listener);
        },
        emitControllerChange: () => {
            for (const listener of listeners) {
                listener();
            }
        },
    };
}

describe("AppUpdateManager", () => {
    it("shows Service Worker reload banner on controllerchange only after an initial controller existed", () => {
        const manager = new AppUpdateManager();
        const sw = createMockServiceWorkerTarget(null);
        manager.watchServiceWorkerController(sw);

        // First claim on a fresh profile should not prompt a reload.
        sw.emitControllerChange();
        expect(get(manager.swUpdateAvailableStore)).toBe(false);

        // Subsequent controllerchange from an updated worker triggers the non-blocking reload banner.
        sw.emitControllerChange();
        expect(get(manager.swUpdateAvailableStore)).toBe(true);
    });

    it("reloads once and clears the banner when applyServiceWorkerReload is invoked", () => {
        const manager = new AppUpdateManager();
        const sw = createMockServiceWorkerTarget({ state: "activated" });
        manager.watchServiceWorkerController(sw);
        sw.emitControllerChange();
        expect(get(manager.swUpdateAvailableStore)).toBe(true);

        const reload = vi.fn();
        manager.applyServiceWorkerReload(reload);
        manager.applyServiceWorkerReload(reload);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(get(manager.swUpdateAvailableStore)).toBe(false);
    });

    it("enforces non-dismissible forced modal when nativeVersion < minNativeVersion", async () => {
        const manager = new AppUpdateManager();
        const decision = await manager.checkNativeVersionOnLaunch({
            readShellInfo: () => Promise.resolve({ version: "1.0.0", platform: "android" }),
            fetchPolicy: () => Promise.resolve(TEST_POLICY),
        });
        expect(decision?.kind).toBe("forced");
        expect(get(manager.nativeUpdateStore)?.kind).toBe("forced");

        // Mandatory updates cannot be dismissed.
        manager.dismissOptionalNativeBanner();
        expect(get(manager.nativeUpdateStore)?.kind).toBe("forced");
    });

    it("shows dismissible optional banner when minNativeVersion <= nativeVersion < latestNativeVersion", async () => {
        const manager = new AppUpdateManager();
        await manager.checkNativeVersionOnLaunch({
            readShellInfo: () => Promise.resolve({ version: "1.2.0", platform: "ios" }),
            fetchPolicy: () => Promise.resolve(TEST_POLICY),
        });
        expect(get(manager.nativeUpdateStore)?.kind).toBe("optional");

        manager.dismissOptionalNativeBanner();
        expect(get(manager.nativeUpdateStore)).toBeUndefined();
    });

    it("skips version fetch when running in a standard web browser", async () => {
        const manager = new AppUpdateManager();
        const fetchPolicy = vi.fn();
        const decision = await manager.checkNativeVersionOnLaunch({
            readShellInfo: () => Promise.resolve(undefined),
            fetchPolicy,
        });
        expect(decision).toBeUndefined();
        expect(fetchPolicy).not.toHaveBeenCalled();
    });
});
