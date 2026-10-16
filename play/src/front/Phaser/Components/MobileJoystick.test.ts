import type * as PhaserTypes from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { MobileJoystick as MobileJoystickType } from "./MobileJoystick";

let MobileJoystick: typeof MobileJoystickType;

// Exercise the installed Rex implementation, including its pointer ownership and cursor keys.
beforeAll(async () => {
    const { default: Phaser } = await vi.importActual<{ default: typeof PhaserTypes }>("phaser/dist/phaser.js");
    vi.stubGlobal("Phaser", Phaser);
    ({ MobileJoystick } = await import("./MobileJoystick"));
});
vi.mock("../Services/WaScaleManager", () => ({ waScaleManager: { zoomModifier: 1, uiScalingFactor: 1 } }));

function setup() {
    const input = new Phaser.Events.EventEmitter();
    const camera = { scrollX: 0, scrollY: 0, getWorldPoint: (x: number, y: number) => ({ x, y }) };
    const scene = {
        input,
        sys: { cameras: { main: camera } },
        game: { canvas: { width: 800, height: 600 } },
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
    const joystick = new MobileJoystick(scene as unknown as Phaser.Scene) as MobileJoystickType & {
        readonly pointer?: Phaser.Input.Pointer;
    };
    const pointer = { x: 100, y: 100, worldX: 100, worldY: 100, camera, isDown: true } as Phaser.Input.Pointer;
    function start(x = 100, y = 100) {
        Object.assign(pointer, { x, y, worldX: x, worldY: y, isDown: true });
        // Phaser hit-tests before the scene POINTER_DOWN handler relocates the base.
        // A touch away from the old base therefore has no base pointerdown/pointerover event.
        joystick.showAt(pointer.x, pointer.y, pointer);
    }
    function move(dx: number, dy = 0) {
        Object.assign(pointer, {
            x: joystick.x + dx,
            y: joystick.y + dy,
            worldX: joystick.x + dx,
            worldY: joystick.y + dy,
        });
        input.emit("pointermove", pointer);
        // Phaser processes pointerover after pointermove when the new point hits the base.
        if (Math.hypot(dx, dy) <= 17.5 * window.devicePixelRatio) {
            joystick.base.emit("pointerover", pointer);
        }
    }
    function release() {
        pointer.isDown = false;
        // UserInputManager's listener runs before Rex's pointerup listener.
        joystick.hide(1_000);
        input.emit("pointerup", pointer);
    }
    return { joystick, pointer, input, start, move, release };
}

afterEach(() => vi.useRealTimers());

describe("MobileJoystick with the installed Rex touch cursor", () => {
    it("captures the initial touch before a first movement beyond the hit circle", () => {
        const { joystick, pointer, start, move, release } = setup();
        start();
        expect(joystick.pointer).toBe(pointer);
        move(100);
        expect(joystick.createCursorKeys().right.isDown).toBe(true);
        expect(joystick.forceX).toBe(100);
        release();
        expect(Object.values(joystick.createCursorKeys()).every((key) => !key.isDown)).toBe(true);
        joystick.destroy();
    });

    it("accepts repeated fast drags from different positions", () => {
        const { joystick, start, move, release } = setup();
        for (const x of [100, 400, 200]) {
            start(x);
            move(-100);
            expect(joystick.createCursorKeys().left.isDown).toBe(true);
            release();
            expect(joystick.pointer).toBeUndefined();
            expect(Object.values(joystick.createCursorKeys()).every((key) => !key.isDown)).toBe(true);
        }
        joystick.destroy();
    });

    it("cancels the previous release timer while the next drag is active", () => {
        vi.useFakeTimers();
        const { joystick, start, move, release } = setup();
        start();
        release();
        vi.advanceTimersByTime(500);
        start(400);
        move(100);
        vi.advanceTimersByTime(600);
        expect(joystick.visible).toBe(true);
        expect(joystick.createCursorKeys().right.isDown).toBe(true);
        release();
        vi.advanceTimersByTime(1_000);
        expect(joystick.visible).toBe(false);
        joystick.destroy();
    });

    it("releases a cancelled touch and accepts the next drag", () => {
        const { joystick, pointer, start, move, release } = setup();
        start();
        move(100);
        // Phaser 3.86 routes TOUCH_CANCEL through processUpEvents, just like TOUCH_END.
        Object.assign(pointer, { wasCanceled: true });
        release();
        expect(joystick.pointer).toBeUndefined();
        expect(Math.hypot(joystick.forceX, joystick.forceY)).toBe(0);
        expect(Object.values(joystick.createCursorKeys()).every((key) => !key.isDown)).toBe(true);
        start(400);
        move(0, -100);
        expect(joystick.createCursorKeys().up.isDown).toBe(true);
        release();
        joystick.destroy();
    });

    it("keeps the dead zone, gradual steering, and release behavior", () => {
        const { joystick, start, move, release } = setup();
        start();
        move(5);
        expect(Object.values(joystick.createCursorKeys()).every((key) => !key.isDown)).toBe(true);
        move(20);
        expect(joystick.createCursorKeys().right.isDown).toBe(true);
        move(80, 80);
        expect(joystick.createCursorKeys().right.isDown).toBe(true);
        expect(joystick.createCursorKeys().down.isDown).toBe(true);
        release();
        expect(Object.values(joystick.createCursorKeys()).every((key) => !key.isDown)).toBe(true);
        joystick.destroy();
    });

    it("clears a pending hide on destruction", () => {
        vi.useFakeTimers();
        const { joystick, start, release } = setup();
        start();
        release();
        joystick.destroy();
        expect(vi.getTimerCount()).toBe(0);
    });
});
