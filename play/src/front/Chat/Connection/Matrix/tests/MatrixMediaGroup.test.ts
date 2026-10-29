import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import type { MatrixEvent, Room } from "matrix-js-sdk";

vi.mock("../MatrixMedia", () => ({
    holdMatrixMedia: vi.fn((_client: unknown, mxc: string | undefined) => ({
        url: mxc === "mxc://matrix.test/broken" ? Promise.resolve(undefined) : Promise.resolve(`blob:${mxc}`),
        release: vi.fn(),
    })),
}));
vi.mock("../MatrixChatUser", () => ({
    chatUserFactory: () => undefined,
}));

import { MatrixChatMessage } from "../MatrixChatMessage";
import { MEDIA_GROUP_FIELD, readMediaGroup } from "../MatrixMediaGroup";
import { MEDIA_GROUP_WAIT_MS, MediaGroupAssembler } from "../MatrixMediaGroupAssembler";

function fakeEvent(content: Record<string, unknown>, id: string, sender = "@alice:matrix.test"): MatrixEvent {
    return {
        getId: () => id,
        getDate: () => new Date(0),
        getSender: () => sender,
        getOriginalContent: () => content,
        getUnsigned: () => ({}),
        isDecryptionFailure: () => false,
        isRedacted: () => false,
        replacingEventId: () => undefined,
        on: () => {},
        off: () => {},
    } as unknown as MatrixEvent;
}

const room = {
    client: {
        getUserId: () => "@me:matrix.test",
        getSafeUserId: () => "@me:matrix.test",
        getUser: () => null,
    },
    getMember: () => null,
    getLiveTimeline: () => ({ getState: () => undefined }),
    getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
    findEventById: () => undefined,
} as unknown as Room;

/** One file of a group, as the sender's app writes it: the first carries the words (a body that is not its name). */
function groupFile(
    index: number,
    count: number,
    options: { id?: string; msgtype?: string; name?: string; words?: string; mxc?: string; sender?: string } = {}
) {
    const name = options.name ?? `beach-${index + 1}.jpg`;
    const content: Record<string, unknown> = {
        msgtype: options.msgtype ?? "m.image",
        body: index === 0 && options.words ? options.words : name,
        filename: name,
        info: { mimetype: options.msgtype === "m.video" ? "video/mp4" : "image/jpeg" },
        url: options.mxc ?? `mxc://matrix.test/${name}`,
        [MEDIA_GROUP_FIELD]: { id: options.id ?? "g1", index, count },
    };
    return new MatrixChatMessage(fakeEvent(content, `$${options.id ?? "g1"}-${index}`, options.sender), room);
}

async function settled<T>(read: () => T): Promise<T> {
    await Promise.resolve();
    await Promise.resolve();
    return read();
}

describe("the tag that joins files sent together", () => {
    it("reads a usable tag", () => {
        expect(readMediaGroup({ [MEDIA_GROUP_FIELD]: { id: "a", index: 1, count: 3 } })).toEqual({
            id: "a",
            index: 1,
            count: 3,
        });
    });

    it.each([
        ["no tag", {}],
        ["a missing id", { [MEDIA_GROUP_FIELD]: { index: 0, count: 2 } }],
        ["an empty id", { [MEDIA_GROUP_FIELD]: { id: "", index: 0, count: 2 } }],
        ["a single file", { [MEDIA_GROUP_FIELD]: { id: "a", index: 0, count: 1 } }],
        ["a place past the end", { [MEDIA_GROUP_FIELD]: { id: "a", index: 2, count: 2 } }],
        ["a negative place", { [MEDIA_GROUP_FIELD]: { id: "a", index: -1, count: 2 } }],
        ["numbers as text", { [MEDIA_GROUP_FIELD]: { id: "a", index: "0", count: "2" } }],
        ["a fraction", { [MEDIA_GROUP_FIELD]: { id: "a", index: 0.5, count: 2 } }],
        ["not an object", { [MEDIA_GROUP_FIELD]: "a" }],
    ])("ignores %s", (_name, content) => {
        expect(readMediaGroup(content)).toBeUndefined();
    });
});

