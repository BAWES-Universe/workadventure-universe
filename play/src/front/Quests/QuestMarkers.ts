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
import { questAvailablePathsStore, questStateStore, questWorldStore } from "./QuestStore";
import { questSuppressionStore } from "./QuestUiStores";
import type { QuestTarget } from "./QuestTargets";
import { FEET_OFFSET_Y, playerFeet, sceneQuestTarget } from "./QuestTargets";
import type { QuestWorld } from "./QuestWorld";
import { questGiverUserId } from "./QuestWorld";

const LAVENDER = 0xc4b5fd;
const INK = 0x1b2a41;
/** The landing page's pair: lavender at the heart of a ring, amber at its edge. Only the world marks wear amber. */
const RING_INNER = "#c4b5fd";
const RING_EDGE = "#f5a623";
const RING_GLOW = "rgba(245, 166, 35, 0.85)";
const CONFETTI = [0xc4b5fd, 0xf5a623, 0xe9c74c, 0xffffff];
const PERSON_RING_RADIUS = 18;
const AREA_HOST_FLASH_MS = 3_000;
/** The soft glow drawn around a ring, in px of texture on each side. */
const RING_GLOW_PX = 10;
/** One breath of the ring: a little larger and softer, then back. */
const PULSE_MS = 1_600;
/** How much larger the ring is at the top of its breath. */
const RING_GROWTH = 0.1;
/**
 * The breath is drawn ahead, one frame per size. The canvas is shown upscaled, so scaling one image made each edge
 * jump a pixel on its own beat (right, then left, then top...): each frame here is drawn centred and anti-aliased,
 * and the ring sits on whole pixels, so opposite edges always move together.
 */
const RING_FRAMES = 16;
const BURST_MS = 900;
const CONFETTI_COUNT = 36;

/** What should be marked on the map, personal to this viewer. */
interface MarkerPlan {
    state: QuestState;
    world: QuestWorld;
    /** The host bot while it still has a quest the player has not taken. */
    giverUserId: number | undefined;
    /** The tracked quest, whose target is always marked. */
    tracked: QuestPath | null;
    /** Outline the host area once (an invitation was just shown). */
    flashHostArea: string | undefined;
}

/** A ring on the floor, following its target. */
type Ring = { image: Phaser.GameObjects.Image; tween?: Phaser.Tweens.Tween; target: QuestTarget };

/**
 * The markers of one map: gradient rings on the floor (under a person, or at an area's centre), the brief outline
 * of an area host, and the burst when a quest is done. Separate objects of their own: nothing of the map, the
 * players or the areas is changed, and the camera never moves. Everything goes when the map goes.
 */
class SceneMarkers {
    private readonly rings = new Map<"host" | "target", Ring>();
    private readonly flashes = new Set<Phaser.GameObjects.GameObject>();
    private readonly textures = new Set<string>();
    private readonly follow = () => this.place();

