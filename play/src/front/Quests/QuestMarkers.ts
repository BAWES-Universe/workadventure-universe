import type { Readable } from "svelte/store";
import { derived, get } from "svelte/store";
import type { GameScene } from "../Phaser/Game/GameScene";
import { gameManager } from "../Phaser/Game/GameManager";
import { whenGameScene } from "../Phaser/Game/WhenGameScene";
import { DEPTH_OVERLAY_INDEX } from "../Phaser/Game/DepthIndexes";
import { gameSceneStore } from "../Stores/GameSceneStore";
import type { QuestPath, QuestState } from "./QuestModel";
import { anyAccepted, QUEST_PATHS } from "./QuestModel";
import { prefersReducedMotion } from "./QuestMotion";
import { questShowMeStore } from "./QuestShowMe";
import { questStateStore, questWorldStore } from "./QuestStore";
import type { QuestTarget } from "./QuestTargets";
import { FEET_OFFSET_Y, sceneQuestTarget } from "./QuestTargets";
import type { QuestWorld } from "./QuestWorld";

const LAVENDER = 0xc4b5fd;
const PERSON_RING_RADIUS = 18;
const AREA_HOST_FLASH_MS = 3_000;
const PULSES = 3;

/** What should be marked on the map, personal to this viewer. */
interface MarkerPlan {
    state: QuestState;
    world: QuestWorld;
    /** The host bot while the invitation is open, and after acceptance until the first payoff. */
    hostUserId: number | undefined;
    /** Show me's target. */
    showMe: QuestPath | null;
    /** Outline the host area once (an invitation was just shown). */
    flashHostArea: string | undefined;
}

type Ring = { graphics: Phaser.GameObjects.Graphics; target: QuestTarget; tween?: Phaser.Tweens.Tween };

/**
 * The markers of one map: soft lavender rings on the floor (under a person, or at an area's centre) and the brief
 * outline of an area host. Separate objects of their own: nothing of the map, the players or the areas is changed,
 * and the camera never moves. Everything goes when the map goes.
 */
class SceneMarkers {
    private readonly rings = new Map<"host" | "target", Ring>();
    private readonly flashes = new Set<Phaser.GameObjects.Rectangle>();
    private readonly follow = () => this.place();

    constructor(private readonly scene: GameScene) {
        scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.follow);
    }

    setRing(slot: "host" | "target", target: QuestTarget | undefined): void {
        const current = this.rings.get(slot);
        if (current && target && sameTarget(current.target, target)) return;
        if (current) {
            current.tween?.remove();
            current.graphics.destroy();
            this.rings.delete(slot);
        }
        if (!target) return;
        const radius = target.kind === "place" ? target.radius : PERSON_RING_RADIUS;
        const graphics = this.scene.add.graphics();
        graphics.fillStyle(LAVENDER, 0.12);
        graphics.fillEllipse(0, 0, radius * 2, radius);
        graphics.lineStyle(2, LAVENDER, 0.85);
        graphics.strokeEllipse(0, 0, radius * 2, radius);
        const ring: Ring = { graphics, target };
        if (!prefersReducedMotion()) {
            // A soft pulse that settles: never an endless animation.
            ring.tween = this.scene.tweens.add({
                targets: graphics,
                scale: { from: 1, to: 1.18 },
                alpha: { from: 1, to: 0.6 },
                duration: 700,
                yoyo: true,
                repeat: PULSES - 1,
                ease: "Sine.easeInOut",
            });
        }
        this.rings.set(slot, ring);
        this.place();
    }

    flashArea(areaId: string): void {
        const area = this.scene.getGameMapFrontWrapper().getAreas()?.get(areaId);
        if (!area) return;
        const outline = this.scene.add.rectangle(
            area.x + area.width / 2,
            area.y + area.height / 2,
            area.width,
            area.height
        );
        outline.setStrokeStyle(2, LAVENDER);
        outline.setDepth(DEPTH_OVERLAY_INDEX);
        this.flashes.add(outline);
        // Scene-bound: the timer and the outline end with the map.
        this.scene.time.delayedCall(AREA_HOST_FLASH_MS, () => {
            this.flashes.delete(outline);
            outline.destroy();
        });
    }

    destroy(): void {
        this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.follow);
        for (const ring of this.rings.values()) {
            ring.tween?.remove();
            ring.graphics.destroy();
        }
        this.rings.clear();
        for (const outline of this.flashes) outline.destroy();
        this.flashes.clear();
    }

    private place(): void {
        for (const ring of this.rings.values()) {
            if (ring.target.kind === "place") {
                ring.graphics.setPosition(ring.target.x, ring.target.y);
                ring.graphics.setDepth(ring.target.y);
                ring.graphics.setVisible(true);
                continue;
            }
            const person = this.scene.MapPlayersByKey.get(ring.target.userId);
            if (!person) {
                ring.graphics.setVisible(false);
                continue;
            }
            ring.graphics.setPosition(person.x, person.y + FEET_OFFSET_Y);
            // Just under the person: above the floor, behind their woka.
            ring.graphics.setDepth(person.depth - 1);
            ring.graphics.setVisible(true);
        }
    }
}

