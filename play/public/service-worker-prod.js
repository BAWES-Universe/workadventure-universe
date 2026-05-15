const CACHE_NAME = "workadventure-cache-v2";
const DEFAULT_CACHE_URLS = ["/"];
const DEFAULT_NOTIFICATION_TITLE = "BAWES Universe";
const DEFAULT_NOTIFICATION_ICON = "/static/images/favicons/favicon-96x96.png";

function getInstallCacheUrls(event) {
    const scriptURL = event?.target?.serviceWorker?.scriptURL;
    if (!scriptURL) {
        return DEFAULT_CACHE_URLS;
    }

    const url = new URL(scriptURL);
    const playUri = url.searchParams.get("playUri");
    return playUri ? [playUri] : DEFAULT_CACHE_URLS;
}

function parsePushPayload(event) {
    if (!event.data) {
        return {};
    }

    try {
        return event.data.json();
    } catch (error) {
        return {
            body: event.data.text(),
        };
    }
}

function toNotificationUrl(rawUrl) {
    try {
        const url = new URL(rawUrl || "/", self.location.origin);
        return url.origin === self.location.origin ? url.href : self.location.origin;
    } catch (error) {
        return self.location.origin;
    }
}

self.addEventListener("install", (event) => {
    const urlsToCache = getInstallCacheUrls(event);

    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => cache.addAll(urlsToCache))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((cacheNames) =>
                Promise.all(
                    cacheNames
                        .filter((cacheName) => cacheName !== CACHE_NAME)
                        .map((cacheName) => caches.delete(cacheName))
                )
            )
            .then(() => clients.claim())
    );
});

self.addEventListener("message", (event) => {
    if (event.data?.type === "SKIP_WAITING") {
        event.waitUntil(self.skipWaiting());
    }
});

self.addEventListener("push", (event) => {
    const payload = parsePushPayload(event);
    const title = payload.title || DEFAULT_NOTIFICATION_TITLE;
    const targetUrl = toNotificationUrl(payload.url);

    const notification = {
        body: payload.body || "",
        icon: payload.icon || DEFAULT_NOTIFICATION_ICON,
        badge: payload.badge || DEFAULT_NOTIFICATION_ICON,
        tag: payload.tag || "bawes-universe",
        data: {
            url: targetUrl,
        },
    };

    event.waitUntil(self.registration.showNotification(title, notification));
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();

    const targetUrl = event.notification.data?.url || self.location.origin;
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
});
