import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { writable } from "svelte/store";

vi.mock("../../../LinkPreview/openChatLinkHere", () => ({ openChatLinkHere: vi.fn() }));
vi.mock("../../../LinkPreview/ChatLinkKind", () => ({ classifyChatLink: () => ({ kind: "web" }) }));

import type { ChatMessageContent } from "../../../Connection/ChatConnection";
import MessageText from "../Message/MessageText.svelte";

function content(body: string): ChatMessageContent {
    return { body, url: undefined, urls: undefined, filename: undefined, fileNames: undefined };
}

// Older messages added above the reader must land at their full height (game #1408): the text is there the first
// time the message is drawn, not a moment later.
describe("a message's text", () => {
    let target: HTMLElement;
    let shown: { $destroy: () => void } | undefined;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(() => {
        shown?.$destroy();
        shown = undefined;
        target.remove();
    });

    const body = () => target.querySelector(".message-body");

    it("is written out as soon as the message is drawn", () => {
        shown = new MessageText({ target, props: { content: writable(content("hello **there**")), hasDepth: false } });

        expect(body()?.innerHTML).toContain("<strong>there</strong>");
    });

    it("shows a new body at once when the message changes", async () => {
        const store = writable(content("first"));
        shown = new MessageText({ target, props: { content: store, hasDepth: false } });

        store.set(content("second"));
        await tick();

        expect(body()?.textContent).toContain("second");
    });

    it("keeps the newest body when an earlier one with code finishes later", async () => {
        const store = writable(content("```\nold code\n```"));
        shown = new MessageText({ target, props: { content: store, hasDepth: false } });
        store.set(content("plain now"));

        // Let the code render finish: the highlighter loads, then it parses.
        await import("highlight.js");
        await import("marked-highlight");
        await new Promise((resolve) => {
            setTimeout(resolve, 50);
        });
        await tick();

        expect(body()?.textContent).toContain("plain now");
        expect(body()?.textContent).not.toContain("old code");
    });

    it("still colours code once its highlighter has loaded", async () => {
        shown = new MessageText({
            target,
            props: { content: writable(content("```js\nconst a = 1;\n```")), hasDepth: false },
        });

        await vi.waitFor(() => expect(body()?.querySelector("code.hljs")).not.toBeNull());
    });
});
