import { describe, expect, it } from "vitest";
import { Subject } from "rxjs";
import type { PlayAudioPropertyData } from "@workadventure/map-editor";
import type { ClickObjectSoundMessage, ObjectSoundMessage } from "@workadventure/messages";
import type { AudioSource } from "../../../Components/AudioManager/AudioPlayback";
import type { SoundObject, Voice } from "../ObjectSounds";
import { ObjectSounds } from "../ObjectSounds";

const TILE = 32;

class FakeVoice implements Voice {
    sources: (AudioSource | undefined)[] = [];
    destroyed = false;
    constructor(public readonly end: () => void) {}
    setSource(source: AudioSource | undefined) {
        this.sources.push(source);
    }
    get volume() {
        return this.sources.at(-1)?.volume;
    }
    setControls() {}
    retry() {}
    destroy() {
        this.destroyed = true;
    }
}

const sound = (fields: Partial<PlayAudioPropertyData>): PlayAudioPropertyData => ({
    id: "snd",
    type: "playAudio",
    audioLink: "https://example.com/fire.mp3",
    volume: 0.6,
    ...fields,
});

function setUp(objects: SoundObject[], initial: ObjectSoundMessage[] = []) {
    const voices: FakeVoice[] = [];
    const clicks: ClickObjectSoundMessage[] = [];
    const audible: boolean[] = [];
    const updates = new Subject<ObjectSoundMessage>();
    let now = 0;
    const sounds = new ObjectSounds(
        {
            objects: () => objects,
            tileSize: () => TILE,
            createVoice: (onEnded) => {
                const voice = new FakeVoice(onEnded);
                voices.push(voice);
                return voice;
            },
            playableLink: (link) => Promise.resolve(link),
            soundLength: () => Promise.resolve(4),
            emitClick: (message) => clicks.push(message),
            blocked: () => false,
            onAudible: (value) => audible.push(value),
            onNotAllowed: () => {},
            now: () => now,
        },
        initial,
        updates
    );
    const flush = () =>
        new Promise((resolve) => {
            setTimeout(resolve, 0);
        });
    const moveTo = async (tilesAway: number) => {
        sounds.setListenerPosition(100 + tilesAway * TILE, 100);
        await flush();
    };
    return { sounds, voices, clicks, audible, updates, flush, moveTo, wait: (ms: number) => (now += ms) };
}

const fireplace = (fields: Partial<PlayAudioPropertyData> = {}): SoundObject => ({
    id: "fireplace",
    x: 100,
    y: 100,
    properties: [sound({ startsOn: "range", loop: true, fullVolumeWithin: 1, heardUpTo: 5, ...fields })],
});

describe("ObjectSounds (#1627)", () => {
    it("plays a looping range sound while in range, louder closer, and stops past 'Heard up to'", async () => {
        const { voices, audible, moveTo } = setUp([fireplace()]);
        await moveTo(8);
        expect(voices).toHaveLength(0);
        await moveTo(3);
        expect(voices).toHaveLength(1);
        expect(voices[0].sources[0]).toMatchObject({ loop: true });
        expect(voices[0].volume).toBeCloseTo(0.3);
        await moveTo(0.5);
        expect(voices[0].volume).toBeCloseTo(0.6);
        await moveTo(6);
        expect(voices[0].destroyed).toBe(true);
        expect(audible).toEqual([true, false]);
    });

    it("plays a range sound once each time someone comes within range", async () => {
        const { voices, moveTo } = setUp([fireplace({ loop: false })]);
        await moveTo(2);
        voices[0].end();
        await moveTo(1);
        expect(voices).toHaveLength(1);
        await moveTo(9);
        await moveTo(2);
        expect(voices).toHaveLength(2);
    });

    it("plays a clicked sound for the clicker only, never restarting it, and waits after it ends", async () => {
        const object: SoundObject = { id: "statue", x: 100, y: 100, properties: [sound({ clickWait: 10 })] };
        const { sounds, voices, clicks, flush, wait } = setUp([object]);
        const property = object.properties[0] as PlayAudioPropertyData;
        sounds.click("statue", property);
        await flush();
        sounds.click("statue", property);
        await flush();
        expect(voices).toHaveLength(1);
        expect(clicks).toEqual([]);
        voices[0].end();
        wait(5000);
        sounds.click("statue", property);
        await flush();
        expect(voices).toHaveLength(1);
        wait(6000);
        sounds.click("statue", property);
        await flush();
        expect(voices).toHaveLength(2);
    });

    it("sends a click for everyone to the server, and plays only what the server answers", async () => {
        const gong: SoundObject = {
            id: "gong",
            x: 100,
            y: 100,
            properties: [sound({ heardBy: "map", clickWait: 30 })],
        };
        const { sounds, voices, clicks, updates, flush, moveTo } = setUp([gong]);
        await moveTo(40);
        sounds.click("gong", gong.properties[0] as PlayAudioPropertyData);
        await flush();
        await flush();
        expect(clicks).toEqual([
            { entityId: "gong", propertyId: "snd", loop: false, durationSeconds: 4, waitSeconds: 30 },
        ]);
        expect(voices).toHaveLength(0);
        updates.next({ entityId: "gong", propertyId: "snd", playing: true, loop: false, elapsedSeconds: 0 });
        await flush();
        expect(voices).toHaveLength(1);
        // Everyone on the map hears it at the set volume, wherever they are
        expect(voices[0].volume).toBeCloseTo(0.6);
    });

    it("never plays a sound the map does not have, whatever the server says", async () => {
        const { voices, updates, flush } = setUp([fireplace()]);
        updates.next({ entityId: "elsewhere", propertyId: "snd", playing: true, loop: true, elapsedSeconds: 0 });
        updates.next({ entityId: "fireplace", propertyId: "snd", playing: true, loop: true, elapsedSeconds: 0 });
        await flush();
        expect(voices).toHaveLength(0);
    });

    it("lets someone who arrives hear a playing jukebox from where it is, at their distance", async () => {
        const jukebox: SoundObject = {
            id: "jukebox",
            x: 100,
            y: 100,
            properties: [sound({ heardBy: "range", loop: true, fullVolumeWithin: 2, heardUpTo: 8 })],
        };
        const { voices, updates, moveTo, flush } = setUp(
            [jukebox],
            [{ entityId: "jukebox", propertyId: "snd", playing: true, loop: true, elapsedSeconds: 42 }]
        );
        await moveTo(1);
        expect(voices[0].sources[0]).toMatchObject({ loop: true, startAt: 42 });
        updates.next({ entityId: "jukebox", propertyId: "snd", playing: false, loop: true, elapsedSeconds: 0 });
        await flush();
        expect(voices[0].destroyed).toBe(true);
    });
});

describe("ObjectSounds and the music controls (#1627)", () => {
    const controls = { volume: 1, muted: false, paused: false, talking: false, decreaseWhileTalking: true };

    it("stops what plays with Stop, and plays a range sound again once the player comes back", async () => {
        const { sounds, voices, moveTo, flush } = setUp([fireplace()]);
        await moveTo(2);
        sounds.setControls({ ...controls, stopped: true });
        await flush();
        expect(voices[0].destroyed).toBe(true);
        await moveTo(1);
        expect(voices).toHaveLength(1);
        await moveTo(9);
        await moveTo(1);
        expect(voices).toHaveLength(2);
    });
});
