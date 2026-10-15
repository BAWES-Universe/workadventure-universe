import { EventEmitter } from "events";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The plugin only reads a few Phaser constants; the loader and the scene are faked below.
beforeAll(() => {
    vi.stubGlobal("Phaser", {
        Scenes: { LOADING: 2, RUNNING: 5, DESTROYED: 9, Events: { DESTROY: "destroy" } },
        Loader: { Events: { COMPLETE: "complete" } },
        Textures: { Texture: class {} },
    });
});

class FakeLoader extends EventEmitter {
    public readonly cache = new Map<string, unknown>();
    public readonly textureManager = {
        exists: (key: string) => this.cache.has(key),
        get: (key: string) => this.cache.get(key),
    };
    public spritesheet = vi.fn();
    public start = vi.fn();
    public update = vi.fn();
}

function fakeScene() {
    const load = new FakeLoader();
    const scene = {
        load,
        events: new EventEmitter(),
        scene: { settings: { status: 5 } },
    };
    return { load, scene };
}

async function createPlugin() {
    const { SuperLoaderPlugin } = await import("../SuperLoaderPlugin");
    const { load, scene } = fakeScene();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { load, plugin: new SuperLoaderPlugin(scene as any) };
}

describe("SuperLoaderPlugin", () => {
    it("fails a picture the loader finished without (it arrived but could not be read)", async () => {
        const { load, plugin } = await createPlugin();
        const promise = plugin.spritesheet("body", "https://example.test/body.png");

        // Phaser sends no error for a picture it cannot decode: the loader just completes.
        load.emit("complete");

        await expect(promise).rejects.toThrow('Failed loading "spritesheet": "https://example.test/body.png"');
        expect(load.listenerCount("complete")).toBe(0);
        expect(load.listenerCount("loaderror")).toBe(0);
    });

    it("resolves a picture that loaded, and stops listening for the end of the loader", async () => {
        const { load, plugin } = await createPlugin();
        const promise = plugin.spritesheet("body", "https://example.test/body.png");

        load.cache.set("body", "texture");
        load.emit("filecomplete-spritesheet-body", "body", "spritesheet", {});
        load.emit("complete");

        await expect(promise).resolves.toBe("texture");
        expect(load.listenerCount("complete")).toBe(0);
    });

    it("resolves when the picture is in the cache once the loader is done", async () => {
        const { load, plugin } = await createPlugin();
        const promise = plugin.spritesheet("body", "https://example.test/body.png");

        // Loaded by another request for the same key.
        load.cache.set("body", "texture");
        load.emit("complete");

        await expect(promise).resolves.toBe("texture");
    });

    it("still fails on a load error", async () => {
        const { load, plugin } = await createPlugin();
        const promise = plugin.spritesheet("body", "https://example.test/body.png");

        load.emit("loaderror", { src: "https://example.test/body.png" });

        await expect(promise).rejects.toThrow("Failed loading");
        expect(load.listenerCount("complete")).toBe(0);
    });

    it("rejects without touching the loader when Phaser already cleared the scene (scene.scene is null)", async () => {
        const { SuperLoaderPlugin } = await import("../SuperLoaderPlugin");
        const { load, scene } = fakeScene();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (scene as any).scene = null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const plugin = new SuperLoaderPlugin(scene as any);

        await expect(plugin.spritesheet("body", "https://example.test/body.png")).rejects.toThrow(
            "Scene that is already destroyed"
        );
        expect(load.spritesheet).not.toHaveBeenCalled();
        expect(load.listenerCount("complete")).toBe(0);
    });

    it("rejects without touching the loader when the scene is destroyed", async () => {
        const { SuperLoaderPlugin } = await import("../SuperLoaderPlugin");
        const { load, scene } = fakeScene();
        scene.scene.settings.status = 9;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const plugin = new SuperLoaderPlugin(scene as any);

        await expect(plugin.spritesheet("body", "https://example.test/body.png")).rejects.toThrow(
            "Scene that is already destroyed"
        );
        expect(load.spritesheet).not.toHaveBeenCalled();
    });
});
