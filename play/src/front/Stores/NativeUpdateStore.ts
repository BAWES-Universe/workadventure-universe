import { writable } from "svelte/store";

export interface NativeUpdatePrompt {
    blocking: boolean;
    currentVersion: string;
    requiredVersion: string;
    latestVersion: string;
    updateUrl?: string;
}

export const nativeUpdateStore = writable<NativeUpdatePrompt | undefined>(undefined);
