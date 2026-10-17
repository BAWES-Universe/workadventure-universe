import { describe, expect, it } from "vitest";
import { hasPermission, Permission, permissionsFrom } from "../../src/Permissions/permissions";

describe("permissionsFrom", () => {
    it("reads the number Orbit sent", () => {
        const permissions = permissionsFrom(String(1 << Permission.MODERATE_CALLS), ["admin"]);
        expect(hasPermission(permissions, Permission.MODERATE_CALLS)).toBe(true);
        // The number wins over the tags: the admin tag adds nothing
        expect(hasPermission(permissions, Permission.EDIT_MAPS)).toBe(false);
    });

    it("gives nothing to someone without tags or a number", () => {
        expect(permissionsFrom(undefined, [])).toBe(0);
        expect(permissionsFrom(undefined, ["member", "bot"])).toBe(0);
    });

    it("falls back to the tags when no number was sent", () => {
        expect(permissionsFrom(undefined, ["admin"])).toBe(16383);
        expect(permissionsFrom(undefined, ["editor"])).toBe(8416);
        expect(permissionsFrom(undefined, ["editor", "admin"])).toBe(16383);
    });

    it("lets an admin tag moderate and reach the universe, and an editor tag only edit", () => {
        const admin = permissionsFrom(undefined, ["admin"]);
        const editor = permissionsFrom(undefined, ["editor"]);
        for (const bit of [Permission.MODERATE_CALLS, Permission.BAN_AND_APPEALS, Permission.REACH_UNIVERSE]) {
            expect(hasPermission(admin, bit)).toBe(true);
            expect(hasPermission(editor, bit)).toBe(false);
        }
        expect(hasPermission(editor, Permission.EDIT_MAPS)).toBe(true);
        expect(hasPermission(admin, Permission.ADMINISTRATOR)).toBe(false);
    });

    it("treats Administrator as every permission", () => {
        const permissions = permissionsFrom(String(2 ** Permission.ADMINISTRATOR), []);
        for (const bit of Object.values(Permission)) {
            expect(hasPermission(permissions, bit)).toBe(true);
        }
    });

    it("falls back to the tags when the number is empty or garbage, and never throws", () => {
        for (const garbage of ["", " ", "abc", "-5", "1.5", "0x10", "12 ", "1e3"]) {
            expect(permissionsFrom(garbage, ["admin"])).toBe(16383);
            expect(permissionsFrom(garbage, [])).toBe(0);
        }
    });

    it("reads a number beyond 32 bits without losing it", () => {
        const permissions = permissionsFrom(String(2 ** 40 + 2 ** Permission.EDIT_MAPS), []);
        expect(hasPermission(permissions, Permission.EDIT_MAPS)).toBe(true);
        expect(hasPermission(permissions, Permission.GO_LIVE)).toBe(false);
    });

    it("falls back to the tags for a number too long to be exact", () => {
        expect(permissionsFrom("9007199254740993", ["editor"])).toBe(8416);
    });

    it("keeps a sent zero as no permission, whatever the tags say", () => {
        expect(permissionsFrom("0", ["admin", "editor"])).toBe(0);
    });
});
