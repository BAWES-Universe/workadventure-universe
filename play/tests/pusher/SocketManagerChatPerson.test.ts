import { beforeEach, describe, expect, it, vi } from "vitest";

// The pusher's environment is checked when SocketManager is imported
vi.hoisted(() => {
    process.env.SECRET_KEY ??= "test-secret";
    process.env.API_URL ??= "localhost:50051";
    process.env.MAP_STORAGE_API_TOKEN ??= "test-token";
    process.env.UPLOADER_URL ??= "http://uploader.example.com";
    process.env.ICON_URL ??= "http://icon.example.com";
});

const { getChatPerson } = vi.hoisted(() => ({ getChatPerson: vi.fn() }));
vi.mock("../../src/pusher/services/MatrixProvider", () => ({ matrixProvider: {} }));
vi.mock("../../src/pusher/services/AdminService", () => ({ adminService: { getChatPerson } }));

import type { Socket } from "../../src/pusher/services/SocketManager";
import { socketManager } from "../../src/pusher/services/SocketManager";

const client = (isLogged: boolean) =>
    ({
        getUserData: () => ({ isLogged, roomId: "http://play.test/@/uni/world/room" }),
    } as unknown as Socket);

describe("SocketManager.handleChatPersonQuery", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it("answers a signed-in player with the person's name and Woka, asked from the player's own room", async () => {
        getChatPerson.mockResolvedValue({ wokaName: "Alice", characterTextures: [{ id: "male1", url: "u" }] });

        const answer = await socketManager.handleChatPersonQuery(client(true), { chatId: "@alice:chat.test" });

        expect(getChatPerson).toHaveBeenCalledWith("@alice:chat.test", "http://play.test/@/uni/world/room");
        expect(answer).toEqual({ wokaName: "Alice", characterTextures: [{ id: "male1", url: "u" }] });
    });

    it("answers with nothing for someone the back office does not know", async () => {
        getChatPerson.mockResolvedValueOnce(undefined);
        expect(await socketManager.handleChatPersonQuery(client(true), { chatId: "@nobody:m" })).toEqual({
            wokaName: undefined,
            characterTextures: [],
        });
    });

    it("fails the query when the back office cannot answer, so the chat asks again later", async () => {
        getChatPerson.mockRejectedValueOnce(new Error("down"));
        await expect(socketManager.handleChatPersonQuery(client(true), { chatId: "@a:m" })).rejects.toThrow("down");
    });

    it("does not ask the back office for a guest, or without a chat ID", async () => {
        expect(await socketManager.handleChatPersonQuery(client(false), { chatId: "@alice:m" })).toEqual({
            characterTextures: [],
        });
        expect(await socketManager.handleChatPersonQuery(client(true), { chatId: "" })).toEqual({
            characterTextures: [],
        });
        expect(getChatPerson).not.toHaveBeenCalled();
    });
});
