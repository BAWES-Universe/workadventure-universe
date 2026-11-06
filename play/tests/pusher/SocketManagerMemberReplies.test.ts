import { beforeEach, describe, expect, it, vi } from "vitest";

// The pusher's environment is checked when SocketManager is imported
vi.hoisted(() => {
    process.env.SECRET_KEY ??= "test-secret";
    process.env.API_URL ??= "localhost:50051";
    process.env.MAP_STORAGE_API_TOKEN ??= "test-token";
    process.env.UPLOADER_URL ??= "http://uploader.example.com";
    process.env.ICON_URL ??= "http://icon.example.com";
});

const { searchMembers, getMember, getWorldChatMembers } = vi.hoisted(() => ({
    searchMembers: vi.fn(),
    getMember: vi.fn(),
    getWorldChatMembers: vi.fn(),
}));
vi.mock("../../src/pusher/services/MatrixProvider", () => ({ matrixProvider: {} }));
vi.mock("../../src/pusher/services/AdminService", () => ({
    adminService: { searchMembers, getMember, getWorldChatMembers },
}));

import type { Socket } from "../../src/pusher/services/SocketManager";
import { socketManager } from "../../src/pusher/services/SocketManager";

const EMAIL = "someone@example.test";
const textures = [{ id: "woka1", url: "http://img.test/woka1.png" }];

const client = (who: { isLogged: boolean; chatID?: string; userUuid: string }) =>
    ({
        getUserData: () => ({ ...who, roomId: "http://play.test/@/uni/world/room" }),
    } as unknown as Socket);

// Whoever asks: a guest, a stranger signed in elsewhere, or the person the member record is about.
const askers = {
    guest: client({ isLogged: false, userUuid: "guest-1" }),
    stranger: client({ isLogged: true, userUuid: "stranger-1", chatID: "@stranger:chat.test" }),
    inviter: client({ isLogged: true, userUuid: "inviter-1", chatID: "@inviter:chat.test" }),
    themself: client({ isLogged: true, userUuid: "member-1", chatID: "@member:chat.test" }),
};

describe("member replies sent to a browser never carry an email address", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe.each(Object.entries(askers))("asked by %s", (_name, asker) => {
        it("member search", async () => {
            searchMembers.mockResolvedValue([
                { id: "member-1", name: "Ada", email: EMAIL, characterTextures: textures },
                { id: "member-2", name: null, email: EMAIL },
            ]);

            const answer = await socketManager.handleSearchMemberQuery(asker, { searchText: "ada" });

            expect(JSON.stringify(answer)).not.toContain(EMAIL);
            expect(answer.members[0]).toEqual({
                id: "member-1",
                name: "Ada",
                email: undefined,
                characterTextures: textures,
            });
            expect(answer.members[1].email).toBeUndefined();
        });

        it("one member", async () => {
            getMember.mockResolvedValue({
                id: "member-1",
                name: "Ada",
                email: EMAIL,
                visitCardUrl: "http://card.test/ada",
                chatID: "@member:chat.test",
                characterTextures: textures,
            });

            const answer = await socketManager.handleGetMemberQuery(asker, { uuid: "member-1" });

            expect(JSON.stringify(answer)).not.toContain(EMAIL);
            expect(answer?.member).toMatchObject({
                id: "member-1",
                name: "Ada",
                visitCardUrl: "http://card.test/ada",
                chatID: "@member:chat.test",
                characterTextures: textures,
            });
            expect(answer?.member?.email).toBeUndefined();
        });

        it("chat members", async () => {
            getWorldChatMembers.mockResolvedValue({
                total: 1,
                members: [
                    {
                        uuid: "member-1",
                        wokaName: "Ada",
                        email: EMAIL,
                        chatId: "@member:chat.test",
                        tags: ["member"],
                        characterTextures: textures,
                    },
                ],
            });

            const answer = await socketManager.handleChatMembersQuery(asker, { searchText: "" });

            expect(JSON.stringify(answer)).not.toContain(EMAIL);
            expect(answer).toEqual({
                total: 1,
                members: [
                    {
                        uuid: "member-1",
                        wokaName: "Ada",
                        chatId: "@member:chat.test",
                        tags: ["member"],
                        characterTextures: textures,
                    },
                ],
            });
        });
    });
});