function sameTarget(a: QuestTarget, b: QuestTarget): boolean {
    if (a.kind === "player" && b.kind === "player") return a.userId === b.userId;
    if (a.kind === "place" && b.kind === "place") return a.x === b.x && a.y === b.y && a.radius === b.radius;
    return false;
}

function hostMarkerUserId(state: QuestState, world: QuestWorld): number | undefined {
    if (state.hidden || state.declined || world.host.kind !== "bot") return undefined;
    const invited = state.surface === "invitation" || state.surface === "options";
    const beforeFirstPayoff = anyAccepted(state) && !QUEST_PATHS.some((path) => state.quests[path].done);
    return invited || beforeFirstPayoff ? world.host.userId : undefined;
}

function planStore(): Readable<MarkerPlan> {
    let previousSurface: QuestState["surface"] | undefined;
    return derived([questStateStore, questWorldStore, questShowMeStore], ([$state, $world, $showMe]) => {
        const invitationJustShown = $state.surface === "invitation" && previousSurface !== "invitation";
        previousSurface = $state.surface;
        return {
            state: $state,
            world: $world,
            hostUserId: hostMarkerUserId($state, $world),
            showMe: $state.hidden ? null : $showMe,
            flashHostArea:
                invitationJustShown && !$state.hidden && $world.host.kind === "area" ? $world.host.areaId : undefined,
        };
    });
}

/**
 * Keeps the map's markers in step with the quest state, on whichever map is current. Started by the dock; does
 * nothing until a map is loaded, and never asks for a map that is not there.
 */
export function startQuestMarkers(): () => void {
    const plan = planStore();
    let markers: SceneMarkers | undefined;
    let disarm: (() => void) | undefined;

    const apply = (value: MarkerPlan) => {
        const scene = gameManager.tryGetCurrentGameScene();
        if (!markers || !scene) return;
        try {
            const host = value.world.present.find((person) => person.userId === value.hostUserId);
            markers.setRing(
                "host",
                host && value.hostUserId !== undefined
                    ? { kind: "player", userId: host.userId, name: host.name }
                    : undefined
            );
            const target =
                value.showMe && value.state.quests[value.showMe].accepted && !value.state.quests[value.showMe].done
                    ? sceneQuestTarget(scene, value.showMe, value.state, value.world)
                    : undefined;
            // Show me on the host itself: one ring is enough.
            const sameAsHost = target?.kind === "player" && target.userId === value.hostUserId;
            markers.setRing("target", sameAsHost ? undefined : target);
            if (value.flashHostArea) markers.flashArea(value.flashHostArea);
        } catch (error) {
            console.warn("Quests: could not mark the map", error);
        }
    };

    const stopScene = gameSceneStore.subscribe((scene) => {
        if (scene === undefined) {
            disarm?.();
            disarm = undefined;
            return;
        }
        if (disarm) return;
        disarm = whenGameScene((loaded) => {
            try {
                markers = new SceneMarkers(loaded);
            } catch (error) {
                console.warn("Quests: no markers on this map", error);
                return undefined;
            }
            apply(get(plan));
            return () => {
                try {
                    markers?.destroy();
                } catch (error) {
                    console.warn("Quests: could not clear the markers", error);
                }
                markers = undefined;
            };
        });
    });
    const stopPlan = plan.subscribe(apply);

    return () => {
        stopPlan();
        stopScene();
        disarm?.();
        disarm = undefined;
    };
}
