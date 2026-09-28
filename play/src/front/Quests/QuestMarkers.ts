import type { Readable } from "svelte/store";
import { derived, get } from "svelte/store";
import type { GameScene } from "../Phaser/Game/GameScene";
import { gameManager } from "../Phaser/Game/GameManager";
import { whenGameScene } from "../Phaser/Game/WhenGameScene";
import { DEPTH_OVERLAY_INDEX } from "../Phaser/Game/DepthIndexes";
import { gameSceneStore } from "../Stores/GameSceneStore";
import type { QuestPath, QuestState } from "./QuestModel";
import { markedQuestPath } from "./QuestModel";
import { prefersReducedMotion } from "./QuestMotion";
import { questStateStore, questWorldStore } from "./QuestStore";
import type { QuestTarget } from "./QuestTargets";
import { FEET_OFFSET_Y, sceneQuestTarget } from "./QuestTargets";
import type { QuestWorld } from "./QuestWorld";
import { questGiverUserId } from "./QuestWorld";

const LAVENDER = 0xc4b5fd;
const INK = 0x1b2a41;
/** The brand gradient, as the buttons and highlighted words wear it. */
const GRADIENT_START = "#8629fc";
const GRADIENT_END = "#4156f6";
const PERSON_RING_RADIUS = 18;
const AREA_HOST_FLASH_MS = 3_000;
/** The soft glow drawn around a ring, in px of texture on each side. */
const RING_GLOW_PX = 10;
const PULSE_MS = 1_600;

/** What should be marked on the map, personal to this viewer. */
interface MarkerPlan {
    state: QuestState;
    world: QuestWorld;
    /** The host bot while its offer is on screen (the invitation or the options). */
    giverUserId: number | undefined;
    /** The tracked quest, whose target is always marked. */
    tracked: QuestPath | null;
    /** Outline the host area once (an invitation was just shown). */
    flashHostArea: string | undefined;
}

type Ring = { image: Phaser.GameObjects.Image; target: QuestTarget; tween?: Phaser.Tweens.Tween };

/**
 * The markers of one map: gradient rings on the floor (under a person, or at an area's centre) and the brief
 * outline of an area host. Separate objects of their own: nothing of the map, the players or the areas is changed,
 * and the camera never moves. Everything goes when the map goes.
 */
class SceneMarkers {
    private readonly rings = new Map<"host" | "target", Ring>();
    private readonly flashes = new Set<Phaser.GameObjects.Rectangle>();
    private readonly textures = new Set<string>();
    private readonly follow = () => this.place();

