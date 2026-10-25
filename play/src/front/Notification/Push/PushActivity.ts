import { derived, get, type Readable } from "svelte/store";
import { botApiService } from "../../external-modules/bots/services/BotApiService";
import { navChat } from "../../Chat/Stores/ChatStore";
import { selectedRoomStore } from "../../Chat/Stores/SelectRoomStore";
import { chatVisibilityStore } from "../../Stores/ChatStore";
import type { PushActivityReport } from "./PushChat";

/**
 * The open-and-seen rule's half in the game (#863): each tab tells Orbit while Universe is in front there and which
 * chat is open, so a direct message someone is looking at, or will see in Universe, sends no notification. Orbit
 * counts a report as fresh for 45 seconds.
 */

/** While in front, a report this often keeps it fresh in Orbit. */
export const REPORT_EVERY_MS = 30_000;
/** No key, tap or pointer for this long: they have walked away, so it no longer counts as in front. */
export const IDLE_AFTER_MS = 5 * 60_000;

export interface FrontSignals {
    visible: boolean;
    focused: boolean;
    lastInputAt: number;
    /** The chat open and shown in this tab, if any */
    openChatRoomId: string | null;
}

/** What this tab reports now. */
export function readReport(tabId: string, signals: FrontSignals, now: number): PushActivityReport {
    const front = signals.visible && signals.focused && now - signals.lastInputAt < IDLE_AFTER_MS;
    return { tabId, front, chatRoomId: front ? signals.openChatRoomId : null };
}

/** Whether a new report must go now: it says something different, or Orbit's copy of being in front is ageing. */
export function mustSend(
    previous: PushActivityReport | null,
    next: PushActivityReport,
    lastSentAt: number,
    now: number
): boolean {
    if (!previous) return next.front;
    if (previous.front !== next.front || previous.chatRoomId !== next.chatRoomId) return true;
    return next.front && now - lastSentAt >= REPORT_EVERY_MS;
}

function newTabId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The chat shown in this tab: the chat panel is open, on a chat, and that chat is selected. */
const openChatRoomIdStore: Readable<string | null> = derived(
    [selectedRoomStore, navChat, chatVisibilityStore],
    ([room, nav, visible]) => (visible && nav.key === "chat" && room ? room.id : null)
);

let stopActivity: (() => void) | undefined;

/**
 * Starts reporting from this tab, once per page, for a signed-in player whose Orbit is reachable. Returns the stop,
 * which also tells Orbit this tab is no longer in front.
 */
export function startPushActivity(): () => void {
    if (stopActivity) return stopActivity;
    if (typeof document === "undefined") return () => undefined;

    const tabId = newTabId();
    let lastInputAt = Date.now();
    let sent: PushActivityReport | null = null;
    let lastSentAt = 0;

    const signals = (): FrontSignals => ({
        visible: document.visibilityState === "visible",
        focused: document.hasFocus(),
        // Keys and taps inside a call or a website opened in Universe stay in that frame: while one has the focus,
        // they count as being here
        lastInputAt: document.activeElement instanceof HTMLIFrameElement ? Date.now() : lastInputAt,
        openChatRoomId: get(openChatRoomIdStore),
    });

    const send = (report: PushActivityReport, keepalive = false) => {
        sent = report;
        lastSentAt = Date.now();
        botApiService.reportPushActivity(report, keepalive).catch(() => undefined);
    };

    const check = () => {
        const now = Date.now();
        const report = readReport(tabId, signals(), now);
        // Going to the back may be the page closing (it is hidden before pagehide): that report must get out too
        if (mustSend(sent, report, lastSentAt, now)) send(report, !report.front);
    };

    const onInput = () => {
        const wasIdle = Date.now() - lastInputAt >= IDLE_AFTER_MS;
        lastInputAt = Date.now();
        if (wasIdle) check();
    };

    // Leaving the page: the last report must get out while it closes
    const onPageHide = () => {
        if (sent?.front) send({ tabId, front: false, chatRoomId: null }, true);
    };

    const inputEvents = ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"] as const;
    const inputOptions = { capture: true, passive: true };
    for (const type of inputEvents) window.addEventListener(type, onInput, inputOptions);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    window.addEventListener("blur", check);
    window.addEventListener("pagehide", onPageHide);
    const unsubscribeChat = openChatRoomIdStore.subscribe(() => check());
    const timer = setInterval(check, REPORT_EVERY_MS / 3);

    stopActivity = () => {
        for (const type of inputEvents) window.removeEventListener(type, onInput, inputOptions);
        document.removeEventListener("visibilitychange", check);
        window.removeEventListener("focus", check);
        window.removeEventListener("blur", check);
        window.removeEventListener("pagehide", onPageHide);
        unsubscribeChat();
        clearInterval(timer);
        onPageHide();
        stopActivity = undefined;
    };
    return stopActivity;
}