describe("a gallery joined from the messages of files sent together", () => {
    it("shows every file in the order sent, with the words of the first under them", async () => {
        const members = [
            groupFile(0, 3, { words: "Look what I found" }),
            groupFile(1, 3),
            groupFile(2, 3, { msgtype: "m.video", name: "clip.mp4" }),
        ];
        members[0].joinGroup(members);

        expect(members[0].type).toBe("gallery");
        const shown = await settled(() => {
            let value = get(members[0].content);
            const stop = members[0].content.subscribe((v) => (value = v));
            return { read: () => value, stop };
        });
        await settled(() => undefined);
        const content = shown.read();
        shown.stop();
        expect(content.body).toBe("Look what I found");
        expect(content.url).toBe("blob:mxc://matrix.test/beach-1.jpg");
        expect(content.urls).toEqual(["blob:mxc://matrix.test/beach-2.jpg", "blob:mxc://matrix.test/clip.mp4"]);
        expect(content.fileNames).toEqual(["beach-1.jpg", "beach-2.jpg", "clip.mp4"]);
        // A kept file's address has no ending, so the gallery is told what each one is.
        expect(content.itemTypes).toEqual(["image", "image", "video"]);
    });

    it("has no words under it when the first file only carries its name", async () => {
        const members = [groupFile(0, 2), groupFile(1, 2)];
        members[0].joinGroup(members);
        let content = get(members[0].content);
        const stop = members[0].content.subscribe((v) => (content = v));
        await settled(() => undefined);
        stop();
        expect(content.body).toBe("");
    });

    it("waits for every file's address, and leaves out a file that could not be fetched", async () => {
        const members = [groupFile(0, 3), groupFile(1, 3, { mxc: "mxc://matrix.test/broken" }), groupFile(2, 3)];
        members[0].joinGroup(members);
        const seen: Array<{ url?: string; urls?: string[] }> = [];
        const stop = members[0].content.subscribe((v) => seen.push({ url: v.url, urls: v.urls }));
        await settled(() => undefined);
        await settled(() => undefined);
        stop();
        // Nothing half drawn first.
        expect(seen[0].url).toBeUndefined();
        const last = seen[seen.length - 1];
        expect(last.url).toBe("blob:mxc://matrix.test/beach-1.jpg");
        expect(last.urls).toEqual(["blob:mxc://matrix.test/beach-3.jpg"]);
    });

    it("stays a plain message when it is the only one of its group", () => {
        const only = groupFile(0, 2);
        only.joinGroup([only]);
        expect(only.type).toBe("image");
    });
});

describe("joining the messages of a group", () => {
    let assembler: MediaGroupAssembler;
    const shownLater = vi.fn();
    beforeEach(() => {
        vi.useFakeTimers();
        shownLater.mockClear();
        assembler = new MediaGroupAssembler(shownLater);
    });
    afterEach(() => {
        assembler.dispose();
        vi.useRealTimers();
    });

    const plain = (id: string) => new MatrixChatMessage(fakeEvent({ msgtype: "m.text", body: id }, `$${id}`), room);

    it("joins a group read from the history into its first message, in place", () => {
        const before = plain("before");
        const files = [groupFile(0, 3), groupFile(1, 3), groupFile(2, 3)];
        const after = plain("after");

        const list = assembler.joinHistory([before, ...files, after]);

        expect(list).toEqual([before, files[0], after]);
        expect(files[0].type).toBe("gallery");
        expect(files[1].type).toBe("image");
    });

    it("keeps two groups apart and orders each by its place", () => {
        const a = [groupFile(1, 2, { id: "a" }), groupFile(0, 2, { id: "a" })];
        const b = [groupFile(0, 2, { id: "b" }), groupFile(1, 2, { id: "b" })];

        const list = assembler.joinHistory([a[0], b[0], a[1], b[1]]);

        expect(list).toHaveLength(2);
        expect(list[0]).toBe(a[1]);
        expect(list[1]).toBe(b[0]);
    });

    it("only joins files from the same sender", () => {
        const mine = groupFile(0, 2, { sender: "@alice:matrix.test" });
        const intruder = groupFile(1, 2, { sender: "@mallory:matrix.test" });

        const list = assembler.joinHistory([mine, intruder]);

        expect(list).toEqual([mine, intruder]);
        expect(mine.type).toBe("image");
    });

    it("holds the files of a live group until the last one arrives, then returns the gallery", () => {
        const files = [groupFile(0, 3), groupFile(1, 3), groupFile(2, 3)];

        expect(assembler.addLive(files[0])).toBeUndefined();
        expect(assembler.addLive(files[1])).toBeUndefined();
        expect(assembler.addLive(files[2])).toBe(files[0]);
        expect(files[0].type).toBe("gallery");
        // Nothing is left to announce later.
        vi.advanceTimersByTime(MEDIA_GROUP_WAIT_MS * 2);
        expect(shownLater).not.toHaveBeenCalled();
    });

    it("shows a gallery with what arrived when a file is late, and shows the late one on its own", () => {
        const files = [groupFile(0, 3), groupFile(1, 3), groupFile(2, 3)];
        assembler.addLive(files[0], true);
        assembler.addLive(files[1], true);

        vi.advanceTimersByTime(MEDIA_GROUP_WAIT_MS);

        expect(shownLater).toHaveBeenCalledWith(files[0], true);
        expect(files[0].type).toBe("gallery");
        expect(assembler.addLive(files[2])).toBe(files[2]);
        expect(files[2].type).toBe("image");
    });

    it("lets a message without a tag straight through", () => {
        const text = plain("hello");
        expect(assembler.addLive(text)).toBe(text);
    });
});
