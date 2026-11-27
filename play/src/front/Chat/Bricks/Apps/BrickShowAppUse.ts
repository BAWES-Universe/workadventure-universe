import { get, writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { changeMyBrick } from "../MyBricksStore";

/**
 * "Show app use" of the person's Bricks: whether chat shows which app a Brick used (the quiet steps line). A Brick's page reads
 * it with the Brick and tells it here; its Apps row says it on its line and its Apps screen changes it, so both always say the
 * same. A Brick whose setting was never saved is off, as in chat.
 */
const states = writable<Record<string, boolean>>({});
export const showAppUseStates: Readable<Record<string, boolean>> = { subscribe: states.subscribe };

/** Takes what Orbit said of one Brick's setting. */
export function seedShowAppUse(botId: string, show: boolean): void {
    states.update((all) => (all[botId] === show ? all : { ...all, [botId]: show }));
}

const busy = new Set<string>();

/** Forgets what was known (signed out, and for tests). */
export function forgetShowAppUse(): void {
    states.set({});
    busy.clear();
}

/**
 * Turns it on or off for one Brick. The switch moves at once and goes back when Orbit did not take the change. A change asked
 * while one is on its way does nothing (false): the switch is disabled meanwhile, so this is only a second guard.
 */
export async function changeShowAppUse(botId: string, show: boolean): Promise<boolean> {
    if (busy.has(botId)) return false;
    const before = get(states)[botId] ?? false;
    busy.add(botId);
    seedShowAppUse(botId, show);
    try {
        const saved = await changeMyBrick(botId, { behaviorConfig: { showToolCalls: show } });
        if (!saved) seedShowAppUse(botId, before);
        return saved;
    } finally {
        busy.delete(botId);
    }
}
