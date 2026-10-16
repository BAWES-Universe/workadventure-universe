import { describe, expect, it, vi } from "vitest";
import type { DirectRoomCandidate } from "../directRooms";
import {
    directInviterOf,
    isChatWithPerson,
    isListedAsDirect,
    pickChatWithPerson,
    saveDirectRooms,
    withDirectRoom,
} from "../directRooms";

function candidate(id: string, changes: Partial<DirectRoomCandidate<string>> = {}): DirectRoomCandidate<string> {
    return {
        room: id,
        myMembership: "join",
        partnerMembership: "join",
        othersHolding: 0,
        looksDirect: true,
        lastActivity: 100,
        ...changes,
    };
}

describe("isChatWithPerson", () => {
    it("is a direct room where just the two of us are joined", () => {
        expect(isChatWithPerson(candidate("a"))).toBe(true);
    });

    it("counts an invitation from the person, and a chat where they are invited", () => {
        expect(isChatWithPerson(candidate("a", { myMembership: "invite" }))).toBe(true);
        expect(isChatWithPerson(candidate("a", { partnerMembership: "invite" }))).toBe(true);
    });

    it("counts a chat the person has left while I still have it", () => {
        expect(isChatWithPerson(candidate("a", { partnerMembership: "leave" }))).toBe(true);
    });

    it("does not count an invitation the person has already left (nobody is left to join)", () => {
        expect(isChatWithPerson(candidate("a", { myMembership: "invite", partnerMembership: "leave" }))).toBe(false);
    });

    it("does not count a room I have left, or one I was banned from", () => {
        expect(isChatWithPerson(candidate("a", { myMembership: "leave" }))).toBe(false);
        expect(isChatWithPerson(candidate("a", { myMembership: "ban" }))).toBe(false);
    });

    it("does not count a room the person was banned from or never was in", () => {
        expect(isChatWithPerson(candidate("a", { partnerMembership: "ban" }))).toBe(false);
        expect(isChatWithPerson(candidate("a", { partnerMembership: undefined }))).toBe(false);
    });

    it("does not count a room with somebody else in it", () => {
        expect(isChatWithPerson(candidate("a", { othersHolding: 1 }))).toBe(false);
    });

    it("does not count a room that does not look like a direct chat (a named group of two)", () => {
        expect(isChatWithPerson(candidate("a", { looksDirect: false }))).toBe(false);
    });
});

describe("pickChatWithPerson", () => {
    it("is nothing when no room is the chat", () => {
        expect(pickChatWithPerson([candidate("a", { looksDirect: false }), candidate("b", { othersHolding: 2 })])).toBe(
            undefined
        );
        expect(pickChatWithPerson([])).toBe(undefined);
    });

    it("takes the one with the newest message, whatever the order they come in", () => {
        const rooms = [candidate("old", { lastActivity: 10 }), candidate("new", { lastActivity: 90 })];
        expect(pickChatWithPerson(rooms)).toBe("new");
        expect(pickChatWithPerson([...rooms].reverse())).toBe("new");
    });

    it("takes a joined chat before an invitation when they are as new as each other", () => {
        const rooms = [candidate("invited", { myMembership: "invite" }), candidate("joined")];
        expect(pickChatWithPerson(rooms)).toBe("joined");
    });

    it("takes a chat the person is still in before one they left when they are as new as each other", () => {
        const rooms = [candidate("left", { partnerMembership: "leave" }), candidate("there")];
        expect(pickChatWithPerson(rooms)).toBe("there");
    });

    it("skips rooms that are not the chat even when they are newer", () => {
        const rooms = [candidate("group", { looksDirect: false, lastActivity: 999 }), candidate("chat")];
        expect(pickChatWithPerson(rooms)).toBe("chat");
    });
});

describe("the list of direct chats", () => {
    it("knows whether a room is listed under a person", () => {
        expect(isListedAsDirect({ "@a:x": ["!1"] }, "@a:x", "!1")).toBe(true);
        expect(isListedAsDirect({ "@a:x": ["!1"] }, "@b:x", "!1")).toBe(false);
        expect(isListedAsDirect({ "@a:x": ["!1"] }, "@a:x", "!2")).toBe(false);
        expect(isListedAsDirect(undefined, "@a:x", "!1")).toBe(false);
    });

    it("adds a room under a person and keeps the rest", () => {
        const before = { "@a:x": ["!1"], "@b:x": ["!9"] };

        expect(withDirectRoom(before, "@a:x", "!2")).toEqual({ "@a:x": ["!1", "!2"], "@b:x": ["!9"] });
        expect(withDirectRoom(before, "@c:x", "!3")).toEqual({ "@a:x": ["!1"], "@b:x": ["!9"], "@c:x": ["!3"] });
        expect(withDirectRoom(undefined, "@c:x", "!3")).toEqual({ "@c:x": ["!3"] });
        expect(before).toEqual({ "@a:x": ["!1"], "@b:x": ["!9"] });
    });

    it("has nothing to add for a room that is listed already", () => {
        expect(withDirectRoom({ "@a:x": ["!1"] }, "@a:x", "!1")).toBeUndefined();
    });
});

