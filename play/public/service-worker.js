// The one service worker of Universe, at the root so its scope is the whole site.
//
// It keeps nothing offline: the game's files are never stored, so a new release always loads. (The Cache API
// holds one entry of the page's own, the last room, and this worker leaves it alone.) What it does is
// show a web push when one arrives, take a tapped chat notification to the chat, and give the browsers
// that ask for one the worker they expect before they offer to install the app.

const DEFAULT_NOTIFICATION_TITLE = "BAWES Universe";
const DEFAULT_NOTIFICATION_ICON = "/static/images/favicons/favicon-96x96.png";

self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(clients.claim());
});

self.addEventListener("message", (event) => {
    if (event.data?.type === "SKIP_WAITING") {
        event.waitUntil(self.skipWaiting());
    }
});

// Nothing is answered from here: every request goes to the network as it always did.
self.addEventListener("fetch", () => {});

// PushMessageData can be read once. Take the text, then parse JSON when the body is JSON.
function parsePushPayload(event) {
    if (!event.data) {
        return {};
    }

    const text = event.data.text();
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object") {
            return { body: text };
        }
        return parsed;
    } catch {
        return { body: text };
    }
}

function toNotificationUrl(rawUrl) {
    try {
        const url = new URL(rawUrl || "/", self.location.origin);
        return url.origin === self.location.origin ? url.href : self.location.origin;
    } catch {
        return self.location.origin;
    }
}

self.addEventListener("push", (event) => {
    const payload = parsePushPayload(event);
    const title = payload.title || DEFAULT_NOTIFICATION_TITLE;
    const targetUrl = toNotificationUrl(payload.url);

    event.waitUntil(
        self.registration.showNotification(title, {
            body: payload.body || "",
            icon: payload.icon || DEFAULT_NOTIFICATION_ICON,
            badge: payload.badge || DEFAULT_NOTIFICATION_ICON,
            tag: payload.tag || "bawes-universe",
            data: {
                url: targetUrl,
            },
        })
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();

    const data = event.notification.data || {};

    // Web push carries a same-origin page. Chat notifications carry the room instead.
    if (typeof data.url === "string" && data.url) {
        const targetUrl = data.url;
        event.waitUntil(
            clients
                .matchAll({
                    type: "window",
                    includeUncontrolled: true,
                })
                .then((clientList) => {
                    for (const client of clientList) {
                        if (client.url === targetUrl && "focus" in client) {
                            return client.focus();
                        }
                    }

                    return clients.openWindow(targetUrl);
                })
        );
        return;
    }

    // Get the chat room data from notification
    const { chatRoomId, tabUrl } = data;

    // Focus or open window and navigate to chat
    event.waitUntil(
        clients.matchAll({ type: "window" }).then((clientList) => {
            if (clientList.length > 0) {
                // Focus existing window
                const waClient = clientList.find((client) => client.url === tabUrl);

                if (waClient) {
                    waClient.focus();
                } else {
                    clientList[0].focus();
                }
            }

            // Send message to open chat if room data exists
            if (chatRoomId) {
                const messageChannel = new BroadcastChannel("message");
                messageChannel.postMessage({
                    type: "openChat",
                    data: {
                        chatRoomId,
                    },
                });
            }
        })
    );
});
