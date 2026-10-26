import { describe, expect, it } from "vitest";
import { get, writable } from "svelte/store";
import type { ChatMessage, ChatMessageContent, ChatRoom } from "../../../../Connection/ChatConnection";
import { sharedItemsStore } from "../SharedItemsStore";

/** A message whose content counts who listens, as a Matrix message counts it as shown while anyone does. */
function countedMessage(id: string, body: string) {
    let listeners = 0;
    const content = writable<ChatMessageContent>(
        { body, url: undefined, urls: undefined, filename: undefined, fileNames: undefined },
        () => {
            listeners++;
            return () => listeners--;
        }
    );
    const message = {
        id,
        type: "text",
        content,
        isDeleted: writable(false),
        sharedFile: undefined,
    } as unknown as ChatMessage & { type: string };
    return { message, content, listeners: () => listeners };
}

describe("what a chat shared, kept up to date", () => {
    it("lets go of a message that turns out to be an image once decrypted, before it would download", () => {
        const late = countedMessage("$late", "");
        const room = { messages: writable([late.message]) } as unknown as ChatRoom;
        const unsubscribe = sharedItemsStore(room).subscribe(() => undefined);
        expect(late.listeners()).toBe(1);

        late.message.type = "image";
        late.content.set({
            body: "door.png",
            url: undefined,
            urls: undefined,
            filename: "door.png",
            fileNames: undefined,
        });

        expect(late.listeners()).toBe(0);
        unsubscribe();
    });

    it("follows a text's edits", () => {
        const text = countedMessage("$text", "nothing yet");
        const room = { messages: writable([text.message]) } as unknown as ChatRoom;
        const shared = sharedItemsStore(room);
        const unsubscribe = shared.subscribe(() => undefined);

        text.content.update((content) => ({ ...content, body: "see https://bawes.net" }));

        expect(get(shared).links.map((link) => link.url)).toEqual(["https://bawes.net"]);
        unsubscribe();
        expect(text.listeners()).toBe(0);
    });
});
