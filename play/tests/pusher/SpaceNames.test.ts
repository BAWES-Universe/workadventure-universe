import { describe, expect, it } from "vitest";
import { toGlobalSpaceName } from "../../src/pusher/services/SpaceNames";

const orbitRoom = { world: "sales", roomId: "https://play.example.com/@/acme/sales/lobby" };
const plainRoom = { world: "localWorld", roomId: "https://play.example.com/_/global/maps.example.com/office.json" };

describe("toGlobalSpaceName", () => {
    it("keeps ordinary spaces private to the world", () => {
        expect(toGlobalSpaceName(orbitRoom, "playexamplecomacmesaleslobby-megaphone-room")).toBe(
            "sales.playexamplecomacmesaleslobby-megaphone-room"
        );
        expect(toGlobalSpaceName(orbitRoom, "acme-sales-megaphone-world")).toBe("sales.acme-sales-megaphone-world");
        expect(toGlobalSpaceName(plainRoom, "some-space")).toBe("localWorld.some-space");
    });

    it("shares the universe broadcast channel across the worlds of that universe", () => {
        const fromSales = toGlobalSpaceName(orbitRoom, "acme-megaphone-universe");
        const fromSupport = toGlobalSpaceName(
            { world: "support", roomId: "https://play.example.com/@/acme/support/desk" },
            "acme-megaphone-universe"
        );
        expect(fromSales).toBe("universe:acme-megaphone-universe");
        expect(fromSupport).toBe(fromSales);
    });

    it("does not let a room reach another universe's channel", () => {
        expect(toGlobalSpaceName(orbitRoom, "other-megaphone-universe")).toBe("sales.other-megaphone-universe");
        expect(toGlobalSpaceName(plainRoom, "acme-megaphone-universe")).toBe("localWorld.acme-megaphone-universe");
    });
});
