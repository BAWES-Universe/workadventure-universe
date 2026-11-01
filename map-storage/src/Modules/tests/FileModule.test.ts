import { describe, it, vi, expect, beforeEach } from "vitest";
import type { AreaDataProperty } from "@workadventure/map-editor";

vi.hoisted(() => {
    process.env.API_URL = "localhost:50051";
    process.env.PUSHER_URL = "http://localhost";
    process.env.MAP_STORAGE_API_TOKEN = "test";
    process.env.AUTHENTICATION_TOKEN = "test";
});

const { deleteFiles } = vi.hoisted(() => ({ deleteFiles: vi.fn() }));
vi.mock("../../fileSystem", () => ({ fileSystem: { deleteFiles } }));

import { HookManager } from "../HookManager";
import { FileModule } from "../FileModule";

const uploaded: AreaDataProperty = {
    id: "a1b2c3d4",
    type: "playAudio",
    audioLink: "http://localhost/private/sounds/rain-a1b2c3d4.mp3",
    audioName: "rain.mp3",
    volume: 0.6,
};

describe("FileModule and uploaded sounds (#1626)", () => {
    const hookManager = new HookManager();
    new FileModule().init(hookManager);
    const area = { id: "lounge", properties: [uploaded] };

    beforeEach(() => {
        deleteFiles.mockClear();
    });

    it("keeps the sound when only the volume changes", async () => {
        await hookManager.fireAreaPropertyChange(area, uploaded, { ...uploaded, volume: 0.3 }, "localhost");
        expect(deleteFiles).not.toHaveBeenCalled();
    });

    it("deletes the uploaded sound when a link is pasted instead", async () => {
        await hookManager.fireAreaPropertyChange(
            area,
            uploaded,
            { id: uploaded.id, type: "playAudio", audioLink: "https://example.com/birds.mp3" },
            "localhost"
        );
        expect(deleteFiles).toHaveBeenCalledWith(expect.stringMatching(/private\/sounds\/rain-a1b2c3d4\.mp3$/));
    });

    it("deletes the old upload when another sound is uploaded", async () => {
        await hookManager.fireEntityPropertyChange(
            { name: "fireplace", properties: [uploaded] },
            uploaded,
            {
                ...uploaded,
                audioLink: "http://localhost/private/sounds/fire-a1b2c3d4.ogg",
                audioName: "fire.ogg",
            },
            "localhost"
        );
        expect(deleteFiles).toHaveBeenCalledWith(expect.stringMatching(/private\/sounds\/rain-a1b2c3d4\.mp3$/));
    });

    it("deletes the uploaded sound with its property", async () => {
        await hookManager.fireAreaPropertyDelete(area, uploaded, "localhost");
        expect(deleteFiles).toHaveBeenCalledTimes(1);
    });

    it("never deletes anything for a pasted link", async () => {
        const pasted: AreaDataProperty = { id: "b", type: "playAudio", audioLink: "https://example.com/a.mp3" };
        await hookManager.fireAreaPropertyDelete({ id: "lounge", properties: [pasted] }, pasted, "localhost");
        expect(deleteFiles).not.toHaveBeenCalled();
    });
});
