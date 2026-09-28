import { writable } from "svelte/store";

/**
 * Opens a quest's page in Orbit (its badge, where it stands), when Orbit is there for this person; null for a guest
 * or a game without Orbit, and then the quest panel offers no link. Set by the Orbit module, so the quest code never
 * depends on it.
 */
export const questOrbitLinkStore = writable<((questId: string) => boolean) | null>(null);
