import { afterEach, describe, expect, it } from "vitest";
import type { SpaceUserExtended } from "../../Space/SpaceInterface";
import { worldRolesStore } from "../Roles/WorldRoles";
import { isBotUser, mapExtendedSpaceUserToChatUser } from "./ChatUserMapper";

describe("isBotUser", () => {
    it("is true for the bot tag", () => {
        expect(isBotUser({ tags: ["bot"], uuid: "3f2a" })).toBe(true);
    });

    it("is true for a bot- id without the tag", () => {
        expect(isBotUser({ tags: [], uuid: "bot-17" })).toBe(true);
    });

    it("is false for people, admins and guests", () => {
        expect(isBotUser({ tags: ["admin", "member"], uuid: "uuid-bob" })).toBe(false);
        expect(isBotUser({ tags: [], uuid: undefined })).toBe(false);
        expect(isBotUser({})).toBe(false);
    });
});

describe("mapExtendedSpaceUserToChatUser", () => {
    const spaceUser = (name: string) =>
        ({
            uuid: "uuid-ada",
            chatID: "@ada:chat",
            name,
            tags: [],
            reactiveUser: { availabilityStatus: undefined },
            spaceUserId: "space-1",
        } as unknown as SpaceUserExtended);

    it("carries the name they have in the world right now as the name they go by in Universe", () => {
        expect(mapExtendedSpaceUserToChatUser(spaceUser("Ada")).gameName).toBe("Ada");
        expect(mapExtendedSpaceUserToChatUser(spaceUser("")).gameName).toBeUndefined();
    });

    describe("roles", () => {
        afterEach(() => worldRolesStore.set(undefined));

        const withTags = (tags: string[]) => ({ ...spaceUser("Ada"), tags } as unknown as SpaceUserExtended);

        it("carries the roles Orbit named, highest first, for the badge", () => {
            worldRolesStore.set([
                { key: "admin", name: "Admin", color: "#F87171", visibleOnOthers: true },
                { key: "customer-service", name: "Customer Service", color: "#38BDF8", visibleOnOthers: true },
            ]);
            const user = mapExtendedSpaceUserToChatUser(withTags(["customer-service", "member", "admin"]));
            expect(user.roles?.map((role) => role.name)).toEqual(["Admin", "Customer Service"]);
        });

        it("still tells an admin by the admin tag, so worlds with no role list keep their Admin badge", () => {
            const user = mapExtendedSpaceUserToChatUser(withTags(["admin"]));
            expect(user.isAdmin).toBe(true);
            expect(user.roles).toEqual([]);
        });
    });
});
