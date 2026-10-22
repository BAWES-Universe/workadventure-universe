import { describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import type { MatrixEvent, Room } from "matrix-js-sdk";

vi.mock("../MatrixMedia", () => ({
    holdMatrixMedia: vi.fn(() => ({ url: Promise.resolve("blob:https://play.test/image"), release: vi.fn() })),
}));
vi.mock("../MatrixChatUser", () => ({
    chatUserFactory: () => undefined,
}));

import { MatrixChatMessage } from "../MatrixChatMessage";
import { getMediaCaption } from "../../../Components/Room/MessageActions/messageActions";

function fakeEvent(content: Record<string, unknown>, id = "$event", replyEventId?: string): MatrixEvent {
    return {
        getId: () => id,
        getDate: () => new Date(0),
        getSender: () => "@alice:matrix.test",
        getOriginalContent: () => content,
        getUnsigned: () => ({}),
        isDecryptionFailure: () => false,
        isRedacted: () => false,
        replacingEventId: () => undefined,
        replyEventId,
        on: () => {},
        off: () => {},
    } as unknown as MatrixEvent;
}

function fakeRoom(events: Record<string, MatrixEvent> = {}): Room {
    return {
        client: {
            getUserId: () => "@me:matrix.test",
            getSafeUserId: () => "@me:matrix.test",
            getUser: () => null,
        },
        getMember: () => null,
        getLiveTimeline: () => ({ getState: () => undefined }),
        getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
        findEventById: (id: string) => events[id],
    } as unknown as Room;
}

function contentOf(content: Record<string, unknown>, room = fakeRoom(), replyEventId?: string) {
    const message = new MatrixChatMessage(fakeEvent(content, "$event", replyEventId), room);
    return { message, shown: get(message.content) };
}

describe("the caption of a Matrix picture or video", () => {
    it.each([
        ["m.image", "image", "image.png"],
        ["m.image", "image", "Screenshot 2026-10-21 111313.png"],
        ["m.video", "video", "clip.mp4"],
    ])("is empty for a %s that only carries its file name as body (%s, %s)", (msgtype, type, body) => {
        // What our own chat sends, and what older messages in the history look like: no `filename` field.
        const { message, shown } = contentOf({ msgtype, body, formatted_body: body, url: "mxc://matrix.test/a" });

        expect(message.type).toBe(type);
        expect(shown.filename).toBe(body);
        expect(shown.body).toBe(body);
        expect(getMediaCaption(shown)).toBeUndefined();
    });

    it("keeps a real caption sent by another app, with the file name beside it", () => {
        const { shown } = contentOf({
            msgtype: "m.image",
            body: "New desk layout, thoughts?",
            filename: "desk.png",
            url: "mxc://matrix.test/a",
        });

        expect(shown.filename).toBe("desk.png");
        expect(getMediaCaption(shown)).toBe("New desk layout, thoughts?");
    });

    it("is empty when an app sends the name in both fields", () => {
        const { shown } = contentOf({
            msgtype: "m.image",
            body: "desk.png",
            filename: "desk.png",
            url: "mxc://matrix.test/a",
        });

        expect(getMediaCaption(shown)).toBeUndefined();
    });

    it("is empty for a picture sent as a reply, which takes its text from the formatted body", () => {
        const quoted = fakeEvent({ msgtype: "m.text", body: "Look at this" }, "$quoted");
        const { message, shown } = contentOf(
            {
                msgtype: "m.image",
                body: "image.png",
                formatted_body: "image.png",
                url: "mxc://matrix.test/a",
                "m.relates_to": { "m.in_reply_to": { event_id: "$quoted" } },
            },
            fakeRoom({ $quoted: quoted }),
            "$quoted"
        );

        expect(message.type).toBe("image");
        expect(shown.filename).toBe("image.png");
        expect(getMediaCaption(shown)).toBeUndefined();
    });

    it("is empty for a picture sent as a reply by an app that writes the quoted lines and HTML around its name", () => {
        const quoted = fakeEvent({ msgtype: "m.text", body: "Look at this" }, "$quoted");
        const { shown } = contentOf(
            {
                msgtype: "m.image",
                body: "> <@ada:matrix.test> Look at this\n\nimage.png",
                formatted_body: "<mx-reply><blockquote>Look at this</blockquote></mx-reply><p>image.png</p>",
                filename: "image.png",
                url: "mxc://matrix.test/a",
                "m.relates_to": { "m.in_reply_to": { event_id: "$quoted" } },
            },
            fakeRoom({ $quoted: quoted }),
            "$quoted"
        );

        expect(shown.body).toBe("image.png");
        expect(getMediaCaption(shown)).toBeUndefined();
    });

    it("keeps a caption written under a picture sent as a reply, without the quoted lines", () => {
        const quoted = fakeEvent({ msgtype: "m.text", body: "Look at this" }, "$quoted");
        const { shown } = contentOf(
            {
                msgtype: "m.image",
                body: "> <@ada:matrix.test> Look at this\n\nThe new desk",
                formatted_body: "<mx-reply><blockquote>Look at this</blockquote></mx-reply><p>The new desk</p>",
                filename: "image.png",
                url: "mxc://matrix.test/a",
                "m.relates_to": { "m.in_reply_to": { event_id: "$quoted" } },
            },
            fakeRoom({ $quoted: quoted }),
            "$quoted"
        );

        expect(getMediaCaption(shown)).toBe("The new desk");
    });

    it("keeps the name of a document, whether or not it is sent as a reply", () => {
        const plain = contentOf({ msgtype: "m.file", body: "Q4 roster.pdf", url: "mxc://matrix.test/a" });
        expect(plain.message.type).toBe("file");
        expect(plain.shown.filename).toBe("Q4 roster.pdf");

        const quoted = fakeEvent({ msgtype: "m.text", body: "Here it is" }, "$quoted");
        const reply = contentOf(
            { msgtype: "m.file", body: "Q4 roster.pdf", formatted_body: "Q4 roster.pdf", url: "mxc://matrix.test/a" },
            fakeRoom({ $quoted: quoted }),
            "$quoted"
        );
        expect(reply.shown.filename).toBe("Q4 roster.pdf");
    });

    it("keeps the name of a picture that cannot be shown inline, as a file card", () => {
        const { message, shown } = contentOf({
            msgtype: "m.image",
            body: "page.html",
            info: { mimetype: "text/html" },
            url: "mxc://matrix.test/a",
        });

        expect(message.type).toBe("file");
        expect(shown.filename).toBe("page.html");
    });

    it("leaves the stored event and a text message as they are", () => {
        const stored = { msgtype: "m.image", body: "image.png", url: "mxc://matrix.test/a" };
        contentOf(stored);
        expect(stored).toEqual({ msgtype: "m.image", body: "image.png", url: "mxc://matrix.test/a" });

        const text = contentOf({ msgtype: "m.text", body: "image.png" });
        expect(text.message.type).toBe("text");
        expect(text.shown.filename).toBeUndefined();
        expect(text.shown.body).toBe("image.png");
    });
});
