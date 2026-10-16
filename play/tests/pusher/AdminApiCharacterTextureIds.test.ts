import type * as AxiosModule from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("axios", async (importOriginal) => {
    const actual = await importOriginal<typeof AxiosModule>();
    return { ...actual, default: { ...actual.default, get } };
});
vi.mock("../../src/pusher/enums/EnvironmentVariable", () => ({
    ADMIN_API_RETRY_DELAY: 0,
    ADMIN_API_TOKEN: "token",
    ADMIN_API_URL: "http://admin.test",
    OPID_PROFILE_SCREEN_PROVIDER: undefined,
}));
vi.mock("../../src/pusher/services/JWTTokenManager", () => ({ jwtTokenManager: {} }));
vi.mock("../../src/pusher/services/IceServersService", () => ({ iceServersService: {} }));

import { adminApi } from "../../src/pusher/services/AdminApi";

const playUri = "http://play.workadventure.localhost/@/uni/world/room";

const answer = (extra: Record<string, unknown>) => ({
    status: "ok",
    email: "p@example.test",
    userUuid: "uuid-1",
    tags: [],
    visitCardUrl: null,
    isCharacterTexturesValid: false,
    characterTextures: [],
    isCompanionTextureValid: true,
    messages: [],
    world: "world",
    ...extra,
});

async function fetchMember() {
    return adminApi.fetchMemberDataByUuid("uuid-1", "access", playUri, "127.0.0.1", ["old"], undefined, "en", []);
}

describe("fetchMemberDataByUuid keeps the account's WOKA ids", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    it("passes the ids on, also when the world refuses that WOKA, so /me can hand them to the device", async () => {
        get.mockResolvedValue({ data: answer({ characterTextureIds: ["cost-1"] }) });
        const result = await fetchMember();
        expect(result.status).toBe("ok");
        expect(result.status === "ok" && result.characterTextureIds).toEqual(["cost-1"]);
    });

    it("still accepts an admin that does not send them", async () => {
        get.mockResolvedValue({ data: answer({}) });
        const result = await fetchMember();
        expect(result.status).toBe("ok");
        expect(result.status === "ok" && result.characterTextureIds).toBeUndefined();
    });
});
