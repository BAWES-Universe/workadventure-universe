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

import { AxiosError } from "axios";
import { adminApi } from "../../src/pusher/services/AdminApi";

const playUri = "http://play.workadventure.localhost/@/uni/world/room";

describe("AdminApi.getChatPerson", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it("asks the back office for one person by chat ID from the asker's room, with the admin token", async () => {
        get.mockResolvedValue({
            data: { wokaName: "Alice", characterTextures: [{ id: "male1", url: "http://x/male1.png" }] },
        });

        const person = await adminApi.getChatPerson("@alice:chat.test", playUri);

        expect(get).toHaveBeenCalledWith("http://admin.test/api/chat/person", {
            headers: { Authorization: "token" },
            params: { chatId: "@alice:chat.test", playUri },
            timeout: 10_000,
        });
        expect(person).toEqual({ wokaName: "Alice", characterTextures: [{ id: "male1", url: "http://x/male1.png" }] });
    });

    it("copes with a missing name or Woka (an older back office), and a name that is null", async () => {
        get.mockResolvedValueOnce({ data: {} });
        expect(await adminApi.getChatPerson("@a:m", playUri)).toEqual({ wokaName: undefined, characterTextures: [] });
        get.mockResolvedValueOnce({ data: { wokaName: null, characterTextures: [] } });
        expect(await adminApi.getChatPerson("@a:m", playUri)).toEqual({ wokaName: undefined, characterTextures: [] });
    });

    it("is nobody when the back office has no one with that chat ID", async () => {
        get.mockRejectedValue(
            new AxiosError("not found", "ERR_BAD_REQUEST", undefined, undefined, {
                status: 404,
                data: {},
                statusText: "Not Found",
                headers: {},
                config: {} as never,
            })
        );
        expect(await adminApi.getChatPerson("@nobody:m", playUri)).toBeUndefined();
    });

    it("passes any other failure on", async () => {
        get.mockRejectedValue(new Error("connection refused"));
        await expect(adminApi.getChatPerson("@a:m", playUri)).rejects.toThrow("connection refused");
    });
});
