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

async function call(guestName?: string) {
    get.mockResolvedValue({ data: {} });
    await adminApi.fetchMemberDataByUuid(
        "uuid-1",
        undefined,
        playUri,
        "127.0.0.1",
        ["woka"],
        undefined,
        "en",
        [],
        undefined,
        guestName
    );
    return get.mock.calls[0][1].params as Record<string, unknown>;
}

describe("fetchMemberDataByUuid guest name", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    it("sends the typed guest name as `name` next to the WOKA look", async () => {
        const params = await call("Nova");
        expect(params.name).toBe("Nova");
        expect(params.characterTextureIds).toEqual(["woka"]);
    });

    it("sends no name when there is none (members, bots)", async () => {
        const params = await call(undefined);
        expect(params.name).toBeUndefined();
        expect(params.userIdentifier).toBe("uuid-1");
    });
});
