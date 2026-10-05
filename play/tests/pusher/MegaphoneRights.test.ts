import { describe, expect, it } from "vitest";
import { setMegaphoneSettings } from "../../src/pusher/models/MegaphoneRights";

describe("setMegaphoneSettings", () => {
    it("remembers the megaphone space under the name the front joins it with", () => {
        const socketData = { megaphoneSpaceName: undefined as string | null | undefined, canUseMegaphone: false };

        setMegaphoneSettings(socketData, { enabled: true, url: "play.example.com-megaphone-Big News" });

        expect(socketData).toEqual({ megaphoneSpaceName: "playexamplecom-megaphone-big-news", canUseMegaphone: true });
    });

    it("records a room without a megaphone", () => {
        const socketData = { megaphoneSpaceName: undefined as string | null | undefined, canUseMegaphone: true };

        setMegaphoneSettings(socketData, { enabled: false, url: undefined });

        expect(socketData).toEqual({ megaphoneSpaceName: null, canUseMegaphone: false });
    });
});
