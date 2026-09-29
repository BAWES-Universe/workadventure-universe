import type { Readable } from "svelte/store";
import { get, writable } from "svelte/store";
import { WOKA_SPEED } from "../Enum/EnvironmentVariable";
import { gameManager } from "../Phaser/Game/GameManager";
import type { QuestTarget } from "./QuestTargets";
import { targetKey, targetPosition } from "./QuestTargets";

/** Same pace as the other walk-to actions (the person card's Walk to, the personal desk). */
const WALK_SPEED_FACTOR = 2.5;

const walking = writable(false);
const unreachable = writable<ReadonlySet<string>>(new Set());
let walkId = 0;

/** True while "Walk there" is walking the player. Any key, joystick or tap cancels it, as for every walk-to. */
export const questWalkingStore: Readable<boolean> = { subscribe: walking.subscribe };

/** Targets no path leads to on this map: their walk button is hidden. */
export const questUnreachableStore: Readable<ReadonlySet<string>> = { subscribe: unreachable.subscribe };

export async function walkToQuestTarget(target: QuestTarget): Promise<void> {
    const scene = gameManager.tryGetCurrentGameScene();
    if (!scene) return;
    const position = targetPosition(scene, target);
    if (!position) return;
    const id = ++walkId;
    walking.set(true);
    try {
        await scene.moveTo(position, true, WOKA_SPEED * WALK_SPEED_FACTOR);
    } catch {
        // "No path found": this target can't be walked to from here.
        const key = targetKey(target);
        unreachable.update((keys) => new Set([...keys, key]));
    } finally {
        if (id === walkId) walking.set(false);
    }
}

export function stopQuestWalk(): void {
    if (!get(walking)) return;
    walkId += 1;
    walking.set(false);
    gameManager.tryGetCurrentGameScene()?.CurrentPlayer?.finishFollowingPath(true);
}

/** A new map: nothing is walking, and every target may be reachable again. */
export function resetQuestWalk(): void {
    walkId += 1;
    walking.set(false);
    unreachable.set(new Set());
}
