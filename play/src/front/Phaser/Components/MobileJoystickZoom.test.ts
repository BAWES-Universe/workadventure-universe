import type * as PhaserTypes from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { MobileJoystick as MobileJoystickType } from "./MobileJoystick";

let MobileJoystick: typeof MobileJoystickType;

// Exercise the installed Rex implementation with a real camera, because the camera zoom is what moves the finger away
// from the joystick (#1060).
beforeAll(async () => {
    const { default: Phaser } = await vi.importActual<{ default: typeof PhaserTypes }>("phaser/dist/phaser.js");
    vi.stubGlobal("Phaser", Phaser);
    ({ MobileJoystick } = await import("./MobileJoystick"));
});
vi.mock("../Services/WaScaleManager", () => ({ waScaleManager: { zoomModifier: 1, uiScalingFactor: 1 } }));

const width = 800;
const height = 600;

function setup(zoom: number, scroll = { x: 0, y: 0 }) {
    const input = new Phaser.Events.EventEmitter();
    const camera = new Phaser.Cameras.Scene2D.Camera(0, 0, width, height);
    camera.setZoom(zoom);
    camera.setScroll(scroll.x, scroll.y);
    // The game does this once per frame; without a renderer, do it by hand so the camera matrix is up to date.
    (camera as unknown as { preRender(): void }).preRender();
    const scene = {
        input,
        sys: { cameras: { main: camera } },
        game: { canvas: { width, height } },
        scale: new Phaser.Events.EventEmitter(),
        add: { image: () => new ImageStub() },
    };
    // Only rendering is stubbed. Rex installs its real object and scene listeners on these emitters.
    class ImageStub extends Phaser.Events.EventEmitter {
        scene = scene;
        x = 0;
        y = 0;
        displayOriginX = 0;
        displayOriginY = 0;
        scrollFactorX = 0;
        scrollFactorY = 0;
        visible = true;
        setInteractive() {
            return this;
        }
        setDisplaySize() {
            return this;
        }
        setDepth() {
            return this;
        }
        setAlpha() {
            return this;
        }
        setScrollFactor() {
            return this;
        }
        setPosition(x: number, y: number) {
            this.x = x;
            this.y = y;
            return this;
        }
        destroy() {
            this.emit("destroy");
            this.removeAllListeners();
        }
    }
    const joystick = new MobileJoystick(scene as unknown as Phaser.Scene);
    const pointer = { x: 0, y: 0, worldX: 0, worldY: 0, camera, isDown: true } as Phaser.Input.Pointer;
    function moveTo(x: number, y: number) {
        const world = camera.getWorldPoint(x, y);
        Object.assign(pointer, { x, y, worldX: world.x, worldY: world.y, isDown: true });
        input.emit("pointermove", pointer);
    }
    /** Finger down at a screen point, then a small jitter that makes Phaser report pointerover on the base. */
    function touch(x: number, y: number, jitter = 2) {
        moveTo(x, y);
        joystick.showAt(x, y);
        moveTo(x + jitter, y + jitter);
        joystick.base.emit("pointerover", pointer);
    }
    /** Where the camera draws the base on screen (it does not scroll, but the zoom applies). */
    function drawnAt() {
        const midX = width / 2;
        const midY = height / 2;
        return { x: midX + zoom * (joystick.x - midX), y: midY + zoom * (joystick.y - midY) };
    }
    return { joystick, touch, moveTo, drawnAt };
}

function pressedKeys(joystick: MobileJoystickType) {
    const keys = joystick.createCursorKeys();
    return Object.entries(keys)
        .filter(([, key]) => key.isDown)
        .map(([name]) => name);
}

describe("MobileJoystick when the map is zoomed out or in", () => {
    for (const zoom of [0.5, 1, 2]) {
        it(`does not walk on a tap that barely moves, at camera zoom ${zoom}`, () => {
            const { joystick, touch } = setup(zoom);
            touch(300, 300);
            expect(pressedKeys(joystick)).toEqual([]);
            joystick.destroy();
        });

        it(`draws the base under the finger, at camera zoom ${zoom}`, () => {
            const { joystick, touch, drawnAt } = setup(zoom);
            touch(300, 200);
            expect(drawnAt().x).toBeCloseTo(300, 5);
            expect(drawnAt().y).toBeCloseTo(200, 5);
            joystick.destroy();
        });

        it(`steers the way the finger moves, at camera zoom ${zoom}`, () => {
            const { joystick, touch, moveTo } = setup(zoom);
            touch(300, 300);
            moveTo(300 + 100, 300);
            expect(pressedKeys(joystick)).toEqual(["right"]);
            moveTo(300 - 100, 300);
            expect(pressedKeys(joystick)).toEqual(["left"]);
            moveTo(300, 300 + 100);
            expect(pressedKeys(joystick)).toEqual(["down"]);
            moveTo(300, 300 - 100);
            expect(pressedKeys(joystick)).toEqual(["up"]);
            joystick.destroy();
        });
    }

    it("keeps the base under the finger when the camera is scrolled and zoomed", () => {
        const { joystick, touch, drawnAt } = setup(0.5, { x: 300, y: 150 });
        touch(100, 450);
        expect(pressedKeys(joystick)).toEqual([]);
        expect(drawnAt().x).toBeCloseTo(100, 5);
        expect(drawnAt().y).toBeCloseTo(450, 5);
        joystick.destroy();
    });
});