    constructor(private readonly scene: GameScene) {
        scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.follow);
    }

    setRing(slot: "host" | "target", target: QuestTarget | undefined): void {
        const current = this.rings.get(slot);
        if (current && target && sameTarget(current.target, target)) return;
        if (current) this.dropRing(current);
        this.rings.delete(slot);
        if (!target) return;
        const radius = target.kind === "place" ? target.radius : PERSON_RING_RADIUS;
        const key = this.ringTexture(radius);
        if (!key) return;
        const image = this.scene.add.image(0, 0, key, "0");
        const ring: Ring = { image, target };
        if (!prefersReducedMotion()) {
            // A gentle, slow breath for as long as the ring is shown: the one ring, a little larger and softer,
            // then back. Still under reduced motion.
            const breath = { t: 0 };
            ring.tween = this.scene.tweens.add({
                targets: breath,
                t: 1,
                duration: PULSE_MS,
                yoyo: true,
                repeat: -1,
                ease: "Sine.easeInOut",
                onUpdate: () => {
                    image.setFrame(String(Math.round(breath.t * (RING_FRAMES - 1))));
                    image.setAlpha(1 - 0.3 * breath.t);
                },
            });
        }
        this.rings.set(slot, ring);
        this.place();
    }

    private dropRing(ring: Ring): void {
        ring.tween?.remove();
        ring.image.destroy();
    }

    /**
     * An ellipse, lavender at its heart shading to amber at its edge, with a soft amber glow, drawn on a canvas
     * (Phaser's own gradient fills only suit rectangles) once per radius, in RING_FRAMES sizes side by side: frame
     * "0" is the ring at rest, the last one at the top of its breath. A dark edge underneath keeps it visible on
     * light floors.
     */
    private ringTexture(radius: number): string | undefined {
        const key = `quest-ring-${radius}`;
        if (this.scene.textures.exists(key)) return key;
        const even = (value: number) => Math.ceil(value / 2) * 2;
        const largest = radius * (1 + RING_GROWTH);
        const frameWidth = even(largest * 2 + RING_GLOW_PX * 2);
        const frameHeight = even(largest + RING_GLOW_PX * 2);
        const texture = this.scene.textures.createCanvas(key, frameWidth * RING_FRAMES, frameHeight);
        const context = texture?.getContext();
        if (!texture || !context) return undefined;
        this.textures.add(key);
        for (let index = 0; index < RING_FRAMES; index++) {
            const left = index * frameWidth;
            const size = radius * (1 + (RING_GROWTH * index) / (RING_FRAMES - 1));
            context.save();
            // Each frame stays in its own cell: the glow never bleeds into the next one.
            context.beginPath();
            context.rect(left, 0, frameWidth, frameHeight);
            context.clip();
            drawRing(context, left + frameWidth / 2, frameHeight / 2, size);
            context.restore();
            texture.add(String(index), 0, left, 0, frameWidth, frameHeight);
        }
        texture.refresh();
        return key;
    }

    /** A 4×4 white square the confetti is cut from, tinted per piece. */
    private confettiTexture(): string | undefined {
        const key = "quest-confetti";
        if (this.scene.textures.exists(key)) return key;
        const texture = this.scene.textures.createCanvas(key, 4, 4);
        const context = texture?.getContext();
        if (!texture || !context) return undefined;
        this.textures.add(key);
        context.fillStyle = "#fff";
        context.fillRect(0, 0, 4, 4);
        texture.refresh();
        return key;
    }

    /**
     * A quest is done: a ring swells from the player's feet and fades, and confetti flies up from them. About a
     * second, in the world, nothing to dismiss. Under reduced motion only the ring, without the confetti.
     */
    burst(): void {
        const feet = playerFeet(this.scene);
        if (!feet) return;
        const key = this.ringTexture(PERSON_RING_RADIUS);
        if (!key) return;
        const depth = this.scene.CurrentPlayer.depth + 1;
        const wave = this.scene.add.image(feet.x, feet.y + FEET_OFFSET_Y, key, "0");
        wave.setDepth(depth);
        this.flashes.add(wave);
        this.scene.tweens.add({
            targets: wave,
            scale: { from: 0.8, to: 2.6 },
            alpha: { from: 1, to: 0 },
            duration: BURST_MS,
            ease: "Cubic.easeOut",
            onComplete: () => {
                this.flashes.delete(wave);
                wave.destroy();
            },
        });
        if (prefersReducedMotion()) return;
        const confetti = this.confettiTexture();
        if (!confetti) return;
        const emitter = this.scene.add.particles(feet.x, feet.y - 8, confetti, {
            speed: { min: 90, max: 220 },
            angle: { min: 200, max: 340 },
            gravityY: 380,
            lifespan: { min: 700, max: 1_100 },
            scale: { start: 1.2, end: 0.2 },
            alpha: { start: 1, end: 0 },
            rotate: { start: 0, end: 360 },
            tint: CONFETTI,
            emitting: false,
        });
        emitter.setDepth(depth);
        this.flashes.add(emitter);
        emitter.explode(CONFETTI_COUNT);
        this.scene.time.delayedCall(1_300, () => {
            this.flashes.delete(emitter);
            emitter.destroy();
        });
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
        for (const ring of this.rings.values()) this.dropRing(ring);
        this.rings.clear();
        for (const object of this.flashes) object.destroy();
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

    /** On whole pixels, so the ring's drawn frames land on the screen as drawn: opposite edges move together. */
    private place(): void {
        for (const ring of this.rings.values()) {
            if (ring.target.kind === "place") {
                ring.image.setPosition(Math.round(ring.target.x), Math.round(ring.target.y));
                ring.image.setDepth(ring.target.y);
                ring.image.setVisible(true);
                continue;
            }
            const person = this.scene.MapPlayersByKey.get(ring.target.userId);
            if (!person) {
                ring.image.setVisible(false);
                continue;
            }
            ring.image.setPosition(Math.round(person.x), Math.round(person.y + FEET_OFFSET_Y));
            // Just under the person: above the floor, behind their woka.
            ring.image.setDepth(person.depth - 1);
            ring.image.setVisible(true);
        }
    }
}