    constructor(private readonly scene: GameScene) {
        scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.follow);
    }

    setRing(slot: "host" | "target", target: QuestTarget | undefined): void {
        const current = this.rings.get(slot);
        if (current && target && sameTarget(current.target, target)) return;
        if (current) {
            current.tween?.remove();
            current.image.destroy();
            this.rings.delete(slot);
        }
        if (!target) return;
        const radius = target.kind === "place" ? target.radius : PERSON_RING_RADIUS;
        const key = this.ringTexture(radius);
        if (!key) return;
        const image = this.scene.add.image(0, 0, key);
        const ring: Ring = { image, target };
        if (!prefersReducedMotion()) {
            // A gentle, slow breath; still under reduced motion.
            ring.tween = this.scene.tweens.add({
                targets: image,
                scale: { from: 1, to: 1.1 },
                alpha: { from: 1, to: 0.7 },
                duration: PULSE_MS,
                yoyo: true,
                repeat: -1,
                ease: "Sine.easeInOut",
            });
        }
        this.rings.set(slot, ring);
        this.place();
    }

    /**
     * An ellipse filled and edged with the brand gradient, with a soft glow, drawn once per radius on a canvas
     * (Phaser's own gradient fills only suit rectangles). A dark edge underneath keeps it visible on light floors.
     */
    private ringTexture(radius: number): string | undefined {
        const key = `quest-ring-${radius}`;
        if (this.scene.textures.exists(key)) return key;
        const width = radius * 2 + RING_GLOW_PX * 2;
        const height = radius + RING_GLOW_PX * 2;
        const texture = this.scene.textures.createCanvas(key, width, height);
        const context = texture?.getContext();
        if (!texture || !context) return undefined;
        this.textures.add(key);
        const gradient = context.createLinearGradient(RING_GLOW_PX, 0, RING_GLOW_PX + radius * 2, 0);
        gradient.addColorStop(0, GRADIENT_START);
        gradient.addColorStop(1, GRADIENT_END);
        const ellipse = () => {
            context.beginPath();
            context.ellipse(width / 2, height / 2, radius, radius / 2, 0, 0, Math.PI * 2);
        };
        // The dark edge, under everything.
        ellipse();
        context.lineWidth = 4;
        context.strokeStyle = "rgba(27, 42, 65, 0.5)";
        context.stroke();
        // The glow and the soft fill.
        context.save();
        context.shadowColor = "rgba(134, 41, 252, 0.85)";
        context.shadowBlur = RING_GLOW_PX;
        ellipse();
        context.globalAlpha = 0.35;
        context.fillStyle = gradient;
        context.fill();
        context.restore();
        // The gradient edge on top.
        ellipse();
        context.lineWidth = 2;
        context.strokeStyle = gradient;
        context.stroke();
        texture.refresh();
        return key;
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
        const edge = this.scene.add.rectangle(outline.x, outline.y, area.width, area.height);
        edge.setStrokeStyle(4, INK, 0.5);
        edge.setDepth(DEPTH_OVERLAY_INDEX - 1);
        this.flashes.add(edge);
        this.flashes.add(outline);
        // Scene-bound: the timer and the outline end with the map.
        this.scene.time.delayedCall(AREA_HOST_FLASH_MS, () => {
            for (const shape of [edge, outline]) {
                this.flashes.delete(shape);
                shape.destroy();
            }
        });
    }

    destroy(): void {
        this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.follow);
        for (const ring of this.rings.values()) {
            ring.tween?.remove();
            ring.image.destroy();
        }
        this.rings.clear();
        for (const outline of this.flashes) outline.destroy();
        this.flashes.clear();
        for (const key of this.textures) {
            try {
                this.scene.textures.remove(key);
            } catch {
                // The texture manager may already be gone with the game.
            }
        }
        this.textures.clear();
    }

    private place(): void {
        for (const ring of this.rings.values()) {
            if (ring.target.kind === "place") {
                ring.image.setPosition(ring.target.x, ring.target.y);
                ring.image.setDepth(ring.target.y);
                ring.image.setVisible(true);
                continue;
            }
            const person = this.scene.MapPlayersByKey.get(ring.target.userId);
            if (!person) {
                ring.image.setVisible(false);
                continue;
            }
            ring.image.setPosition(person.x, person.y + FEET_OFFSET_Y);
            // Just under the person: above the floor, behind their woka.
            ring.image.setDepth(person.depth - 1);
            ring.image.setVisible(true);
        }
    }
}

function sameTarget(a: QuestTarget, b: QuestTarget): boolean {
    if (a.kind === "player" && b.kind === "player") return a.userId === b.userId;
    if (a.kind === "place" && b.kind === "place") return a.x === b.x && a.y === b.y && a.radius === b.radius;
    return false;
}

function planStore(): Readable<MarkerPlan> {
    let previousSurface: QuestState["surface"] | undefined;
    return derived([questStateStore, questWorldStore], ([$state, $world]) => {
        const invitationJustShown = $state.surface === "invitation" && previousSurface !== "invitation";
        previousSurface = $state.surface;
        return {
            state: $state,
            world: $world,
            giverUserId: questGiverUserId($state, $world),
            tracked: markedQuestPath($state),
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
            const giver = value.world.present.find((person) => person.userId === value.giverUserId);
            markers.setRing(
                "host",
                giver && value.giverUserId !== undefined
                    ? { kind: "player", userId: giver.userId, name: giver.name }
                    : undefined
            );
            const target = value.tracked ? sceneQuestTarget(scene, value.tracked, value.state, value.world) : undefined;
            // The target is the giver itself: one ring is enough.
            const sameAsGiver = target?.kind === "player" && target.userId === value.giverUserId;
            markers.setRing("target", sameAsGiver ? undefined : target);
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
