import type { PlayGlobalMessage } from "@workadventure/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import type { Socket } from "../../src/pusher/services/SocketManager";
import { SocketManager } from "../../src/pusher/services/SocketManager";
import type { SpaceConnection } from "../../src/pusher/models/SpaceConnection";

// The pusher's environment is checked when SocketManager is imported
vi.hoisted(() => {
    process.env.SECRET_KEY ??= "test-secret";
    process.env.API_URL ??= "localhost:50051";
    process.env.MAP_STORAGE_API_TOKEN ??= "test-token";
    process.env.UPLOADER_URL ??= "http://uploader.example.com";
    process.env.ICON_URL ??= "http://icon.example.com";
});

vi.mock("../../src/pusher/services/MatrixProvider", () => ({ matrixProvider: {} }));
const { getRoomsFromSameUniverse, getUrlRoomsFromSameWorld, getClient } = vi.hoisted(() => ({
    getRoomsFromSameUniverse: vi.fn(),
    getUrlRoomsFromSameWorld: vi.fn(),
    getClient: vi.fn(),
}));
vi.mock("../../src/pusher/services/AdminService", () => ({
    adminService: { getRoomsFromSameUniverse, getUrlRoomsFromSameWorld },
}));
vi.mock("../../src/pusher/services/ApiClientRepository", () => ({ apiClientRepository: { getClient } }));

const HERE = "http://play.example.com/@/acme/office/lobby";
const GARDEN = "http://play.example.com/@/acme/office/garden";
const LAB = "http://play.example.com/@/acme/lab/bench";

const universe = {
    universeName: "Acme",
    worlds: [
        {
            name: "Office",
            slug: "office",
            isCurrent: true,
            rooms: [
                { name: "Lobby", roomUrl: HERE, stars: 0, visits: 0, isCurrent: true },
                { name: "Garden", roomUrl: GARDEN, stars: 0, visits: 0, isCurrent: false },
            ],
        },
        {
            name: "Lab",
            slug: "lab",
            isCurrent: false,
            rooms: [{ name: "Bench", roomUrl: LAB, stars: 0, visits: 0, isCurrent: false }],
        },
    ],
};

function makeSocket(tags: string[]): Socket {
    const data = {
        name: "Real Admin",
        tags,
        roomId: HERE,
        roomName: "Lobby",
        userUuid: "admin-1",
        characterTextures: [],
    };
    return { getUserData: () => data } as unknown as Socket;
}

function event(reach: "room" | "world" | "universe"): PlayGlobalMessage {
    return {
        type: "admin",
        content: "Hello",
        broadcastToWorld: reach !== "room",
        // What a tampered browser sends: somebody else's name and a made-up place
        broadcast: { senderName: "The Owner", reach, reachLabel: "Fake place", senderTextures: [] },
    };
}

describe("a written or voice broadcast", () => {
    const sent: { roomId: string; broadcast: { senderName?: string; reachLabel?: string; reach: string } }[] = [];
    const socketManager = new SocketManager(mock<SpaceConnection>());

    beforeEach(() => {
        sent.length = 0;
        getRoomsFromSameUniverse.mockResolvedValue(universe);
        getUrlRoomsFromSameWorld.mockResolvedValue([
            { name: "Lobby", roomUrl: HERE },
            { name: "Garden", roomUrl: GARDEN },
        ] as never);
        getClient.mockResolvedValue({
            sendAdminMessageToRoom: (message: (typeof sent)[number]) => sent.push(message),
        } as never);
    });

    it.each([
        ["room", "Lobby", [HERE]],
        ["world", "Office", [HERE, GARDEN]],
        ["universe", "Acme", [HERE, GARDEN, LAB]],
    ] as const)("shows the real sender and the real %s name, and reaches %s", async (reach, label, rooms) => {
        await socketManager.emitPlayGlobalMessage(makeSocket(["admin"]), event(reach));

        expect(sent.map((message) => message.roomId)).toEqual(rooms);
        for (const message of sent) {
            expect(message.broadcast).toMatchObject({ senderName: "Real Admin", reach, reachLabel: label });
        }
    });

    it("is still refused to someone who is not an admin", async () => {
        await expect(socketManager.emitPlayGlobalMessage(makeSocket(["editor"]), event("room"))).rejects.toThrow(
            "not an admin"
        );
        expect(sent).toEqual([]);
    });

    it("is still sent when the admin cannot name the place, with no place named (the room keeps its own name)", async () => {
        getRoomsFromSameUniverse.mockRejectedValue(new Error("admin down"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        await socketManager.emitPlayGlobalMessage(makeSocket(["admin"]), event("world"));
        await socketManager.emitPlayGlobalMessage(makeSocket(["admin"]), event("room"));

        expect(sent.map((message) => message.broadcast.reachLabel)).toEqual([undefined, undefined, "Lobby"]); // the world reaches two rooms
        expect(sent.every((message) => message.broadcast.senderName === "Real Admin")).toBe(true);
        warn.mockRestore();
    });
});
