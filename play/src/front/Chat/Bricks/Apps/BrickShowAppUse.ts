import { get, writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { changeMyBrick } from "../MyBricksStore";

/**
 * "Show app use" of the person's Bricks: whether chat shows which app a Brick used (the quiet steps line). A Brick's page reads
 * it with the Brick and tells it here; its Apps row says it on its line and its Apps screen changes it, so both always say the
 * same. It is on unless the owner turned it off: a Brick whose setting was never saved shows it, as in chat (an unset value
 * is never written back; only a tap on the switch saves).
 */
const states = writable<Record<string, boolean>>({});
export const showAppUseStates: Readable<Record<string, boolean>> = { subscribe: states.subscribe };

/** Whether a Brick shows app use, from its saved behavior config: on unless explicitly turned off. */
export function appUseShown(config: { showToolCalls?: unknown } | undefined | null): boolean {
    return config?.showToolCalls !== false;
}

/** What is known of one Brick's setting; on when nothing is. */
export const shownIn = (all: Record<string, boolean>, botId: string): boolean => all[botId] !== false;

/** Takes what Orbit said of one Brick's setting. */
export function seedShowAppUse(botId: string, show: boolean): void {
    states.update((all) => (all[botId] === show ? all : { ...all, [botId]: show }));
}

/** The Bricks whose change is on its way to Orbit. Kept here, not in the switch's row, so the row is disabled again when the
 * person leaves the screen and comes back before the save ends. */
const saving = writable<Record<string, boolean>>({});
export const showAppUseSaving: Readable<Record<string, boolean>> = { subscribe: saving.subscribe };

/** The Bricks whose last change Orbit did not take: said under the switch, also on a screen opened again after it failed. */
const notSaved = writable<Record<string, boolean>>({});
export const showAppUseNotSaved: Readable<Record<string, boolean>> = { subscribe: notSaved.subscribe };

function setNotSaved(botId: string, on: boolean): void {
    notSaved.update((all) => {
        if (on) return all[botId] ? all : { ...all, [botId]: true };
        if (!all[botId]) return all;
        const rest = { ...all };
        delete rest[botId];
        return rest;
    });
}

function setSaving(botId: string, on: boolean): void {
    saving.update((all) => {
        if (on) return all[botId] ? all : { ...all, [botId]: true };
        if (!all[botId]) return all;
        const rest = { ...all };
        delete rest[botId];
        return rest;
    });
}

/**
 * Takes what a read of the Brick said, unless a change of this setting is on its way: the read may have been asked before Orbit
 * took the change, and would put the old value back over the switch.
 */
export function takeShowAppUse(botId: string, show: boolean): void {
    if (get(saving)[botId]) return;
    seedShowAppUse(botId, show);
}

/** Forgets what was known (signed out, and for tests). */
export function forgetShowAppUse(): void {
    states.set({});
    saving.set({});
    notSaved.set({});
}

/**
 * Turns it on or off for one Brick. The switch moves at once and goes back when Orbit did not take the change. A change asked
 * while one is on its way does nothing (false): the switch is disabled meanwhile, so this is only a second guard.
 */
export async function changeShowAppUse(botId: string, show: boolean): Promise<boolean> {
    if (get(saving)[botId]) return false;
    const before = shownIn(get(states), botId);
    setSaving(botId, true);
    setNotSaved(botId, false);
    seedShowAppUse(botId, show);
    let saved = false;
    try {
        saved = await changeMyBrick(botId, { behaviorConfig: { showToolCalls: show } });
        return saved;
    } finally {
        // What Orbit took stands, whatever a read in between said; what it did not take goes back and is said
        seedShowAppUse(botId, saved ? show : before);
        setNotSaved(botId, !saved);
        setSaving(botId, false);
    }
}
