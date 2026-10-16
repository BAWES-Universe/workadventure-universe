import { describe, expect, it, vi } from "vitest";
import type { EditMapCommandMessage } from "@workadventure/messages";
import type { ConnectCallback, DisconnectCallback } from "../src/Model/GameRoom";
import { GameRoom } from "../src/Model/GameRoom";
import type { Group } from "../src/Model/Group";
import type { User, UserSocket } from "../src/Model/User";
import type { EmoteCallback } from "../src/Model/Zone";

// map-storage refuses the edit called "refused" and accepts every other one, like it does for a player who may not edit.
vi.mock("../src/Services/MapStorageClient", () => ({
    getMapStorageClient: () => ({
        handleEditMapCommandWithKeyMessage: (
            request: { editMapCommandMessage: EditMapCommandMessage },
            callback: (err: Error | null, answer: EditMapCommandMessage) => void
        ) => {
            const { id } = request.editMapCommandMessage;
            if (id === "refused") {
                callback(null, {
                    id,
                    editMapMessage: {
                        message: { $case: "errorCommandMessage", errorCommandMessage: { reason: "not allowed" } },
                    },
                });
                return;
            }
            callback(null, request.editMapCommandMessage);
        },
    }),
}));

const emote: EmoteCallback = (): void => {};

async function createRoomWithWam(wamUrl: string | undefined): Promise<GameRoom> {
    const connect: ConnectCallback = (user: User, group: Group): void => {};
    const disconnect: DisconnectCallback = (user: User, group: Group): void => {};
    const room = await GameRoom.create(
        "https://play.workadventu.re/_/global/localhost/test.json",
        connect,
        disconnect,
        160,
        160,
        () => {},
        () => {},
        () => {},
        emote,
        () => {},
        () => {},
        () => {}
    );
    (room as unknown as { _wamUrl: string | undefined })._wamUrl = wamUrl;
    return room;
}

function createEditor(): { user: User; write: ReturnType<typeof vi.fn> } {
    const write = vi.fn();
    const user = {
        tags: [],
        canEdit: false,
        uuid: "player",
        socket: { write } as unknown as UserSocket,
    } as unknown as User;
    return { user, write };
}

function edit(id: string): EditMapCommandMessage {
    return {
        id,
        editMapMessage: {
            message: { $case: "deleteAreaMessage", deleteAreaMessage: { id: "area" } },
        },
    };
}

async function lockSettled(room: GameRoom): Promise<void> {
    await (room as unknown as { mapStorageLock: Promise<void> }).mapStorageLock;
}

describe("GameRoom.forwardEditMapCommandMessage", () => {
    it("keeps saving the edits that follow a refused edit", async () => {
        const room = await createRoomWithWam("http://map-storage/test.wam");
        const dispatched = vi.spyOn(room, "dispatchRoomMessage");
        const { user, write } = createEditor();

        room.forwardEditMapCommandMessage(user, edit("refused"));
        room.forwardEditMapCommandMessage(user, edit("saved"));
        await lockSettled(room);

        // The refusal goes back to the sender only.
        expect(write).toHaveBeenCalledTimes(1);
        // The edit after it reaches the room.
        expect(dispatched).toHaveBeenCalledTimes(1);
        expect(dispatched.mock.calls[0][0]).toMatchObject({
            message: { $case: "editMapCommandMessage", editMapCommandMessage: { id: "saved" } },
        });
    });

    it("keeps saving the edits that follow an edit sent while the room has no WAM", async () => {
        const room = await createRoomWithWam(undefined);
        const dispatched = vi.spyOn(room, "dispatchRoomMessage");
        const { user, write } = createEditor();

        room.forwardEditMapCommandMessage(user, edit("no-wam"));
        // The first edit finds no WAM and is refused. Only then does the room get its WAM.
        await Promise.resolve();
        (room as unknown as { _wamUrl: string })._wamUrl = "http://map-storage/test.wam";
        room.forwardEditMapCommandMessage(user, edit("saved"));
        await lockSettled(room);

        expect(write).toHaveBeenCalledTimes(1);
        expect(dispatched).toHaveBeenCalledTimes(1);
    });
});
