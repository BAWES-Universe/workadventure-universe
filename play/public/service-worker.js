// The one service worker of Universe, at the root so its scope is the whole site.
//
// It keeps nothing offline: the game's files are never stored, so a new release always loads. (The Cache API
// holds one entry of the page's own, the last room, and this worker leaves it alone.) What it does is
// show the notifications Orbit sends while Universe is closed, take a tapped notification to its chat, and give
// the browsers that ask for one the worker they expect before they offer to install the app.

self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(clients.claim());
});

// Nothing is answered from here: every request goes to the network as it always did.
self.addEventListener("fetch", () => {});

// A notification Orbit sends: a title, one line, and what a tap opens. The browser expects one shown for every
// push (Safari stops sending after a few that show nothing), so one that cannot be read still shows.
self.addEventListener("push", (event) => {
    event.waitUntil(showPushed(readPush(event.data)));
});

function readPush(data) {
    try {
        const push = data?.json();
        if (push && typeof push.title === "string") {
            return push;
        }
    } catch {
        // Not the shape Orbit sends: show the plain one below.
    }
    return { title: "Universe", body: "Open Universe to see what's new." };
}

async function showPushed(push) {
    const chatRoomId = typeof push.chatRoomId === "string" ? push.chatRoomId : undefined;
    // One notification per chat: a newer message takes the place of the one still showing.
    const tag = chatRoomId ? chatTag(chatRoomId) : typeof push.tag === "string" ? push.tag : undefined;
    if (tag && replacesByClosing()) {
        const showing = await self.registration.getNotifications({ tag });
        showing.forEach((notification) => notification.close());
    }
    await self.registration.showNotification(push.title, {
        body: typeof push.body === "string" ? push.body : undefined,
        icon: "/static/images/logo-WA-min.png",
        badge: "/static/images/logo-WA-min.png",
        tag,
        data: { chatRoomId, tabUrl: push.url },
    });
}

// The same tag the page gives a chat's notification (MessageNotification), so the two never show side by side.
function chatTag(chatRoomId) {
    return `chat:${chatRoomId}`;
}

// Safari (every browser on an iPhone too) keeps both notifications of one tag, so there the older one is closed first.
function replacesByClosing() {
    const agent = self.navigator?.userAgent ?? "";
    return /AppleWebKit\//.test(agent) && !/Chrome\/|Chromium\/|Android/.test(agent);
}

self.addEventListener("notificationclick", (event) => {
    event.notification.close();

    const { chatRoomId, tabUrl } = event.notification.data ?? {};
    event.waitUntil(openFromNotification(chatRoomId, tabUrl));
});

// The tap brings one Universe window forward, or opens one when none is left, and only that window opens the chat.
async function openFromNotification(chatRoomId, tabUrl) {
    const url = sameSiteUrl(tabUrl);
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => client.url === url) ?? windows[0];

    if (existing) {
        // A browser that refuses to bring it forward still gets the chat open in it.
        const focused = (await existing.focus().catch(() => undefined)) ?? existing;
        if (chatRoomId) {
            focused.postMessage(openChatMessage(chatRoomId));
            // A window still on the release before this worker listens here instead, until it reloads.
            new BroadcastChannel("message").postMessage(openChatMessage(chatRoomId));
        }
        return;
    }

    const opened = await clients.openWindow(url);
    // A nearby chat ended with the window that showed it, so a new window only opens a chat that still exists.
    if (opened && chatRoomId && chatRoomId !== "proximity") {
        // Kept by the browser until the new page has loaded and listens (NotificationManager).
        opened.postMessage(openChatMessage(chatRoomId));
    }
}

function openChatMessage(chatRoomId) {
    return { type: "openChat", data: { chatRoomId } };
}

// Only an address on this site is opened; anything else opens the site itself.
function sameSiteUrl(tabUrl) {
    if (typeof tabUrl !== "string") {
        return self.registration.scope;
    }
    try {
        const url = new URL(tabUrl, self.location.origin);
        if (url.origin === self.location.origin) {
            return url.href;
        }
    } catch {
        // Not an address: open the site.
    }
    return self.registration.scope;
}
