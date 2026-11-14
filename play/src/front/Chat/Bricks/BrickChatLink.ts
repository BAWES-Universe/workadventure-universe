import { get } from "svelte/store";
import { APPS_LINK, openAppsPage } from "./Apps/OpenApps";
import { keyFormLinkId, KEY_FORM_LINK, openKeyFormSheet } from "./Apps/KeyFormLink";
import { openBrickChat } from "./BrickChat";
import { loadMyBricks, myBricksStore } from "./MyBricksStore";

/**
 * A link to one of the person's own Bricks, inside a Brick's answer (game #1996): "Done. Recipe Brick is ready.
 * [Open its chat](#brick-chat=<id>), or find it in Chats any time." The Brick that made it writes the link; a tap
 * opens that chat here instead of following it.
 */
export const BRICK_CHAT_LINK = "#brick-chat=";

/** The Brick a link points at, when it is such a link. */
export function brickChatLinkId(href: string | null | undefined): string | undefined {
    if (!href?.startsWith(BRICK_CHAT_LINK)) return undefined;
    const id = href.slice(BRICK_CHAT_LINK.length).trim();
    return id && /^[\w-]{1,64}$/.test(id) ? id : undefined;
}

/** Whether these words already carry the link to this Brick's chat. */
export function linksBrickChat(body: string | undefined, brickId: string): boolean {
    return (body ?? "").includes(`(${BRICK_CHAT_LINK}${brickId})`);
}

const isMine = (brickId: string) => (get(myBricksStore) ?? []).some((brick) => brick.id === brickId);

/**
 * Opens the chat of the Brick a tapped link points at. Only a Brick of the person's own opens: a link to anything
 * else, whoever wrote it, does nothing. A Brick made a moment ago may not be in the list yet, so the list is read
 * once more before giving up.
 */
export async function openBrickChatLink(brickId: string): Promise<void> {
    if (!isMine(brickId)) await loadMyBricks();
    if (isMine(brickId)) await openBrickChat(brickId);
}

/** On the list of messages: taps on a Brick chat link open that chat, and never leave the game. */
export function brickChatLinks(node: HTMLElement): { destroy: () => void } {
    const tap = (event: MouseEvent) => {
        const anchor = event.target instanceof Element ? event.target.closest("a") : null;
        const href = anchor?.getAttribute("href");
        if (href === APPS_LINK) {
            // "[Apps](#apps)" in a Brick's words (#2001): the Apps page opens here
            event.preventDefault();
            openAppsPage();
            return;
        }
        if (href?.startsWith(KEY_FORM_LINK)) {
            // "[Add your Tap key](#key-form=<id>)": the safe form opens here. A broken one is never followed either.
            event.preventDefault();
            const formId = keyFormLinkId(href);
            if (formId) openKeyFormSheet(formId);
            return;
        }
        if (!href?.startsWith(BRICK_CHAT_LINK)) return;
        const brickId = brickChatLinkId(href);
        // Such a link is never followed, even a broken one: it would open the game again in a new tab
        event.preventDefault();
        if (brickId) openBrickChatLink(brickId).catch((error) => console.error(error));
    };
    // A middle click would open the link in a new tab too; other buttons (a right click's menu) are left alone
    const middleTap = (event: MouseEvent) => {
        if (event.button === 1) tap(event);
    };
    node.addEventListener("click", tap);
    node.addEventListener("auxclick", middleTap);
    return {
        destroy() {
            node.removeEventListener("click", tap);
            node.removeEventListener("auxclick", middleTap);
        },
    };
}
