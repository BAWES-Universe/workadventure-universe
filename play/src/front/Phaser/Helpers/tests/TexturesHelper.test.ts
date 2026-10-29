import { EventEmitter } from "events";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The helper only reads one Phaser constant; the loader and the scene are faked below.
beforeAll(() => {
    vi.stubGlobal("Phaser", { Loader: { Events: { FILE_LOAD_ERROR: "loaderror", COMPLETE: "complete" } } });
});

class FakeLoader extends EventEmitter {
    public image = vi.fn();
    public start = vi.fn();
}

function fakeScene(existing: string[] = []) {
    const load = new FakeLoader();
    const scene = { load, textures: { exists: (key: string) => existing.includes(key) } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { load, scene: scene as any };
}

const URL = "https://map-storage.test/u/w/entities/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0-arcade.png";

describe("TexturesHelper.loadEntityImage", () => {
    it("resolves once the picture loaded, and stops listening", async () => {
        const { TexturesHelper } = await import("../TexturesHelper");
        const { load, scene } = fakeScene();
        const promise = TexturesHelper.loadEntityImage(scene, URL, URL);

        load.emit(`filecomplete-image-${URL}`);

        await expect(promise).resolves.toBeUndefined();
        expect(load.listenerCount("loaderror")).toBe(0);
    });

    it("fails a picture that can't be fetched, instead of waiting for ever", async () => {
        const { TexturesHelper } = await import("../TexturesHelper");
        const { load, scene } = fakeScene();
        const promise = TexturesHelper.loadEntityImage(scene, URL, URL);

        // Another picture failing is not this one.
        load.emit("loaderror", { key: "other.png" });
        load.emit("loaderror", { key: URL });

        await expect(promise).rejects.toThrow(`Could not load the picture "${URL}"`);
        expect(load.listenerCount("loaderror")).toBe(0);
        expect(load.listenerCount(`filecomplete-image-${URL}`)).toBe(0);
    });

    it("fails a picture the browser can't read, which ends the loading with no texture and no error of its own", async () => {
        const { TexturesHelper } = await import("../TexturesHelper");
        const { load, scene } = fakeScene();
        const promise = TexturesHelper.loadEntityImage(scene, URL, URL);

        load.emit("complete");

        await expect(promise).rejects.toThrow(`Could not load the picture "${URL}"`);
        expect(load.listenerCount("loaderror")).toBe(0);
        expect(load.listenerCount("complete")).toBe(0);
        expect(load.listenerCount(`filecomplete-image-${URL}`)).toBe(0);
    });

    it("resolves at once a picture already loaded, without asking the loader", async () => {
        const { TexturesHelper } = await import("../TexturesHelper");
        const { load, scene } = fakeScene([URL]);

        await expect(TexturesHelper.loadEntityImage(scene, URL, URL)).resolves.toBeUndefined();
        expect(load.image).not.toHaveBeenCalled();
        expect(load.listenerCount("loaderror")).toBe(0);
    });
});
