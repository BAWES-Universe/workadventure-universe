import type { Readable } from "svelte/store";
import { get, writable } from "svelte/store";
import type { NativeShellInfo, NativeUpdateDecision, VersionPolicy } from "./AppUpdateCheck";
import {
    VERSION_API_ENDPOINT,
    VersionPolicySchema,
    evaluateNativeUpdate,
    readCapacitorShellInfo,
} from "./AppUpdateCheck";

/** Minimal subset of `ServiceWorkerContainer` needed to detect `controllerchange` transitions. */
export interface ServiceWorkerControllerTarget {
    controller: unknown;
    addEventListener(type: "controllerchange", listener: () => void): void;
    removeEventListener(type: "controllerchange", listener: () => void): void;
}

export interface NativeVersionCheckDependencies {
    readShellInfo?: () => Promise<NativeShellInfo | undefined>;
    fetchPolicy?: () => Promise<VersionPolicy | undefined>;
}

async function fetchServerVersionPolicy(endpoint = VERSION_API_ENDPOINT): Promise<VersionPolicy | undefined> {
    if (typeof fetch === "undefined") {
        return undefined;
    }
    try {
        const response = await fetch(endpoint, {
            method: "GET",
            headers: { Accept: "application/json" },
            cache: "no-store",
        });
        if (!response.ok) return undefined;
        const parsed = VersionPolicySchema.safeParse(await response.json());
        return parsed.success ? parsed.data : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Coordinates web Service Worker update notifications and Capacitor native shell version
 * enforcement without interrupting active gameplay unless a mandatory shell update is required.
 */
export class AppUpdateManager {
    private readonly swUpdateBannerWritable = writable(false);
    private readonly nativeUpdateWritable = writable<NativeUpdateDecision | undefined>(undefined);
    private reloading = false;
    private stopWatchingSw: (() => void) | undefined;

    /** True when a newly activated Service Worker has claimed the page and awaits user-initiated reload. */
    public readonly swUpdateAvailableStore: Readable<boolean> = {
        subscribe: this.swUpdateBannerWritable.subscribe,
    };

    /** Active native shell update prompt (`forced` modal or `optional` dismissible banner), if any. */
    public readonly nativeUpdateStore: Readable<NativeUpdateDecision | undefined> = {
        subscribe: this.nativeUpdateWritable.subscribe,
    };

    /**
     * Subscribes to `controllerchange` on the browser's Service Worker container.
     * Ignores the initial claim when no previous controller existed so first-time visitors
     * do not see a spurious reload banner on initial registration.
     */
    public watchServiceWorkerController(target: ServiceWorkerControllerTarget | undefined): () => void {
        this.stopWatchingSw?.();
        if (!target) {
            return () => undefined;
        }
        let hadController = Boolean(target.controller);
        const onControllerChange = () => {
            if (!hadController) {
                hadController = true;
                return;
            }
            if (!this.reloading) {
                this.swUpdateBannerWritable.set(true);
            }
        };
        target.addEventListener("controllerchange", onControllerChange);
        const cleanup = () => {
            target.removeEventListener("controllerchange", onControllerChange);
            if (this.stopWatchingSw === cleanup) {
                this.stopWatchingSw = undefined;
            }
        };
        this.stopWatchingSw = cleanup;
        return cleanup;
    }

    /** Reloads the window once when the player taps the Service Worker update banner. */
    public applyServiceWorkerReload(reload: () => void = () => window.location.reload()): void {
        if (this.reloading) return;
        this.reloading = true;
        this.swUpdateBannerWritable.set(false);
        reload();
    }

    /** Hides the non-blocking Service Worker reload banner so gameplay can continue undisturbed. */
    public dismissServiceWorkerBanner(): void {
        this.swUpdateBannerWritable.set(false);
    }

    /**
     * Checks the installed Capacitor shell version against `GET /api/version` on launch.
     * No-ops in standard web browsers where `readShellInfo()` resolves to `undefined`.
     */
    public async checkNativeVersionOnLaunch(
        deps: NativeVersionCheckDependencies = {}
    ): Promise<NativeUpdateDecision | undefined> {
        const readShell = deps.readShellInfo ?? (() => readCapacitorShellInfo());
        const shell = await readShell();
        if (!shell) {
            return undefined;
        }
        const loadPolicy = deps.fetchPolicy ?? (() => fetchServerVersionPolicy());
        const policy = await loadPolicy();
        if (!policy) {
            return undefined;
        }
        const decision = evaluateNativeUpdate(shell, policy);
        this.nativeUpdateWritable.set(decision.kind === "up-to-date" ? undefined : decision);
        return decision;
    }

    /**
     * Dismisses the optional "New version available" banner.
     * Refuses to dismiss a mandatory `forced` update modal when `nativeVersion < minNativeVersion`.
     */
    public dismissOptionalNativeBanner(): void {
        const current = get(this.nativeUpdateWritable);
        if (current?.kind === "optional") {
            this.nativeUpdateWritable.set(undefined);
        }
    }
}

export const appUpdateManager = new AppUpdateManager();

/**
 * Starts the Service Worker `controllerchange` listener and triggers the Capacitor native shell
 * version check at application boot.
 */
export function startAppUpdateManager(): void {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        appUpdateManager.watchServiceWorkerController(navigator.serviceWorker);
    }
    void appUpdateManager.checkNativeVersionOnLaunch();
}
