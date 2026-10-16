import CancelablePromise from "cancelable-promise";
import type { Scene } from "phaser";
import Debug from "debug";
import Texture = Phaser.Textures.Texture;

const debug = Debug("SuperLoad");

/**
 * Why a resource did not arrive: the request failed or timed out ("load-error"), or the loader finished without it
 * and without an error, which is a file that arrived but could not be read ("not-decoded").
 */
export type ResourceLoadFailure = "load-error" | "not-decoded";

export class ResourceLoadError extends Error {
    constructor(
        message: string,
        public readonly resourceKey: string,
        public readonly url: string,
        public readonly reason: ResourceLoadFailure
    ) {
        super(message);
        this.name = "ResourceLoadError";
    }
}

/**
 * A wrapper around Phaser LoaderPlugin. Each method returns a (cancelable) Promise that resolves as soon as
 * the file is loaded.
 *
 * As a bonus, if the scene is destroyed BEFORE the promise resolves, the promise is canceled automatically.
 * So there is no risk of trying to add a resource on a closed scene.
 */
export class SuperLoaderPlugin {
    constructor(private scene: Scene) {}

    /** A destroyed scene (a room rebuilt) never finishes the loads it had started: those are not stalls. */
    public isSceneDestroyed(): boolean {
        // Phaser empties the scene plugin's `settings` when the scene is destroyed, but keeps `sys.settings`.
        const settings = this.scene.sys?.settings ?? this.scene.scene?.settings;
        return !settings || settings.status === Phaser.Scenes.DESTROYED;
    }

