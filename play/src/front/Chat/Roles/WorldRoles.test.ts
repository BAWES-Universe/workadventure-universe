import { describe, expect, it } from "vitest";
import type { RoleLabel } from "./WorldRoles";
import { resolveRoles, rolesToShow } from "./WorldRoles";

const admin: RoleLabel = { key: "admin", name: "Admin", color: "#F87171", visibleOnOthers: true };
const service: RoleLabel = {
    key: "customer-service",
    name: "Customer Service",
    color: "#38BDF8",
    visibleOnOthers: true,
};
const secret: RoleLabel = { key: "secret", name: "Secret keepers", color: "#FACC15", visibleOnOthers: false };
const catalogue = [admin, secret, service];

describe("resolveRoles", () => {
    it("lists the roles in someone's tags in the order Orbit sent them, not the order of the tags", () => {
        expect(resolveRoles(["customer-service", "member", "admin"], catalogue).map((role) => role.key)).toEqual([
            "admin",
            "customer-service",
        ]);
    });

    it("never lists Member, which Orbit does not name", () => {
        expect(resolveRoles(["member"], catalogue)).toEqual([]);
    });

    it("ignores tags Orbit did not name, such as a map's own tags", () => {
        expect(resolveRoles(["vip", "bot"], catalogue)).toEqual([]);
    });

    it("lists nothing when Orbit sent no list", () => {
        expect(resolveRoles(["admin"], undefined)).toEqual([]);
        expect(resolveRoles(undefined, catalogue)).toEqual([]);
    });
});

describe("rolesToShow", () => {
    const held = resolveRoles(["admin", "secret", "customer-service"], catalogue);

    it("keeps a role with a hidden badge off other people", () => {
        expect(rolesToShow(held, false).map((role) => role.key)).toEqual(["admin", "customer-service"]);
    });

    it("shows a hidden role on the player themself", () => {
        expect(rolesToShow(held, true).map((role) => role.key)).toEqual(["admin", "secret", "customer-service"]);
    });

    it("shows nothing for a person with no roles", () => {
        expect(rolesToShow(undefined, true)).toEqual([]);
    });
});
