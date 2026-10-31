import { describe, expect, it } from "vitest";
import type { ObjectSoundMessage } from "@workadventure/messages";
import type { WAMFileFormat } from "@workadventure/map-editor";
import { ObjectSounds, sharedSoundOf } from "../src/Model/ObjectSounds";

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
            {
                entityId: "gong",
                propertyId: "sound",
                playing: true,
                loop: false,
                elapsedSeconds: 0,
                durationSeconds: 4,
            },
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
            {
                entityId: "gong",
                propertyId: "sound",
                playing: true,
                loop: false,
                elapsedSeconds: 2.5,
                durationSeconds: 10,
            },
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

    it("forgets sounds whose wait is over, whatever objects were clicked", () => {
        const { sounds, wait } = setUp();
        for (let i = 0; i < 50; i++) {
            sounds.click({ ...click(), entityId: `object-${i}` });
        }
        wait(5000);
        sounds.click(click());
        expect((sounds as unknown as { sounds: Map<string, unknown> }).sounds.size).toBe(1);
    });
});

describe("sharedSoundOf (#1627)", () => {
    const wam = (properties: unknown[]) =>
        ({
            entities: { gong: { x: 0, y: 0, prefabRef: { collectionName: "c", id: "p" }, properties } },
        } as unknown as WAMFileFormat);
    const audio = (fields: Record<string, unknown>) => ({
        id: "sound",
        type: "playAudio",
        audioLink: "https://example.com/gong.mp3",
        ...fields,
    });

    it("takes the loop and the wait from the saved map, not from the clicker", () => {
        expect(
            sharedSoundOf(
                wam([audio({ startsOn: "click", heardBy: "map", loop: true, clickWait: 9 })]),
                "gong",
                "sound"
            )
        ).toEqual({ loop: true, waitSeconds: 9, durationSeconds: 0 });
    });

    it("takes the length the map editor measured, and counts it unknown (0) when the map has none", () => {
        const sound = (durationSeconds?: number) =>
            sharedSoundOf(wam([audio({ startsOn: "click", heardBy: "map", durationSeconds })]), "gong", "sound");
        expect(sound(12.5)?.durationSeconds).toBe(12.5);
        expect(sound(undefined)?.durationSeconds).toBe(0);
        expect(sound(0)?.durationSeconds).toBe(0);
        expect(sound(Number.POSITIVE_INFINITY)?.durationSeconds).toBe(0);
    });

    it("backs no click on an object the map does not have, or whose sound only the clicker hears", () => {
        const map = wam([audio({ startsOn: "click", heardBy: "map" })]);
        expect(sharedSoundOf(map, "elsewhere", "sound")).toBeUndefined();
        expect(sharedSoundOf(map, "gong", "other")).toBeUndefined();
        expect(sharedSoundOf(wam([audio({ startsOn: "click", heardBy: "clicker" })]), "gong", "sound")).toBeUndefined();
        expect(sharedSoundOf(wam([audio({ startsOn: "range", heardBy: "map" })]), "gong", "sound")).toBeUndefined();
        expect(sharedSoundOf(undefined, "gong", "sound")).toBeUndefined();
    });
});
