import { describe, expect, it } from "vitest";
import type { PlayAudioPropertyData } from "../src/types";
import { objectSoundGain, objectSoundSettings } from "../src/ObjectSound";

const sound = (fields: Partial<PlayAudioPropertyData> = {}): PlayAudioPropertyData => ({
    id: "s",
    type: "playAudio",
    audioLink: "https://example.com/fire.mp3",
    ...fields,
});

describe("objectSoundSettings (#1627)", () => {
    it("keeps an object sound saved before #1627 as it was: on click, for the person who clicked", () => {
        expect(objectSoundSettings(sound({ volume: 0.4 }), 32)).toEqual({
            startsOn: "click",
            heardBy: "clicker",
            loop: false,
            fullVolumeWithin: 1,
            heardUpTo: 5,
            clickWait: 0,
            volume: 0.4,
        });
    });

    it("raises 'Heard up to' to 'Full volume within' when set below it", () => {
        const settings = objectSoundSettings(sound({ startsOn: "range", fullVolumeWithin: 4, heardUpTo: 2 }), 32);
        expect(settings.heardUpTo).toBe(4);
        expect(objectSoundGain(settings, 4)).toBe(1);
        expect(objectSoundGain(settings, 4.01)).toBe(0);
    });

    it("reads upstream WorkAdventure's sound for everyone", () => {
        expect(objectSoundSettings(sound({ playForAllUsers: true }), 32).heardBy).toBe("map");
        const ranged = objectSoundSettings(sound({ playForAllUsers: true, audibleRadius: 160 }), 32);
        expect(ranged).toMatchObject({ heardBy: "range", fullVolumeWithin: 0, heardUpTo: 5 });
    });
});

describe("objectSoundGain (#1627)", () => {
    const fireplace = objectSoundSettings(sound({ startsOn: "range", fullVolumeWithin: 1, heardUpTo: 5 }), 32);

    it("is full within the first distance, fades out, and is silent from the second", () => {
        expect(objectSoundGain(fireplace, 0)).toBe(1);
        expect(objectSoundGain(fireplace, 1)).toBe(1);
        expect(objectSoundGain(fireplace, 3)).toBeCloseTo(0.5);
        expect(objectSoundGain(fireplace, 5)).toBe(0);
        expect(objectSoundGain(fireplace, 50)).toBe(0);
    });

    it("ignores the distance for a sound for the clicker or the whole map", () => {
        expect(objectSoundGain(objectSoundSettings(sound(), 32), 50)).toBe(1);
        expect(objectSoundGain(objectSoundSettings(sound({ heardBy: "map" }), 32), 50)).toBe(1);
    });
});
