/** The one service worker of the game. It also shows and answers the chat notifications. */
export const SERVICE_WORKER_URL = "/service-worker.js";

export class _ServiceWorker {
    constructor() {
        if ("serviceWorker" in navigator) {
            if (navigator.storage && navigator.storage.persist) {
                navigator.storage
                    .persist()
                    .then((persistent) => {
                        if (persistent) {
                            console.info("Storage will not be cleared except by explicit user action");
                        } else {
                            console.info("Storage may be cleared by the UA under storage pressure.");
                        }
                    })
                    .catch((err) => console.error("_ServiceWorker => err", err));
            }
            this.init();
        }
    }

    init() {
        // One worker for every room and every build, at a stable address: a changing address (it used to carry the
        // room) made the browser install a new worker on every room change.
        navigator.serviceWorker
            .register(SERVICE_WORKER_URL)
            .then((serviceWorker) => {
                console.info("Service Worker registered: ", serviceWorker);
            })
            .catch((error) => {
                console.error("Error registering the Service Worker: ", error);
            });
    }
}
