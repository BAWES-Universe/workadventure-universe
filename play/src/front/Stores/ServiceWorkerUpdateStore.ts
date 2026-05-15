import { writable } from "svelte/store";

export interface ServiceWorkerUpdatePrompt {
    reload: () => void;
}

export const serviceWorkerUpdateStore = writable<ServiceWorkerUpdatePrompt | undefined>(undefined);
