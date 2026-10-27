import { writable } from "svelte/store";
import { describe, expect, it } from "vitest";
import type { ChatConnectionInterface, ChatRoom, ConnectionStatus } from "../../Chat/Connection/ChatConnection";
import { findChatRoom } from "../findChatRoom";

const room = { id: "!dm:chat" } as ChatRoom;

/** A chat connection whose chats are loaded only once it is online, like the Matrix one. */
function fakeConnection(status: ConnectionStatus) {
    const connectionStatus = writable<ConnectionStatus>(status);
    const connection = {
        connectionStatus,
        getRoomByID: (roomId: string) => {
            if (roomId !== room.id || status !== "ONLINE") {
                throw new Error("Room not found");
            }
            return room;
        },
    } as unknown as ChatConnectionInterface;
    const setStatus = (next: ConnectionStatus) => {
        status = next;
        connectionStatus.set(next);
    };
    return { connection, setStatus };
}

describe("findChatRoom", () => {
    it("finds the chat right away when the chats are loaded", async () => {
        const { connection } = fakeConnection("ONLINE");
        expect(await findChatRoom(connection, room.id)).toBe(room);
    });

    it("waits for the chats to load when the connection is still getting them", async () => {
        const { connection, setStatus } = fakeConnection("CONNECTING");
        const found = findChatRoom(connection, room.id);
        setStatus("ONLINE");
        expect(await found).toBe(room);
    });

    it("finds nothing, without failing, for a chat this account is not in", async () => {
        const { connection } = fakeConnection("ONLINE");
        expect(await findChatRoom(connection, "!left:chat")).toBeUndefined();
    });

    it("finds nothing, without failing, when the chat could not connect", async () => {
        const { connection } = fakeConnection("OFFLINE");
        expect(await findChatRoom(connection, room.id)).toBeUndefined();
    });
});
