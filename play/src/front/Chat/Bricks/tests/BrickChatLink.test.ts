// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const { bricks, openBrickChat, loadMyBricks } = vi.hoisted(() => {
    let value: { id: string }[] | undefined = [];
    const subscribers = new Set<(value: { id: string }[] | undefined) => void>();
    return {
        bricks: {
            subscribe(run: (value: { id: string }[] | undefined) => void) {
                run(value);
                subscribers.add(run);
                return () => subscribers.delete(run);
            },
            set(next: { id: string }[] | undefined) {
                value = next;
                subscribers.forEach((run) => run(value));
            },
        },
        openBrickChat: vi.fn(() => Promise.resolve(undefined)),
        loadMyBricks: vi.fn(() => Promise.resolve()),
    };
});
vi.mock("../BrickChat", () => ({ openBrickChat }));
vi.mock("../MyBricksStore", () => ({ myBricksStore: bricks, loadMyBricks }));

import { BRICK_CHAT_LINK, brickChatLinkId, brickChatLinks, linksBrickChat, openBrickChatLink } from "../BrickChatLink";

const flush = () =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });

function listWithLink(href: string): { list: HTMLElement; link: HTMLAnchorElement } {
    const list = document.createElement("ul");
    list.innerHTML = `<li><p>Done. <a href="${href}" target="_blank"><b>Open its chat</b></a>, or find it in Chats.</p></li>`;
    document.body.appendChild(list);
    return { list, link: list.querySelector("a")! };
}
function tap(target: Element, type = "click"): MouseEvent {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
}

beforeEach(() => {
    vi.clearAllMocks();
    bricks.set([{ id: "11" }]);
    document.body.innerHTML = "";
});

describe("a link to a Brick's chat inside an answer", () => {
    it("is read from its address, and from nothing else", () => {
        expect(brickChatLinkId(`${BRICK_CHAT_LINK}11`)).toBe("11");
        expect(brickChatLinkId("#brick-chat=7b0f3c1e-52a4-4d0b-9a3e-6f1d2c3b4a5e")).toBe(
            "7b0f3c1e-52a4-4d0b-9a3e-6f1d2c3b4a5e"
        );
        expect(brickChatLinkId("#brick-chat=")).toBeUndefined();
        expect(brickChatLinkId("#brick-chat=11/../x")).toBeUndefined();
        expect(brickChatLinkId("https://example.com/#brick-chat=11")).toBeUndefined();
        expect(brickChatLinkId(null)).toBeUndefined();
    });

    it("is found in the words of an answer, per Brick", () => {
        const body = "Done. Recipe Brick is ready. [Open its chat](#brick-chat=11), or find it in Chats any time.";
        expect(linksBrickChat(body, "11")).toBe(true);
        expect(linksBrickChat(body, "1")).toBe(false);
        expect(linksBrickChat("Open its chat, or find it in Chats.", "11")).toBe(false);
        expect(linksBrickChat(undefined, "11")).toBe(false);
    });

    it("opens the chat of the person's own Brick on a tap, and is never followed", async () => {
        const { list, link } = listWithLink("#brick-chat=11");
        const action = brickChatLinks(list);
        const event = tap(link.querySelector("b")!);
        await flush();
        expect(event.defaultPrevented).toBe(true);
        expect(openBrickChat).toHaveBeenCalledWith("11");
        expect(loadMyBricks).not.toHaveBeenCalled();

        // A middle click would open the game again in a new tab: it opens the chat too
        expect(tap(link, "auxclick").defaultPrevented).toBe(true);

        action.destroy();
        expect(tap(link).defaultPrevented).toBe(false);
    });

    it("reads the list once more for a Brick made a moment ago", async () => {
        bricks.set([]);
        loadMyBricks.mockImplementationOnce(() => {
            bricks.set([{ id: "11" }]);
            return Promise.resolve();
        });
        await openBrickChatLink("11");
        expect(loadMyBricks).toHaveBeenCalledTimes(1);
        expect(openBrickChat).toHaveBeenCalledWith("11");
    });

    it("does nothing for a Brick that is not theirs, or a broken link, and still is not followed", async () => {
        const { list, link } = listWithLink("#brick-chat=99");
        brickChatLinks(list);
        expect(tap(link).defaultPrevented).toBe(true);
        await flush();
        expect(loadMyBricks).toHaveBeenCalledTimes(1);
        expect(openBrickChat).not.toHaveBeenCalled();

        const broken = listWithLink("#brick-chat=a b");
        brickChatLinks(broken.list);
        expect(tap(broken.link).defaultPrevented).toBe(true);
        await flush();
        expect(openBrickChat).not.toHaveBeenCalled();
    });

    it("leaves every other link alone", () => {
        const { list, link } = listWithLink("https://example.com/");
        brickChatLinks(list);
        expect(tap(link).defaultPrevented).toBe(false);
        expect(openBrickChat).not.toHaveBeenCalled();
    });
});
