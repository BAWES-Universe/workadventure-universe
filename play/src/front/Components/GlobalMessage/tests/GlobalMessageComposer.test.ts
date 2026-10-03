import { describe, expect, it } from "vitest";
import {
    availableKinds,
    initialKind,
    isBroadcastToWorld,
    isQuillTextEmpty,
    megaphoneAudience,
} from "../GlobalMessageComposer";

describe("GlobalMessageComposer", () => {
    it("offers text and audio to admins only", () => {
        expect(availableKinds(true)).toEqual(["text", "audio", "live"]);
        expect(availableKinds(false)).toEqual(["live"]);
    });

    it("opens on the live tab while broadcasting", () => {
        expect(initialKind(["text", "audio", "live"], true, "text")).toBe("live");
    });

    it("keeps the previous tab when it is still allowed", () => {
        expect(initialKind(["text", "audio", "live"], false, "audio")).toBe("audio");
        expect(initialKind(["live"], false, "audio")).toBe("live");
        expect(initialKind(["text", "audio", "live"], false, undefined)).toBe("text");
    });

    it("maps the target to the broadcastToWorld flag", () => {
        expect(isBroadcastToWorld("world")).toBe(true);
        expect(isBroadcastToWorld("room")).toBe(false);
    });

    it("reads the megaphone scope with the same WORLD default as Configure my room", () => {
        expect(megaphoneAudience("ROOM")).toBe("room");
        expect(megaphoneAudience("WORLD")).toBe("world");
        expect(megaphoneAudience(undefined)).toBe("world");
    });

    it("treats an editor holding only whitespace as empty", () => {
        expect(isQuillTextEmpty("\n")).toBe(true);
        expect(isQuillTextEmpty("  \n ")).toBe(true);
        expect(isQuillTextEmpty("Hello\n")).toBe(false);
    });
});