/** One ring, centred on (x, y): the dark edge, the glowing gradient fill, the amber edge. */
function drawRing(context: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
    const ellipse = () => {
        context.beginPath();
        context.ellipse(x, y, radius, radius / 2, 0, 0, Math.PI * 2);
    };
    ellipse();
    context.lineWidth = 4;
    context.strokeStyle = "rgba(27, 42, 65, 0.5)";
    context.stroke();
    // The glow and the soft radial fill: a circle drawn squashed to the ellipse, so the gradient is too.
    context.save();
    context.shadowColor = RING_GLOW;
    context.shadowBlur = RING_GLOW_PX;
    context.translate(x, y);
    context.scale(1, 0.5);
    const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radius);
    gradient.addColorStop(0, RING_INNER);
    gradient.addColorStop(1, RING_EDGE);
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.globalAlpha = 0.4;
    context.fillStyle = gradient;
    context.fill();
    context.restore();
    ellipse();
    context.lineWidth = 2;
    context.strokeStyle = RING_EDGE;
    context.stroke();
}

function sameTarget(a: QuestTarget, b: QuestTarget): boolean {
    if (a.kind === "player" && b.kind === "player") return a.userId === b.userId;
    if (a.kind === "place" && b.kind === "place") return a.x === b.x && a.y === b.y && a.radius === b.radius;
    return false;
}

/**
 * The plan follows the state, the world and what covers the game: while something does (a menu, the map editor,
 * the person card, the phone chat), the rings go, as every quest surface does, and come back with it.
 */
function planStore(): Readable<MarkerPlan> {
    let previousSurface: QuestState["surface"] | undefined;
    return derived(
        [questStateStore, questWorldStore, questSuppressionStore, questAvailablePathsStore],
        ([$state, $world, $suppression, $available]) => {
            const invitationJustShown = $state.surface === "invitation" && previousSurface !== "invitation";
            previousSurface = $state.surface;
            const covered = $suppression.surfaces;
            return {
                state: $state,
                world: $world,
                giverUserId: covered ? undefined : questGiverUserId($state, $world, $available),
                tracked: covered ? null : markedQuestPath($state),
                flashHostArea:
                    invitationJustShown && !covered && $world.host.kind === "area" ? $world.host.areaId : undefined,
            };
        }
    );
}

let current: SceneMarkers | undefined;

/** The burst at the player's feet when a quest is done. Nothing without a map. */
export function burstQuestMarker(): void {
    try {
        current?.burst();
    } catch (error) {
        console.warn("Quests: could not play the burst", error);
    }
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
            current = markers;
            apply(get(plan));
            return () => {
                try {
                    markers?.destroy();
                } catch (error) {
                    console.warn("Quests: could not clear the markers", error);
                }
                if (current === markers) current = undefined;
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