    /**
     * Add any promise to the loader.
     * The loader will consider the promise as a resource that is being loaded. Loading is done when the promise is resolved or rejected.
     */
    public loadPromise(promise: Promise<unknown>) {
        //eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.scene.load as any).rexAwait((successCallback: () => void, failureCallback: (e: unknown) => void) => {
            promise.then(successCallback).catch(failureCallback);
        });
    }

    public spritesheet(
        key: string,
        url: string,
        frameConfig?: Phaser.Types.Loader.FileTypes.ImageFrameConfig,
        xhrSettings?: Phaser.Types.Loader.XHRSettingsObject
    ) {
        return this.loadResource<Texture>(
            () => {
                this.scene.load.spritesheet(key, url, frameConfig, xhrSettings);
            },
            key,
            url,
            () => {
                if (this.scene.load.textureManager.exists(key)) {
                    return this.scene.load.textureManager.get(key);
                }
                return undefined;
            },
            "spritesheet"
        );
    }

    public image(key: string, url: string, xhrSettings?: Phaser.Types.Loader.XHRSettingsObject) {
        return this.loadResource<Texture>(
            () => {
                this.scene.load.image(key, url, xhrSettings);
            },
            key,
            url,
            () => {
                if (this.scene.load.textureManager.exists(key)) {
                    return this.scene.load.textureManager.get(key);
                }
                return undefined;
            },
            "image"
        );
    }

    /**
     * @param key
     * @param url
     * @param dataKey
     * @param xhrSettings
     * @param immediateCallback The function returns a promise BUT the "then" promise will be triggered after the current Javascript thread finishes. In case of Phaser loader, this can be a problem if you want to add additional resources to the loader in the callback. The "immediateCallback" triggers directly in the
     */
    public json(
        key: string,
        url: string,
        dataKey?: string,
        xhrSettings?: Phaser.Types.Loader.XHRSettingsObject,
        immediateCallback?: (key: string, type: string, data: unknown) => void
    ) {
        return this.loadResource<unknown>(
            () => {
                this.scene.load.json(key, url, dataKey, xhrSettings);
            },
            key,
            url,
            () => {
                if (this.scene.load.cacheManager.json.exists(key)) {
                    return this.scene.load.cacheManager.json.get(key);
                }
                return undefined;
            },
            "json",
            immediateCallback
        );
    }

    /**
     * @param callback The function that calls the loader to load a resource
     * @param key The key of the resource to be loaded
     * @param fromCache A function that checks in the cache if the resource is already available
     * @param type The type of resource loaded
     * @param immediateCallback The function returns a promise BUT the "then" promise will be triggered after the current Javascript thread finishes. In case of Phaser loader, this can be a problem if you want to add additional resources to the loader in the callback. The "immediateCallback" triggers directly in the
     * @private
     */
    private loadResource<T>(
        callback: () => void,
        key: string,
        url: string,
        fromCache: () => T | undefined,
        type: string,
        immediateCallback?: (key: string, type: string, data: unknown) => void
    ): CancelablePromise<T> {
        // If for some reason, the "url" is empty, let's reject the promise.
        if (!url) {
            console.error("Tried to load an empty " + type + ". URL is missing.");
            return CancelablePromise.reject(Error("Failed loading " + type + ": URL is empty"));
        }

        return new CancelablePromise<T>((res, rej, cancel) => {
            if (this.scene.scene.settings.status === Phaser.Scenes.DESTROYED) {
                rej(new Error("Trying to load a " + type + " in a Scene that is already destroyed."));
            }

            const resource = fromCache();
            if (resource !== undefined) {
                if (immediateCallback) {
                    immediateCallback(key, type, resource);
                }
                return res(resource);
            }

            let destroySceneEventRegistered = false;

            const unloadCallbacks = () => {
                this.scene.load.off("filecomplete-" + type + "-" + key, successCallback);
                this.scene.load.off("loaderror", errorCallback);
                this.scene.load.off(Phaser.Loader.Events.COMPLETE, loaderCompleteCallback);
                if (destroySceneEventRegistered) {
                    this.scene.events.off(Phaser.Scenes.Events.DESTROY, unloadCallbacks);
                }
            };

            // Phaser sends no event when a file arrives but can't be read (a picture that is not a picture): the
            // loader just finishes without it. Without this, such a resource never resolves nor fails, and a Woka
            // waiting for it never shows, not even as the stand-in.
            const loaderCompleteCallback = () => {
                unloadCallbacks();
                const resource = fromCache();
                if (resource !== undefined) {
                    return res(resource);
                }
                console.error(`Failed loading "${type}": "${url}"`);
                rej(new ResourceLoadError(`Failed loading "${type}": "${url}"`, key, url, "not-decoded"));
            };

            const errorCallback = (file: { src: string }) => {
                if (file.src !== url) return;
                console.error(`Failed loading "${type}": "${url}"`);
                rej(new ResourceLoadError(`Failed loading "${type}": "${url}"`, key, url, "load-error"));
                unloadCallbacks();
            };

            const successCallback = (key: string, type: string, data: unknown) => {
                this.scene.load.off("loaderror", errorCallback);
                this.scene.load.off(Phaser.Loader.Events.COMPLETE, loaderCompleteCallback);
                this.scene.events.off(Phaser.Scenes.Events.DESTROY, unloadCallbacks);
                const resource = fromCache();
                if (!resource) {
                    return rej(new Error("Newly loaded resource not available in cache"));
                }
                res(resource);

                // The "then" callbacks registered on the promise are not executed immediately when "res" is called.
                // Instead, they are called after the current JS thread finishes.
                // In some cases, we want the callbacks to execute right now. In particular if we load a map / json file
                // that contains references to other files that needs to be loaded.
                if (immediateCallback) {
                    immediateCallback(key, type, data);
                }
                debug("Resolve done for ", url);
            };

            cancel(() => {
                unloadCallbacks();
            });

            callback();

            this.scene.load.once("filecomplete-" + type + "-" + key, successCallback);
            this.scene.load.on("loaderror", errorCallback);
            this.scene.load.on(Phaser.Loader.Events.COMPLETE, loaderCompleteCallback);
            if (this.scene.scene.settings.status > Phaser.Scenes.LOADING) {
                // When the scene is destroyed, let's remove our callbacks.
                // We only need to register this destroy event is the scene is not in loading state (otherwise, Phaser
                // will take care of that for us).
                destroySceneEventRegistered = true;
                this.scene.events.once(Phaser.Scenes.Events.DESTROY, unloadCallbacks);

                // Let's start the loader if we are no more in the scene loading state
                this.scene.load.start();
                // Due to a bug, if the loader is already started, additional items are not added.... unless we
                // explicitly call the "update" method.
                this.scene.load.update();
            }
        });
    }
}
