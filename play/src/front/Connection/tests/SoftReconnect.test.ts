// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { ErrorScreenMessage } from "@workadventure/messages";
import { errorScreenStore } from "../../Stores/ErrorScreenStore";
import type { RoomPicture } from "../SoftReconnect";
import {
    BACK_IN_SHOWN_MS,
    FULL_SCREEN_AFTER_MS,
    PILL_AFTER_MS,
    createSoftReconnect,
    softReconnect,
    stillCopy,
} from "../SoftReconnect";

const picture: RoomPicture = { src: "data:image/png;base64,AAAA", left: 0, top: 0, width: 428, height: 926 };

function setup() {
    let time = 1_000_000;
    let timers: { at: number; handler: () => void; id: number }[] = [];
    let nextId = 1;
    const env = { online: true, visible: true };
    let networkListener: (() => void) | undefined;
    let visibilityListener: (() => void) | undefined;
    const soft = createSoftReconnect({
        now: () => time,
        setTimeout: (handler, ms) => {
            const id = nextId++;
            timers.push({ at: time + ms, handler, id });
            return id;
        },
        clearTimeout: (id) => {
            timers = timers.filter((timer) => timer.id !== id);
        },
        isOnline: () => env.online,
        onNetworkChange: (listener) => {
            networkListener = listener;
            return () => (networkListener = undefined);
        },
        isVisible: () => env.visible,
        onVisibilityChange: (listener) => {
            visibilityListener = listener;
            return () => (visibilityListener = undefined);
        },
    });
    const showFullScreen = vi.fn();
    return {
        soft,
        env,
        showFullScreen,
        /** Time passes, the timers due running in order. */
        wait(ms: number) {
            const end = time + ms;
            for (;;) {
                const due = timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
                if (!due) break;
                timers = timers.filter((timer) => timer !== due);
                time = due.at;
                due.handler();
            }
            time = end;
        },
        setOnline(online: boolean) {
            env.online = online;
            networkListener?.();
        },
        setVisible(visible: boolean) {
            env.visible = visible;
            visibilityListener?.();
        },
        get listening() {
            return networkListener !== undefined || visibilityListener !== undefined;
        },
        get now() {
            return time;
        },
    };
}

