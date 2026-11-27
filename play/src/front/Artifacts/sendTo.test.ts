import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrickCard } from "../Chat/Bricks/Brick";
import {
    fileFromAddress,
    groupSendTargets,
    mayOfferSendTo,
    receiverOf,
    sendLinkChoice,
    sendParts,
    type SendTarget,
} from "./sendTo";

const ME = "@me:chat.test";
const MY_BRICK = "@bot_nudge:chat.test";
const OTHER_BRICK = "@bot_theirs:chat.test";
const brick = { id: "nudge", name: "Nudge Brick" } as BrickCard;
const myBricks = new Map<string, BrickCard>([[MY_BRICK, brick]]);

describe("who a chat is with", () => {
    it("is your own Brick when the one other member is it, whatever type the chat server gives the chat", () => {
        expect(receiverOf("direct", [ME, MY_BRICK], ME, myBricks)).toBe("myBrick");
        expect(receiverOf("multiple", [ME, MY_BRICK], ME, myBricks)).toBe("myBrick");
    });

    it("treats a Brick you do not own like a person", () => {
        expect(receiverOf("direct", [ME, OTHER_BRICK], ME, myBricks)).toBe("person");
    });

    it("is a group when more people are in it, even with your Brick among them", () => {
        expect(receiverOf("multiple", [ME, MY_BRICK, "@laura:chat.test"], ME, myBricks)).toBe("group");
        expect(receiverOf("multiple", [ME, "@laura:chat.test", "@omar:chat.test"], ME, myBricks)).toBe("group");
    });

    it("is a person or a group by its type while its members have not arrived", () => {
        expect(receiverOf("direct", [], ME, myBricks)).toBe("person");
        expect(receiverOf("multiple", [], ME, myBricks)).toBe("group");
    });
});

describe("who is offered Send to on a document", () => {
    it("is its owner whatever it is set to", () => {
        for (const openScope of ["me", "chat", "link", "public", undefined]) {
            expect(mayOfferSendTo({ owner: true, openScope })).toBe(true);
        }
    });

    it("is everyone else only when it opens by its link", () => {
        expect(mayOfferSendTo({ owner: false, openScope: "link" })).toBe(true);
        expect(mayOfferSendTo({ owner: false, openScope: "public" })).toBe(true);
        expect(mayOfferSendTo({ owner: false, openScope: "chat" })).toBe(false);
        expect(mayOfferSendTo({ owner: false, openScope: "me" })).toBe(false);
        expect(mayOfferSendTo({ owner: false, openScope: undefined })).toBe(false);
    });
});

describe("what a link to the document does for the receiver", () => {
    const published = { version: 2, at: "2026-11-27T10:00:00.000Z", available: true };
    const choice = (input: Partial<Parameters<typeof sendLinkChoice>[0]>) =>
        sendLinkChoice({ openScope: "me", owner: true, receiver: "person", published: null, latest: 3, ...input });

    it("cannot be chosen for a document only its owner can open, for a person, a group or a Brick that is not yours", () => {
        for (const receiver of ["person", "group"] as const) {
            expect(choice({ openScope: "me", receiver })).toEqual({ usable: false, line: { kind: "justYou" } });
        }
        // A Brick you do not own is a person
        expect(
            choice({
                openScope: "me",
                receiver: receiverOf("direct", [ME, OTHER_BRICK], ME, myBricks),
            })
        ).toEqual({ usable: false, line: { kind: "justYou" } });
    });

    it("works for your own Brick when only you can open it, and says so", () => {
        expect(choice({ openScope: "me", receiver: "myBrick" })).toEqual({ usable: true, line: { kind: "myBrick" } });
    });

    it("is not offered as working in a group chat that holds your Brick", () => {
        const receiver = receiverOf("multiple", [ME, MY_BRICK, "@laura:chat.test"], ME, myBricks);
        expect(choice({ openScope: "me", receiver }).usable).toBe(false);
    });

    it("can be chosen for a document that people in its chat can open, with a line saying who it opens for", () => {
        expect(choice({ openScope: "chat", receiver: "person" })).toEqual({ usable: true, line: { kind: "chat" } });
        expect(choice({ openScope: "chat", receiver: "group" })).toEqual({ usable: true, line: { kind: "chat" } });
        expect(choice({ openScope: "chat", receiver: "myBrick" })).toEqual({ usable: true, line: { kind: "myBrick" } });
    });

    it("opens the latest version for anyone with the link when nothing is published", () => {
        expect(choice({ openScope: "link", published: null })).toEqual({ usable: true, line: { kind: "latest" } });
    });

    it("opens the published version, not the latest, for a link and for Public", () => {
        for (const openScope of ["link", "public"]) {
            expect(choice({ openScope, published })).toEqual({
                usable: true,
                line: { kind: "published", version: 2, behind: true },
            });
        }
        expect(choice({ openScope: "link", published, latest: 2 }).line).toEqual({
            kind: "published",
            version: 2,
            behind: false,
        });
    });

    it("cannot be chosen for Public with nothing published, or with the published version gone", () => {
        expect(choice({ openScope: "public", published: null })).toEqual({
            usable: false,
            line: { kind: "nothingPublished" },
        });
        expect(choice({ openScope: "public", published: { ...published, available: false } })).toEqual({
            usable: false,
            line: { kind: "nothingPublished" },
        });
        // Only its owner's own Brick still reads it
        expect(choice({ openScope: "public", published: null, receiver: "myBrick" })).toEqual({
            usable: true,
            line: { kind: "myBrick" },
        });
    });

    it("tells someone who is not the owner only what they know: the owner's link setting is followed", () => {
        // What was published is told to the owner alone
        for (const openScope of ["link", "public"]) {
            expect(choice({ openScope, owner: false, published })).toEqual({
                usable: true,
                line: { kind: "byOwner" },
            });
        }
    });

    it("keeps a document to its owner when the setting is one this game does not know", () => {
        expect(choice({ openScope: "everyone", receiver: "person" }).usable).toBe(false);
        expect(choice({ openScope: undefined, receiver: "person" }).usable).toBe(false);
    });
});

