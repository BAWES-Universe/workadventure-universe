import { describe, expect, it } from "vitest";
import type { ObjectSoundMessage } from "@workadventure/messages";
import { ObjectSounds } from "../src/Model/ObjectSounds";

function setUp() {
    const sent: ObjectSoundMessage[] = [];
    let now = 1_000_000;
    const sounds = new ObjectSounds(
        (message) => sent.push(message),
        () => now
    );
    return { sent, sounds, wait: (ms: number) => (now += ms) };
}

const click = (fields: { loop?: boolean; durationSeconds?: number; waitSeconds?: number } = {}) => ({
    entityId: "gong",
    propertyId: "sound",
    loop: false,
    durationSeconds: 4,
    waitSeconds: 0,
    ...fields,
});

describe("ObjectSounds (#1627)", () => {
    it("starts the sound for everyone", () => {
        const { sent, sounds } = setUp();
        sounds.click(click());
        expect(sent).toEqual([
            { entityId: "gong", propertyId: "sound", playing: true, loop: false, elapsedSeconds: 0 },
        ]);
    });

    it("never restarts a sound while it plays, nor during the wait after it", () => {
        const { sent, sounds, wait } = setUp();
        sounds.click(click({ waitSeconds: 30 }));
        wait(2000);
        sounds.click(click({ waitSeconds: 30 }));
        wait(20_000);
        sounds.click(click({ waitSeconds: 30 }));
        expect(sent).toHaveLength(1);
        wait(13_000);
        sounds.click(click({ waitSeconds: 30 }));
        expect(sent).toHaveLength(2);
    });

    it("stops a looping sound on the next click, like a jukebox", () => {
        const { sent, sounds, wait } = setUp();
        sounds.click(click({ loop: true }));
        wait(60_000);
        sounds.click(click({ loop: true }));
        expect(sent[1]).toMatchObject({ playing: false });
        expect(sounds.getMessages()).toEqual([]);
    });

    it("tells someone who arrives how far into a playing sound it is", () => {
        const { sounds, wait } = setUp();
        sounds.click(click({ durationSeconds: 10 }));
        wait(2500);
        expect(sounds.getMessages()).toEqual([
            { entityId: "gong", propertyId: "sound", playing: true, loop: false, elapsedSeconds: 2.5 },
        ]);
        wait(8000);
        expect(sounds.getMessages()).toEqual([]);
    });

    it("ignores a click without an object or with a broken length", () => {
        const { sent, sounds } = setUp();
        sounds.click(click({ durationSeconds: Number.NaN }));
        sounds.click(click({ waitSeconds: -1 }));
        sounds.click({ ...click(), entityId: "" });
        expect(sent).toEqual([]);
    });
});
