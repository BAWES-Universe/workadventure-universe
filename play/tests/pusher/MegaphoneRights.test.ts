import { describe, expect, it } from "vitest";
import { canGoLiveIn, setMegaphoneSettings } from "../../src/pusher/models/MegaphoneRights";

describe("setMegaphoneSettings", () => {
    it("remembers each broadcast channel under the name the front joins it with", () => {
        const socketData = { megaphoneChannels: undefined as Map<string, boolean> | undefined };

        setMegaphoneSettings(socketData, {
            enabled: true,
            url: "play.example.com-@-uni-world-lobby-megaphone-room",
            channels: [
                { url: "play.example.com-@-uni-world-lobby-megaphone-room", canStream: true },
                { url: "uni-world-megaphone-world", canStream: true },
                { url: "uni-megaphone-universe", canStream: false },
            ],
        });

        expect(socketData.megaphoneChannels).toEqual(
            new Map([
                ["playexamplecom--uni-world-lobby-megaphone-room", true],
                ["uni-world-megaphone-world", true],
                ["uni-megaphone-universe", false],
            ])
        );
    });

    it("falls back to the single channel of an older back", () => {
        const socketData = { megaphoneChannels: undefined as Map<string, boolean> | undefined };

        setMegaphoneSettings(socketData, { enabled: true, url: "host-megaphone-room", channels: [] });

        expect(socketData.megaphoneChannels).toEqual(new Map([["host-megaphone-room", true]]));
    });

    it("records a room without broadcast channels", () => {
        const socketData = { megaphoneChannels: undefined as Map<string, boolean> | undefined };

        setMegaphoneSettings(socketData, { enabled: false, url: undefined, channels: [] });

        expect(socketData.megaphoneChannels).toEqual(new Map());
    });
});

describe("canGoLiveIn", () => {
    const joined = {
        megaphoneChannels: new Map([
            ["host-lobby-megaphone-room", true],
            ["uni-megaphone-universe", false],
        ]),
    };

    it("follows the right the back sent for each of the room's channels", () => {
        expect(canGoLiveIn("host-lobby-megaphone-room", joined)).toBe(true);
        expect(canGoLiveIn("uni-megaphone-universe", joined)).toBe(false);
    });

    it("refuses another room's broadcast channel", () => {
        expect(canGoLiveIn("host-other-megaphone-room", joined)).toBe(false);
        expect(canGoLiveIn("other-world-megaphone-world", joined)).toBe(false);
    });

    it("leaves other live spaces, such as speaker zones, open", () => {
        expect(canGoLiveIn("abc123-stage", joined)).toBe(true);
    });

    it("refuses going live before the room is joined", () => {
        expect(canGoLiveIn("abc123-stage", { megaphoneChannels: undefined })).toBe(false);
    });
});