describe("the list of chats to send to", () => {
    const target = (id: string, name: string, group: SendTarget["group"], timestamp: number): SendTarget => ({
        id,
        name,
        group,
        timestamp,
    });
    const targets = [
        target("1", "Laura", "chat", 30),
        target("2", "Nudge Brick", "brick", 10),
        target("3", "Team room", "chat", 50),
        target("4", "Research Brick", "brick", 20),
        target("5", "Omar", "chat", 0),
    ];

    it("puts Bricks first and then the rest, each newest first", () => {
        const { bricks, chats } = groupSendTargets(targets, "");
        expect(bricks.map((one) => one.name)).toEqual(["Research Brick", "Nudge Brick"]);
        expect(chats.map((one) => one.name)).toEqual(["Team room", "Laura", "Omar"]);
    });

    it("keeps what a search finds, whatever the case", () => {
        const { bricks, chats } = groupSendTargets(targets, "  BRICK ");
        expect(bricks.map((one) => one.name)).toEqual(["Research Brick", "Nudge Brick"]);
        expect(chats).toEqual([]);
        expect(groupSendTargets(targets, "la").chats.map((one) => one.name)).toEqual(["Laura"]);
    });

    it("finds no one for a name nobody has", () => {
        expect(groupSendTargets(targets, "zzz")).toEqual({ bricks: [], chats: [] });
    });
});

describe("sending", () => {
    const file = new File(["# Notes"], "Notes.md", { type: "text/markdown" });
    const link = "https://orbit.test/a/abc";

    it("sends the file through the chat's file send, and the link as the person's own words", async () => {
        const room = {
            sendFileOrThrow: vi.fn().mockResolvedValue(undefined),
            sendMessageConfirmed: vi.fn().mockResolvedValue(undefined),
        };
        const result = await sendParts(room, { makeFile: () => Promise.resolve(file), link }, ["file", "link"]);
        expect(result).toEqual({ sent: ["file", "link"], failed: [] });
        expect(room.sendFileOrThrow).toHaveBeenCalledWith(file);
        expect(room.sendMessageConfirmed).toHaveBeenCalledWith(link);
    });

    it("sends only what was chosen", async () => {
        const room = {
            sendFileOrThrow: vi.fn().mockResolvedValue(undefined),
            sendMessageConfirmed: vi.fn().mockResolvedValue(undefined),
        };
        await sendParts(room, { makeFile: () => Promise.resolve(file), link }, ["link"]);
        expect(room.sendFileOrThrow).not.toHaveBeenCalled();
        expect(room.sendMessageConfirmed).toHaveBeenCalledOnce();
    });

    it("says which part did not go, and still sends the other", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const room = {
            sendFileOrThrow: vi.fn().mockRejectedValue(new Error("upload failed")),
            sendMessageConfirmed: vi.fn().mockResolvedValue(undefined),
        };
        const result = await sendParts(room, { makeFile: () => Promise.resolve(file), link }, ["file", "link"]);
        expect(result).toEqual({ sent: ["link"], failed: ["file"] });
    });

    it("says nothing was sent when nothing went", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const room = {
            sendFileOrThrow: vi.fn().mockRejectedValue(new Error("offline")),
            sendMessageConfirmed: vi.fn().mockRejectedValue(new Error("offline")),
        };
        expect(await sendParts(room, { makeFile: () => Promise.resolve(file), link }, ["file", "link"])).toEqual({
            sent: [],
            failed: ["file", "link"],
        });
    });

    it("fails, rather than pretend, in a chat that cannot say whether a file or words went", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        expect(await sendParts({}, { makeFile: () => Promise.resolve(file), link }, ["file", "link"])).toEqual({
            sent: [],
            failed: ["file", "link"],
        });
    });

    it("fails when the file cannot be made", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const room = { sendFileOrThrow: vi.fn() };
        const result = await sendParts(room, { makeFile: () => Promise.reject(new Error("gone")) }, ["file"]);
        expect(result.failed).toEqual(["file"]);
        expect(room.sendFileOrThrow).not.toHaveBeenCalled();
    });
});

describe("a file made from a chat file's address", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("keeps its name and a passive type, and sends a document type as a plain file", async () => {
        const answer = (type: string) => ({ ok: true, blob: () => Promise.resolve(new Blob(["x"], { type })) });
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValueOnce(answer("image/png")).mockResolvedValueOnce(answer("text/html"))
        );
        const picture = await fileFromAddress("blob:one", "a.png");
        expect(picture.name).toBe("a.png");
        expect(picture.type).toBe("image/png");
        const page = await fileFromAddress("blob:two", "page.html");
        expect(page.type).toBe("application/octet-stream");
    });

    it("fails when the file cannot be read", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
        await expect(fileFromAddress("blob:gone", "a.md")).rejects.toThrow("HTTP 404");
    });
});
