import { describe, it, vi, expect, beforeEach } from "vitest";
import type { EditMapCommandMessage } from "@workadventure/messages";

vi.hoisted(() => {
    process.env.API_URL = "localhost:50051";
    process.env.PUSHER_URL = "http://localhost";
    process.env.MAP_STORAGE_API_TOKEN = "test";
    process.env.AUTHENTICATION_TOKEN = "test";
});

type Callback = (err: Error | null) => void;
const { clients, getAllClients } = vi.hoisted(() => {
    const clients: { handleMapStorageUploadDeleted: ReturnType<typeof vi.fn> }[] = [];
    return { clients, getAllClients: vi.fn(() => Promise.resolve(clients)) };
});
vi.mock("@workadventure/shared-utils/src/ApiClientRepository", () => ({
    ApiClientRepository: class {
        getAllClients = getAllClients;
    },
}));
vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));

import { UploadDeletionNotifier } from "../UploadDeletionNotifier";

const command: EditMapCommandMessage = {
    id: "command",
    editMapMessage: {
        message: {
            $case: "deleteCustomEntityMessage",
            deleteCustomEntityMessage: { id: "lamp", wholeUpload: true, pictureIds: ["lamp", "lamp-red"] },
        },
    },
};

describe("telling every back server that an upload was deleted (#1722)", () => {
    beforeEach(() => {
        clients.length = 0;
        getAllClients.mockClear();
        for (let i = 0; i < 3; i++) {
            clients.push({ handleMapStorageUploadDeleted: vi.fn() });
        }
    });

    it("sends the rooms and the delete to every back server, not only one", async () => {
        const wamUrls = [
            "http://localhost/universe/world/lounge/map.wam",
            "http://localhost/universe/world/attic/map.wam",
        ];
        await new UploadDeletionNotifier(["a:1", "b:1", "c:1"]).tell(wamUrls, command);

        expect(clients).toHaveLength(3);
        for (const client of clients) {
            expect(client.handleMapStorageUploadDeleted).toHaveBeenCalledTimes(1);
            expect(client.handleMapStorageUploadDeleted).toHaveBeenCalledWith(
                { wamUrls, command },
                expect.any(Function)
            );
        }
    });

    it("tells nobody when no other room lost a copy", async () => {
        await new UploadDeletionNotifier(["a:1"]).tell([], command);
        expect(getAllClients).not.toHaveBeenCalled();
    });

    it("keeps telling the other back servers when one of them can't be reached", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        clients[0].handleMapStorageUploadDeleted.mockImplementation((_request: unknown, callback: Callback) =>
            callback(new Error("unavailable"))
        );
        await new UploadDeletionNotifier(["a:1", "b:1", "c:1"]).tell(
            ["http://localhost/universe/world/lounge/map.wam"],
            command
        );
        expect(clients[1].handleMapStorageUploadDeleted).toHaveBeenCalledTimes(1);
        expect(clients[2].handleMapStorageUploadDeleted).toHaveBeenCalledTimes(1);
        expect(error).toHaveBeenCalledTimes(1);
        error.mockRestore();
    });
});
