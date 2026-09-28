import type { GameScene } from "../Phaser/Game/GameScene";
import type { Point } from "./QuestGeometry";
import type { QuestPath, QuestState } from "./QuestModel";
import type { QuestWorld } from "./QuestWorld";

/** Where a quest's target is on this map, if it has one. */
export type QuestTarget =
    /** Someone on the map: follow them, they move. */
    | { kind: "player"; userId: number; name: string }
    /** A fixed place (an area's centre), with a ring sized to it. */
    | { kind: "place"; x: number; y: number; radius: number; name: string };

/** Characters stand on their feet this far below their position (as GameMapAreas tests area membership). */
export const FEET_OFFSET_Y = 16;
const MIN_PLACE_RING = 16;
const MAX_PLACE_RING = 48;

/**
 * The target for a path: Explore's fixed area, Meet's host bot if it is here (else the nearest person), none for
 * Build (it happens in the map editor).
 */
export function questTarget(
    path: QuestPath,
    state: QuestState,
    world: QuestWorld,
    player?: Point,
    positionOf?: (userId: number) => Point | undefined
): QuestTarget | undefined {
    if (path === "explore") {
        const area = world.exploreTarget?.area;
        const fixed = state.exploreArea;
        if (!area || (fixed && fixed.id !== area.id && fixed.name !== area.name)) return undefined;
        const radius = Math.min(MAX_PLACE_RING, Math.max(MIN_PLACE_RING, Math.min(area.width, area.height) / 2));
        return { kind: "place", x: area.x + area.width / 2, y: area.y + area.height / 2, radius, name: area.name };
    }
    if (path === "meet") {
        const host = world.host;
        if (
            host.kind === "bot" &&
            host.userId !== null &&
            world.present.some((person) => person.userId === host.userId)
        ) {
            return { kind: "player", userId: host.userId, name: host.name };
        }
        let nearest = world.present[0];
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (const person of world.present) {
            const position = positionOf?.(person.userId);
            if (!position || !player) continue;
            const distance = Math.hypot(position.x - player.x, position.y - player.y);
            if (distance < nearestDistance) {
                nearest = person;
                nearestDistance = distance;
            }
        }
        return nearest ? { kind: "player", userId: nearest.userId, name: nearest.name } : undefined;
    }
    return undefined;
}

/** Where the target stands right now on this map (feet for a person), or undefined if it is not here. */
export function targetPosition(scene: GameScene, target: QuestTarget): Point | undefined {
    if (target.kind === "place") return { x: target.x, y: target.y };
    const player = scene.MapPlayersByKey.get(target.userId);
    return player ? { x: player.x, y: player.y + FEET_OFFSET_Y } : undefined;
}

export function playerFeet(scene: GameScene): Point | undefined {
    const player = scene.CurrentPlayer;
    return player ? { x: player.x, y: player.y + FEET_OFFSET_Y } : undefined;
}

/** A stable key for "this target", to remember that no path leads there. */
export function targetKey(target: QuestTarget): string {
    return target.kind === "player" ? `player:${target.userId}` : `place:${target.x},${target.y}`;
}

/** questTarget, reading positions from the map (the nearest person for Meet when the host is not here). */
export function sceneQuestTarget(
    scene: GameScene,
    path: QuestPath,
    state: QuestState,
    world: QuestWorld
): QuestTarget | undefined {
    return questTarget(path, state, world, playerFeet(scene), (userId) => {
        const person = scene.MapPlayersByKey.get(userId);
        return person ? { x: person.x, y: person.y } : undefined;
    });
}
