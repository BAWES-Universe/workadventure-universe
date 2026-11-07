/**
 * Browser Web Push service worker (`play/public/notification-service-worker.js`).
 * Handles incoming `push` events dispatched by `back/` or Orbit, deduplicates chat sound
 * alerts against active tabs, and routes `notificationclick` events to the target room
 * or conversation URL on the same origin.
 */

const SOUND_CHECK_TIMEOUT_MS = 2000;
const DEFAULT_ICON_PATH = "/static/images/logo-WA-min.png";

self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(clients.claim());
});

self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
    event.waitUntil(displayIncomingPush(parsePushPayload(event.data)));
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const data = event.notification.data ?? {};
    event.waitUntil(routeNotificationTap(data));
});

function parsePushPayload(eventData) {
    try {
        const parsed = eventData?.json();
        if (parsed && typeof parsed.title === "string") {
            return parsed;
        }
    } catch {
        // Malformed or plain-text payload falls back to the generic notification below.
    }
    return { title: "Universe", body: "Open Universe to see what's new." };
}

function resolveNotificationTag(push) {
    if (typeof push.chatRoomId === "string" && push.chatRoomId) {
        return `chat:${push.chatRoomId}`;
    }
    return typeof push.tag === "string" ? push.tag : undefined;
}

function isAppleWebKitBrowser() {
    const ua = self.navigator?.userAgent ?? "";
    return /AppleWebKit\//.test(ua) && !/Chrome\/|Chromium\/|Android/.test(ua);
}

async function closeReplacedNotifications(tag) {
    if (!tag || !isAppleWebKitBrowser()) {
        return;
    }
    const active = await self.registration.getNotifications({ tag });
    active.forEach((item) => item.close());
}

async function displayIncomingPush(push) {
    const chatRoomId = typeof push.chatRoomId === "string" ? push.chatRoomId : undefined;
    const tag = resolveNotificationTag(push);
    await closeReplacedNotifications(tag);

    const silent = chatRoomId !== undefined && (await isForegroundWindowPlayingSound(chatRoomId));
    await self.registration.showNotification(push.title, {
        body: typeof push.body === "string" ? push.body : undefined,
        icon: DEFAULT_ICON_PATH,
        badge: DEFAULT_ICON_PATH,
        tag,
        silent,
        renotify: Boolean(tag) && !silent,
        data: {
            chatRoomId,
            tabUrl: typeof push.url === "string" ? push.url : undefined,
        },
    });
}

async function isForegroundWindowPlayingSound(chatRoomId) {
    let windows;
    try {
        windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    } catch {
        return false;
    }
    if (windows.length === 0) {
        return false;
    }
    return queryWindowsForSound(windows, chatRoomId);
}

function queryWindowsForSound(windows, chatRoomId) {
    return new Promise((resolve) => {
        let pending = windows.length;
        const timer = setTimeout(() => resolve(false), SOUND_CHECK_TIMEOUT_MS);
        const onAnswer = (plays) => {
            pending -= 1;
            if (plays === true || pending === 0) {
                clearTimeout(timer);
                resolve(plays === true);
            }
        };
        for (const win of windows) {
            postSoundCheckToWindow(win, { chatRoomId, onAnswer });
        }
    });
}

function postSoundCheckToWindow(win, context) {
    try {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => context.onAnswer(event.data);
        win.postMessage({ type: "chatSoundCheck", chatRoomId: context.chatRoomId }, [channel.port2]);
    } catch {
        context.onAnswer(false);
    }
}

async function routeNotificationTap(data) {
    const targetUrl = resolveSameSiteUrl(data.tabUrl);
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => client.url === targetUrl) ?? windows[0];

    if (existing) {
        await focusAndNotifyExistingWindow(existing, { chatRoomId: data.chatRoomId, targetUrl });
        return;
    }

    const opened = await clients.openWindow(targetUrl);
    if (opened && isPersistentChatRoom(data.chatRoomId)) {
        opened.postMessage({ type: "openChat", data: { chatRoomId: data.chatRoomId } });
    }
}

function isPersistentChatRoom(chatRoomId) {
    if (typeof chatRoomId !== "string" || !chatRoomId) {
        return false;
    }
    return chatRoomId !== "proximity";
}

async function focusAndNotifyExistingWindow(existing, target) {
    const focused = (await existing.focus().catch(() => undefined)) ?? existing;
    if (target.chatRoomId) {
        const message = { type: "openChat", data: { chatRoomId: target.chatRoomId } };
        focused.postMessage(message);
        new BroadcastChannel("message").postMessage(message);
    }
    if (typeof focused.navigate === "function" && focused.url !== target.targetUrl) {
        await focused.navigate(target.targetUrl).catch(() => undefined);
    }
}

function resolveSameSiteUrl(tabUrl) {
    if (typeof tabUrl !== "string" || !tabUrl) {
        return self.registration.scope;
    }
    try {
        const parsed = new URL(tabUrl, self.location.origin);
        if (parsed.origin === self.location.origin) {
            return parsed.href;
        }
    } catch {
        // Invalid URLs fall back to the root registration scope.
    }
    return self.registration.scope;
}