describe("saveDirectRooms", () => {
    /** The server holds the list; the client's own copy is never read (it lags until the next sync). */
    function clientWith(initial: Record<string, string[]> | undefined) {
        let content = initial;
        return {
            getSafeUserId: () => "@me:x",
            http: {
                authedRequest: vi.fn(() =>
                    content
                        ? Promise.resolve(content)
                        : Promise.reject(Object.assign(new Error("not found"), { data: { errcode: "M_NOT_FOUND" } }))
                ),
            },
            setAccountData: vi.fn(async (_type: string, next: Record<string, string[]>) => {
                // A save takes a moment on the server; the list changes when it is done.
                await new Promise<void>((resolve) => {
                    setTimeout(resolve, 5);
                });
                content = next;
                return {};
            }),
            set server(next: Record<string, string[]>) {
                content = next;
            },
        };
    }

    it("saves the rooms that are missing in one write", async () => {
        const client = clientWith({ "@a:x": ["!1"] });

        await saveDirectRooms(client as never, [
            { userId: "@a:x", roomId: "!2" },
            { userId: "@b:x", roomId: "!3" },
        ]);

        expect(client.setAccountData).toHaveBeenCalledExactlyOnceWith("m.direct", {
            "@a:x": ["!1", "!2"],
            "@b:x": ["!3"],
        });
    });

    it("reads the list for the right account", async () => {
        const client = clientWith({});

        await saveDirectRooms(client as never, [{ userId: "@a:x", roomId: "!1" }]);

        expect(client.http.authedRequest).toHaveBeenCalledWith("GET", "/user/%40me%3Ax/account_data/m.direct");
    });

    it("saves nothing when everything is listed already", async () => {
        const client = clientWith({ "@a:x": ["!1"] });

        await saveDirectRooms(client as never, [{ userId: "@a:x", roomId: "!1" }]);

        expect(client.setAccountData).not.toHaveBeenCalled();
    });

    it("starts a list when the account has none", async () => {
        const client = clientWith(undefined);

        await saveDirectRooms(client as never, [{ userId: "@a:x", roomId: "!1" }]);

        expect(client.setAccountData).toHaveBeenCalledExactlyOnceWith("m.direct", { "@a:x": ["!1"] });
    });

    it("does not lose a room when two saves start at once", async () => {
        const client = clientWith({});

        await Promise.all([
            saveDirectRooms(client as never, [{ userId: "@a:x", roomId: "!1" }]),
            saveDirectRooms(client as never, [{ userId: "@b:x", roomId: "!2" }]),
        ]);

        expect(client.setAccountData).toHaveBeenCalledTimes(2);
        expect(client.setAccountData).toHaveBeenLastCalledWith("m.direct", { "@a:x": ["!1"], "@b:x": ["!2"] });
    });

    it("keeps a room another device saved a long time after this one last looked", async () => {
        const client = clientWith({ "@a:x": ["!1"] });
        await saveDirectRooms(client as never, [{ userId: "@a:x", roomId: "!2" }]);

        // Another device lists a chat, and this one has not synced for a long time.
        client.server = { "@a:x": ["!1", "!2"], "@c:x": ["!9"] };
        await saveDirectRooms(client as never, [{ userId: "@b:x", roomId: "!3" }]);

        expect(client.setAccountData).toHaveBeenLastCalledWith("m.direct", {
            "@a:x": ["!1", "!2"],
            "@c:x": ["!9"],
            "@b:x": ["!3"],
        });
    });

    it("writes nothing when the list cannot be read, rather than replacing it from a guess", async () => {
        const client = clientWith({ "@a:x": ["!1"] });
        client.http.authedRequest.mockRejectedValueOnce(new Error("offline"));

        await expect(saveDirectRooms(client as never, [{ userId: "@b:x", roomId: "!2" }])).rejects.toThrow("offline");

        expect(client.setAccountData).not.toHaveBeenCalled();
    });

    it("lets the next save run after one fails, and tells the one that failed", async () => {
        const client = clientWith({});
        client.setAccountData.mockRejectedValueOnce(new Error("offline"));

        const failing = saveDirectRooms(client as never, [{ userId: "@a:x", roomId: "!1" }]);
        const next = saveDirectRooms(client as never, [{ userId: "@b:x", roomId: "!2" }]);

        await expect(failing).rejects.toThrow("offline");
        await expect(next).resolves.toBeUndefined();
    });
});

describe("directInviterOf", () => {
    const invite = (extra: object = {}, sender = "@a:x") => ({
        type: "m.room.member",
        state_key: "@me:x",
        sender,
        content: { membership: "invite", is_direct: true, ...extra },
    });

    it("is the person whose direct invite I accepted", () => {
        expect(directInviterOf([invite()], "@me:x")).toBe("@a:x");
    });

    it("skips other events and finds the invite among them", () => {
        const events = [
            { type: "m.room.member", state_key: "@a:x", sender: "@a:x", content: { membership: "join" } },
            { type: "m.room.message", sender: "@a:x", content: {} },
            invite(),
        ];
        expect(directInviterOf(events, "@me:x")).toBe("@a:x");
    });

    it("is the person I sent the direct invite to, when I made the chat", () => {
        expect(
            directInviterOf(
                [invite({}, "@me:x")].map((e) => ({ ...e, state_key: "@a:x" })),
                "@me:x"
            )
        ).toBe("@a:x");
    });

    it("is nothing for an invite I sent without the direct flag (a group I made)", () => {
        const sent = { ...invite({ is_direct: false }, "@me:x"), state_key: "@a:x" };
        expect(directInviterOf([sent], "@me:x")).toBeUndefined();
    });

    it("is nothing for an invite without the direct flag (a group)", () => {
        expect(directInviterOf([invite({ is_direct: false })], "@me:x")).toBeUndefined();
        expect(directInviterOf([invite({ is_direct: undefined })], "@me:x")).toBeUndefined();
    });

    it("is nothing for a join, an invite of someone else, or one I sent myself", () => {
        expect(directInviterOf([invite({ membership: "join" })], "@me:x")).toBeUndefined();
        expect(directInviterOf([{ ...invite(), state_key: "@b:x" }], "@me:x")).toBeUndefined();
        expect(directInviterOf([invite({}, "@me:x")], "@me:x")).toBeUndefined();
        expect(directInviterOf([], "@me:x")).toBeUndefined();
    });
});
