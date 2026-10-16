// The one service worker of Universe, at the root so its scope is the whole site.
//
// It keeps nothing offline: the game's files are never stored, so a new release always loads. (The Cache API
// holds one entry of the page's own, the last room, and this worker leaves it alone.) What it does is
// take a tapped chat notification to the chat, and give the browsers that ask for one the worker they expect
// before they offer to install the app.

self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(clients.claim());
});

// Nothing is answered from here: every request goes to the network as it always did.
self.addEventListener("fetch", () => {});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();

    // Get the chat room data from notification
    const { chatRoomId, tabUrl } = event.notification.data;

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
