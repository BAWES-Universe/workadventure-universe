import { NODE_ENV } from "../Enum/EnvironmentVariable";
import { serviceWorkerUpdateStore } from "../Stores/ServiceWorkerUpdateStore";

export class _ServiceWorker {
    private pageWasControlled = typeof navigator !== "undefined" && Boolean(navigator.serviceWorker?.controller);
    private reloadWhenControllerChanges = false;

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
        this.listenForControllerChange();

        //Check node env and if is development, use service worker dev file
        if (NODE_ENV === "development") {
            this.register(
                `/service-worker-dev.js?playUri=${window.location.protocol}//${window.location.host}${window.location.pathname}`
            );
            return;
        }
        this.register(
            `/service-worker-prod.js?playUri=${window.location.protocol}//${window.location.host}${window.location.pathname}`
        );
    }

    private register(scriptUrl: string): void {
        navigator.serviceWorker
            .register(scriptUrl)
            .then((serviceWorker) => {
                console.info("Service Worker registered: ", serviceWorker);
                this.watchRegistration(serviceWorker);
            })
            .catch((error) => {
                console.error("Error registering the Service Worker: ", error);
            });
    }

    private watchRegistration(registration: ServiceWorkerRegistration): void {
        if (registration.waiting && navigator.serviceWorker.controller) {
            this.showUpdatePrompt(registration);
        }

        registration.addEventListener("updatefound", () => {
            const worker = registration.installing;
            if (!worker) {
                return;
            }
            worker.addEventListener("statechange", () => {
                if (worker.state === "installed" && navigator.serviceWorker.controller) {
                    this.showUpdatePrompt(registration);
                }
            });
        });
    }

    private listenForControllerChange(): void {
        navigator.serviceWorker.addEventListener("controllerchange", () => {
            if (!this.pageWasControlled) {
                this.pageWasControlled = true;
                return;
            }
            if (this.reloadWhenControllerChanges) {
                window.location.reload();
                return;
            }
            serviceWorkerUpdateStore.set({
                reload: () => window.location.reload(),
            });
        });
    }

    private showUpdatePrompt(registration: ServiceWorkerRegistration): void {
        serviceWorkerUpdateStore.set({
            reload: () => {
                this.reloadWhenControllerChanges = true;
                registration.waiting?.postMessage({ type: "SKIP_WAITING" });
            },
        });
    }
}
