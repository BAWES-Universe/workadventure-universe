import { describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import type { MatrixEvent, Room } from "matrix-js-sdk";
import { MatrixEventEvent } from "matrix-js-sdk";

const release = vi.fn();
vi.mock("../MatrixMedia", () => ({
    holdMatrixMedia: vi.fn(() => ({ url: Promise.resolve("blob:https://play.test/image"), release })),
}));
vi.mock("../MatrixChatUser", () => ({
    chatUserFactory: () => undefined,
}));

import { MatrixChatMessage } from "../MatrixChatMessage";
import { holdMatrixMedia } from "../MatrixMedia";

/** An event of an encrypted room whose keys arrive after it is shown. */
function fakeEncryptedEvent() {
    let content: Record<string, unknown> = { algorithm: "m.megolm.v1.aes-sha2", ciphertext: "..." };
    const listeners: (() => void)[] = [];
    const event = {
        getId: () => "$event",
        getDate: () => new Date(0),
        getSender: () => "@alice:matrix.test",
        getOriginalContent: () => content,
        getUnsigned: () => ({}),
        isDecryptionFailure: () => false,
        isRedacted: () => false,
        replacingEventId: () => undefined,
        replyEventId: undefined,
        on: (name: string, listener: () => void) => {
            if (name === MatrixEventEvent.Decrypted) listeners.push(listener);
        },
    };
    const decrypt = (clearContent: Record<string, unknown>) => {
        content = clearContent;
        listeners.forEach((listener) => listener());
    };
    return { event: event as unknown as MatrixEvent, decrypt };
}

function fakeRoom(): Room {
    return {
        client: {
            getUserId: () => "@me:matrix.test",
            getSafeUserId: () => "@me:matrix.test",
            getUser: () => null,
        },
        getMember: () => null,
        getLiveTimeline: () => ({ getState: () => undefined }),
        getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
    } as unknown as Room;
}

describe("MatrixChatMessage decrypted after it is shown", () => {
    it.each([
        ["m.image", "photo.png", "image/png", "image"],
        ["m.audio", "recording.wav", "audio/wav", "audio"],
        ["m.video", "clip.mp4", "video/mp4", "video"],
    ])("preserves the card for %s with and without MIME metadata", (msgtype, body, mimetype, type) => {
        for (const info of [{ mimetype }, undefined]) {
            const { event, decrypt } = fakeEncryptedEvent();
            decrypt({ msgtype, body, info, url: "mxc://matrix.test/media" });
            expect(new MatrixChatMessage(event, fakeRoom()).type).toBe(type);
        }
    });

    it("shows an SVG without MIME metadata as a download instead of a broken image", () => {
        const { event, decrypt } = fakeEncryptedEvent();
        decrypt({ msgtype: "m.image", body: "logo.svg", url: "mxc://matrix.test/svg" });
        const message = new MatrixChatMessage(event, fakeRoom());
        expect(message.type).toBe("file");
        expect(get(message.content).filename).toBe("logo.svg");
    });

    it.each(["m.image", "m.audio", "m.video"])(
        "shows active documents sent as %s as named downloads",
        async (msgtype) => {
            const { event, decrypt } = fakeEncryptedEvent();
            const message = new MatrixChatMessage(event, fakeRoom());
            const unsubscribe = message.content.subscribe(() => {});
            const file = { url: "mxc://matrix.test/document", key: { k: "AQID" }, iv: "AA" };

            decrypt({
                msgtype,
                body: "A caption",
                filename: "document.svg",
                info: { mimetype: "image/svg+xml" },
                file,
            });
            await Promise.resolve();
            await Promise.resolve();

            expect(message.type).toBe("file");
            expect(get(message.content).filename).toBe("document.svg");
            expect(get(message.content).body).toBe("A caption");
            expect(get(message.content).url).toBe("blob:https://play.test/image");
            expect(holdMatrixMedia).toHaveBeenCalledWith(expect.anything(), file, "image/svg+xml");
            unsubscribe();
        }
    );

    it("becomes an image and loads it once decrypted", async () => {
        const { event, decrypt } = fakeEncryptedEvent();
        const message = new MatrixChatMessage(event, fakeRoom());
        const unsubscribe = message.content.subscribe(() => {});
        expect(message.type).toBe("text");

        decrypt({ msgtype: "m.image", body: "photo.png", url: "mxc://matrix.test/photo" });
        await Promise.resolve();
        await Promise.resolve();

        expect(message.type).toBe("image");
        expect(holdMatrixMedia).toHaveBeenCalledWith(expect.anything(), "mxc://matrix.test/photo", undefined);
        expect(get(message.content).url).toBe("blob:https://play.test/image");
        unsubscribe();
    });

    it("lets the file go once it's no longer shown, and fetches it again when shown again", async () => {
        const { event, decrypt } = fakeEncryptedEvent();
        decrypt({ msgtype: "m.image", body: "photo.png", url: "mxc://matrix.test/photo" });
        const message = new MatrixChatMessage(event, fakeRoom());
        vi.mocked(holdMatrixMedia).mockClear();
        release.mockClear();

        let shown: string | undefined;
        const unsubscribe = message.content.subscribe((content) => (shown = content.url));
        await vi.waitFor(() => expect(shown).toBe("blob:https://play.test/image"));
        unsubscribe();
        expect(release).toHaveBeenCalledTimes(1);

        // Shown again: it starts without the old URL and asks for the file again.
        const again = message.content.subscribe((content) => (shown = content.url));
        expect(shown).toBeUndefined();
        expect(holdMatrixMedia).toHaveBeenCalledTimes(2);
        again();
    });
});
