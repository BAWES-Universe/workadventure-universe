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

    it("accepts an answer with no list, as older Orbit versions send", () => {
        expect(isFetchMemberDataByUuidSuccessResponse.parse(answer).roles).toBeUndefined();
    });
});
