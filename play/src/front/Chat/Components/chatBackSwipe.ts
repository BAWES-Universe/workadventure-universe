import { get } from "svelte/store";
import { tick } from "svelte";
import type { ActionReturn } from "svelte/action";
import { chatBackPeekStore, chatDepthStore, closeChatLevel, type ChatBackPeek } from "../ChatBack";

export interface ChatBackSwipeOptions {
    /** All chats are already beside the conversation (a wide panel): the conversation itself doesn't swipe away. */
    listBeside: boolean;
}

/** How far in from the chat's edge a swipe back may start. A swipe right further in replies to a message. */
export const EDGE_PX = 24;
/** How far the finger moves before the swipe decides between going back and scrolling. */
const LOCK_PX = 8;
/** Let go past this share of the width, or flick, and the level goes; otherwise it slides back. */
const COMMIT_SHARE = 0.33;
const FLICK_PX_PER_MS = 0.45;
const SETTLE_MS = 220;

/**
 * The chat's own swipe back (#1553): from the chat's left edge (right edge right-to-left), only the top level slides
 * away, over what it covers, and the game stays still. On an iPhone this is the way back: the page keeps nothing in
 * its history to go back to, so Safari leaves the edge to it.
 *
 * Levels are marked in the page: `data-chat-layer="thread"` (the conversation), `"panel"` (details or profile, over the
 * conversation) and `"shared"` (Media, links and files, over either).
 */
export function chatBackSwipe(
    node: HTMLElement,
    initialOptions: ChatBackSwipeOptions
): ActionReturn<ChatBackSwipeOptions> {
    let options = initialOptions;
    let state: "idle" | "pending" | "swiping" | "settling" = "idle";
    let touchId: number | undefined;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastT = 0;
    let velocity = 0;
    let offset = 0;
    let direction = 1;
    let layer: HTMLElement | undefined;

    function topLayer(): { layer: HTMLElement; peek: ChatBackPeek } | undefined {
        const shared = node.querySelector<HTMLElement>('[data-chat-layer="shared"]');
        if (shared) {
            const underPanel = node.querySelector('[data-chat-layer="panel"]') !== null;
            return { layer: shared, peek: underPanel ? "panel" : "conversation" };
        }
        const panel = node.querySelector<HTMLElement>('[data-chat-layer="panel"]');
        if (panel) return { layer: panel, peek: "conversation" };
        const thread = node.querySelector<HTMLElement>('[data-chat-layer="thread"]');
        if (thread && !options.listBeside) return { layer: thread, peek: "list" };
        return undefined;
    }

    function startsAtEdge(clientX: number): boolean {
        if (get(chatDepthStore) === 0) return false;
        const rect = node.getBoundingClientRect();
        const rtl = getComputedStyle(node).direction === "rtl";
        return rtl ? rect.right - clientX <= EDGE_PX : clientX - rect.left <= EDGE_PX;
    }

    // The edge belongs to going back: a message there doesn't start a reply or open its menu. Taps still click.
    function onPointerDown(event: PointerEvent) {
        if (event.pointerType !== "touch" || state !== "idle") return;
        if (startsAtEdge(event.clientX) && topLayer() !== undefined) event.stopPropagation();
    }

    function onTouchStart(event: TouchEvent) {
        if (state !== "idle" || event.touches.length !== 1) return;
        const touch = event.touches[0];
        if (!startsAtEdge(touch.clientX) || topLayer() === undefined) return;
        state = "pending";
        touchId = touch.identifier;
        startX = lastX = touch.clientX;
        startY = touch.clientY;
        lastT = event.timeStamp;
        velocity = 0;
        offset = 0;
        direction = getComputedStyle(node).direction === "rtl" ? -1 : 1;
    }

    function trackedTouch(event: TouchEvent): Touch | undefined {
        return Array.from(event.changedTouches).find((touch) => touch.identifier === touchId);
    }

    function onTouchMove(event: TouchEvent) {
        if (state !== "pending" && state !== "swiping") return;
        const touch = trackedTouch(event);
        if (!touch) return;
        const dx = (touch.clientX - startX) * direction;
        const dy = touch.clientY - startY;
        if (state === "pending") {
            if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return;
            // Mostly sideways, towards the back: it's a swipe back. Anything else scrolls as usual.
            if (dx <= Math.abs(dy) * 1.2) {
                state = "idle";
                return;
            }
            begin();
        }
        event.preventDefault();
        const dt = Math.max(1, event.timeStamp - lastT);
        velocity = ((touch.clientX - lastX) * direction) / dt;
        lastX = touch.clientX;
        lastT = event.timeStamp;
        offset = Math.max(0, dx);
        place();
    }

    function onTouchEnd(event: TouchEvent) {
        if (!trackedTouch(event)) return;
        if (state === "pending") state = "idle";
        if (state !== "swiping") return;
        const commit =
            event.type === "touchend" && (offset > node.clientWidth * COMMIT_SHARE || velocity > FLICK_PX_PER_MS);
        settle(commit);
    }

    function begin() {
        const top = topLayer();
        if (!top) {
            state = "idle";
            return;
        }
        state = "swiping";
        layer = top.layer;
        layer.classList.add("chat-back-moving");
        layer.style.transition = "none";
        chatBackPeekStore.set(top.peek);
    }

    function place() {
        if (layer) layer.style.transform = `translateX(${offset * direction}px)`;
    }

    function settle(commit: boolean) {
        state = "settling";
        const moving = layer;
        if (!moving) {
            finish();
            return;
        }
        const target = commit ? node.clientWidth : 0;
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        moving.style.transition = reduce ? "none" : `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
        moving.style.transform = `translateX(${target * direction}px)`;
        let done = false;
        // transitionend bubbles: only the layer's own slide ends the settle, not a hover or focus change inside it.
        const end = (event?: Event) => {
            if (event && (event.target !== moving || (event as TransitionEvent).propertyName !== "transform")) return;
            if (done) return;
            done = true;
            moving.removeEventListener("transitionend", end);
            if (commit) closeChatLevel();
            // The level is gone (or back in place) before what was under it is put back as it was.
            tick()
                .then(finish)
                .catch((error) => console.error(error));
        };
        if (reduce) {
            end();
            return;
        }
        moving.addEventListener("transitionend", end);
        setTimeout(() => end(), SETTLE_MS + 80);
    }

    function finish() {
        if (layer) {
            layer.classList.remove("chat-back-moving");
            layer.style.transition = "";
            layer.style.transform = "";
        }
        layer = undefined;
        touchId = undefined;
        offset = 0;
        chatBackPeekStore.set(undefined);
        state = "idle";
    }

    node.addEventListener("pointerdown", onPointerDown, { capture: true });
    node.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    node.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    node.addEventListener("touchend", onTouchEnd, { capture: true });
    node.addEventListener("touchcancel", onTouchEnd, { capture: true });

    return {
        update(next) {
            options = next;
        },
        destroy() {
            node.removeEventListener("pointerdown", onPointerDown, { capture: true });
            node.removeEventListener("touchstart", onTouchStart, { capture: true });
            node.removeEventListener("touchmove", onTouchMove, { capture: true });
            node.removeEventListener("touchend", onTouchEnd, { capture: true });
            node.removeEventListener("touchcancel", onTouchEnd, { capture: true });
            if (state === "swiping" || state === "settling") chatBackPeekStore.set(undefined);
        },
    };
}
