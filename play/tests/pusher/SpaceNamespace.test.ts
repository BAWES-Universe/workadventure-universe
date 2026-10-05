import { describe, expect, it } from "vitest";
import { worldSpaceNamespace } from "../../src/pusher/services/SpaceNamespace";
import { toWorldSpaceName, WORLD_SPACE_NAME } from "../../src/pusher/services/SpaceJoinPolicy";

describe("worldSpaceNamespace", () => {
    it("puts the universe in front of the world for Orbit rooms", () => {
        expect(worldSpaceNamespace("https://play.example.com/@/acme/office/lobby", "office")).toBe("acme~office");
    });

    it("keeps same-named worlds of two universes apart", () => {
        const first = worldSpaceNamespace("https://play.example.com/@/acme/office/lobby", "office");
        const second = worldSpaceNamespace("https://play.example.com/@/globex/office/lobby", "office");
        expect(first).not.toBe(second);
        expect(toWorldSpaceName(first, WORLD_SPACE_NAME)).not.toBe(toWorldSpaceName(second, WORLD_SPACE_NAME));
    });

    it("gives every room of one world the same namespace", () => {
        expect(worldSpaceNamespace("https://play.example.com/@/acme/office/lobby", "office")).toBe(
            worldSpaceNamespace("https://play.example.com/@/acme/office/kitchen?x=1#start", "office")
        );
    });

    it("keeps the world as it is for rooms outside Orbit", () => {
        expect(
            worldSpaceNamespace("http://play.workadventure.localhost/_/global/maps.example.com/map.tmj", "localWorld")
        ).toBe("localWorld");
        expect(worldSpaceNamespace("https://play.example.com/~/maps/office.wam", "localWorld")).toBe("localWorld");
    });

    it("keeps the world as it is when the room URL is not a URL", () => {
        expect(worldSpaceNamespace("not a url", "office")).toBe("office");
        expect(worldSpaceNamespace("", "office")).toBe("office");
    });

    it("never makes a name that looks like a server-only space", () => {
        expect(worldSpaceNamespace("https://play.example.com/@/acme/office/lobby", "office")).not.toContain(":");
    });
});
