import { describe, expect, it, vi } from "vitest";

// AdminApi reads the pusher's environment when it loads
vi.hoisted(() => {
    process.env.SECRET_KEY = "test-secret";
    process.env.API_URL = "back.test:50051";
    process.env.MAP_STORAGE_API_TOKEN = "test-token";
    process.env.UPLOADER_URL = "http://uploader.test";
    process.env.ICON_URL = "http://icon.test";
});

import { isFetchMemberDataByUuidSuccessResponse } from "../AdminApi";

const answer = {
    status: "ok",
    email: null,
    userUuid: "uuid-ada",
    tags: ["customer-service", "member"],
    visitCardUrl: null,
    isCharacterTexturesValid: true,
    characterTextures: [],
    isCompanionTextureValid: true,
    messages: [],
    world: "w",
};

describe("the role names Orbit sends with room access", () => {
    it("keeps them, so the game can show a badge", () => {
        const roles = [
            { key: "customer-service", name: "Customer Service", color: "#38BDF8", visibleOnOthers: true },
            { key: "secret", name: "Secret keepers", color: "#FACC15", visibleOnOthers: false },
        ];
        expect(isFetchMemberDataByUuidSuccessResponse.parse({ ...answer, roles }).roles).toEqual(roles);
    });

    it.each(["#fff", "#FFFA", "#38BDF8", "#38bdf8cc"])("keeps the colour %s", (color) => {
        const roles = [{ key: "a", name: "A", color, visibleOnOthers: true }];
        expect(isFetchMemberDataByUuidSuccessResponse.parse({ ...answer, roles }).roles).toEqual(roles);
    });

    it.each(["red", "#12", "#38BDF8; position: fixed", "url(https://x.test/a.png)", ""])(
        "turns the colour %j into the neutral one, so the badge is still drawn",
        (color) => {
            const roles = [{ key: "a", name: "A", color, visibleOnOthers: true }];
            expect(isFetchMemberDataByUuidSuccessResponse.parse({ ...answer, roles }).roles?.[0].color).toBe("#9AA0B4");
        }
    );

    it("leaves out a badly formed role and keeps the others, so the player still joins (#1292)", () => {
        const good = { key: "a", name: "A", color: "#38BDF8", visibleOnOthers: true };
        const roles = [
            { key: "b", name: null, color: "#38BDF8", visibleOnOthers: true },
            good,
            { key: "c", name: "C" },
        ];
        expect(isFetchMemberDataByUuidSuccessResponse.parse({ ...answer, roles }).roles).toEqual([good]);
    });

    it("accepts an answer with no list, as older Orbit versions send", () => {
        expect(isFetchMemberDataByUuidSuccessResponse.parse(answer).roles).toBeUndefined();
    });
});