describe("SoftReconnect (#958)", () => {
    it("keeps the room on screen at once, with no pill for the first second", () => {
        const t = setup();
        t.soft.start(picture, t.showFullScreen);
        expect(get(t.soft)).toEqual({ picture });
        expect(t.soft.isWaiting()).toBe(true);
        t.wait(PILL_AFTER_MS - 1);
        expect(get(t.soft)?.pill).toBeUndefined();
    });

    it("says Reconnecting after a second, then Back in, then nothing", () => {
        const t = setup();
        t.soft.start(picture, t.showFullScreen);
        t.wait(PILL_AFTER_MS);
        expect(get(t.soft)).toEqual({ picture, pill: "reconnecting" });

        t.wait(1_500);
        expect(t.soft.finish()).toBe(true);
        expect(get(t.soft)).toEqual({ pill: "back" });
        expect(t.soft.isWaiting()).toBe(false);

        t.wait(BACK_IN_SHOWN_MS);
        expect(get(t.soft)).toBeUndefined();
        expect(t.showFullScreen).not.toHaveBeenCalled();
        expect(t.listening).toBe(false);
    });

    it("shows nothing at all when back in under a second", () => {
        const t = setup();
        t.soft.start(picture, t.showFullScreen);
        t.wait(600);
        expect(t.soft.finish()).toBe(true);
        expect(get(t.soft)).toBeUndefined();
        t.wait(FULL_SCREEN_AFTER_MS);
        expect(get(t.soft)).toBeUndefined();
        expect(t.showFullScreen).not.toHaveBeenCalled();
    });

    it("says You're offline while the device has no network, and Reconnecting once it has", () => {
        const t = setup();
        t.env.online = false;
        t.soft.start(picture, t.showFullScreen);
        t.wait(PILL_AFTER_MS);
        expect(get(t.soft)?.pill).toBe("offline");
        t.setOnline(true);
        expect(get(t.soft)?.pill).toBe("reconnecting");
        t.setOnline(false);
        expect(get(t.soft)?.pill).toBe("offline");
    });

    it("does not show a pill early when the network changes in the first second", () => {
        const t = setup();
        t.soft.start(picture, t.showFullScreen);
        t.setOnline(false);
        expect(get(t.soft)?.pill).toBeUndefined();
    });

    it("hands over to the full screen after 10 seconds, keeping the time of the drop", () => {
        const t = setup();
        t.soft.start(picture, t.showFullScreen);
        const droppedAt = t.now;
        t.wait(FULL_SCREEN_AFTER_MS - 1);
        expect(t.showFullScreen).not.toHaveBeenCalled();
        t.wait(1);
        expect(t.showFullScreen).toHaveBeenCalledTimes(1);
        expect(get(t.soft)).toBeUndefined();
        expect(t.soft.isWaiting()).toBe(false);
        expect(t.soft.droppedAt()).toBe(droppedAt);
        // Back in later, from the full screen: nothing of the room to put back, and no "Back in".
        expect(t.soft.finish()).toBe(false);
        expect(get(t.soft)).toBeUndefined();
        expect(t.soft.droppedAt()).toBeUndefined();
    });

    it("starts the waits only once the page is on screen", () => {
        const t = setup();
        t.env.visible = false;
        t.soft.start(picture, t.showFullScreen);
        t.wait(60_000);
        expect(get(t.soft)).toEqual({ picture });
        expect(t.showFullScreen).not.toHaveBeenCalled();
        expect(t.soft.droppedAt()).toBeUndefined();

        t.setVisible(true);
        expect(t.soft.droppedAt()).toBe(t.now);
        t.wait(PILL_AFTER_MS);
        expect(get(t.soft)?.pill).toBe("reconnecting");
        // Hidden and shown again: the waits already running are not started twice.
        t.setVisible(false);
        t.setVisible(true);
        t.wait(FULL_SCREEN_AFTER_MS - PILL_AFTER_MS);
        expect(t.showFullScreen).toHaveBeenCalledTimes(1);
    });

    it("drops everything when a screen takes over, keeping the drop time only for the Reconnecting one", () => {
        const t = setup();
        t.soft.start(picture, t.showFullScreen);
        t.wait(PILL_AFTER_MS);
        t.soft.cancel(true);
        expect(get(t.soft)).toBeUndefined();
        expect(t.soft.droppedAt()).not.toBeUndefined();
        t.wait(FULL_SCREEN_AFTER_MS);
        expect(t.showFullScreen).not.toHaveBeenCalled();

        t.soft.start(picture, t.showFullScreen);
        t.soft.cancel();
        expect(t.soft.droppedAt()).toBeUndefined();
        expect(t.listening).toBe(false);
    });

    it("starts over on a second drop while Back in shows", () => {
        const t = setup();
        t.soft.start(picture, t.showFullScreen);
        t.wait(PILL_AFTER_MS);
        t.soft.finish();
        t.soft.start(picture, t.showFullScreen);
        t.wait(BACK_IN_SHOWN_MS);
        expect(get(t.soft)).toEqual({ picture, pill: "reconnecting" });
    });

    it("the game's own one gives way to any screen", () => {
        softReconnect.start(picture, () => undefined);
        expect(softReconnect.isWaiting()).toBe(true);
        errorScreenStore.setError(ErrorScreenMessage.fromPartial({ type: "error", code: "BANNED", title: "Banned" }));
        expect(softReconnect.isWaiting()).toBe(false);
        expect(get(softReconnect)).toBeUndefined();
        expect(softReconnect.droppedAt()).toBeUndefined();
        errorScreenStore.delete();
    });
});

describe("stillCopy", () => {
    it("copies the bar without ids, test ids, camera tiles or embedded pages", () => {
        document.body.innerHTML = `
            <div id="main-layout" class="absolute z-10">
                <button data-testid="microphone-button" id="mic">Mic</button>
                <div class="camera-box"><video></video><span>Ali</span></div>
                <iframe src="about:blank"></iframe>
                <span class="label">Menu</span>
            </div>`;
        const original = document.getElementById("main-layout");
        if (!original) throw new Error("no bar");
        const copy = stillCopy(original);

        expect(copy.className).toBe("absolute z-10");
        expect(copy.getAttribute("aria-hidden")).toBe("true");
        expect(copy.querySelector("[id]")).toBeNull();
        expect(copy.id).toBe("");
        expect(copy.querySelector("[data-testid]")).toBeNull();
        expect(copy.querySelector(".camera-box, video, iframe")).toBeNull();
        expect(copy.textContent).toContain("Mic");
        expect(copy.querySelector(".label")?.textContent).toBe("Menu");
        // The page itself is untouched.
        expect(original.querySelector("[data-testid=microphone-button]")).not.toBeNull();
        expect(original.querySelector(".camera-box")).not.toBeNull();
    });
});
