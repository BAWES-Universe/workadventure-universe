import { describe, it, vi, expect } from "vitest";

vi.hoisted(() => {
    process.env.API_URL = "localhost:50051";
    process.env.PUSHER_URL = "http://localhost";
    process.env.MAP_STORAGE_API_TOKEN = "test";
    process.env.AUTHENTICATION_TOKEN = "test";
});

const { writeByteArrayAsFile, deleteFiles } = vi.hoisted(() => ({
    writeByteArrayAsFile: vi.fn(),
    deleteFiles: vi.fn(),
}));
vi.mock("../../fileSystem", () => ({ fileSystem: { writeByteArrayAsFile, deleteFiles } }));

import { UploadedFileKind } from "@workadventure/messages";
import { CustomFileService } from "../CustomFileService";

describe("CustomFileService.uploadFile", () => {
    const service = new CustomFileService("localhost");
    const file = new Uint8Array([1, 2, 3]);

    it("stores the file in the files folder", async () => {
        await service.uploadFile({
            id: "upload",
            name: "notes.pdf",
            propertyId: "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0",
            file,
            kind: UploadedFileKind.Document,
        });
        expect(writeByteArrayAsFile).toHaveBeenCalledWith(
            expect.stringMatching(/private\/files\/notes-0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0\.pdf$/),
            file
        );
    });

    it("refuses a property id that would leave the files folder", async () => {
        writeByteArrayAsFile.mockClear();
        await expect(
            service.uploadFile({
                id: "upload",
                name: "x.png",
                propertyId: "/../../../other-world/escaped",
                file,
                kind: UploadedFileKind.Document,
            })
        ).rejects.toThrow("Invalid property id");
        expect(writeByteArrayAsFile).not.toHaveBeenCalled();
    });

    it("stores a sound in the sounds folder (#1626)", async () => {
        writeByteArrayAsFile.mockClear();
        await service.uploadFile({
            id: "upload",
            name: "Rain.MP3",
            propertyId: "a1b2c3d4",
            file,
            kind: UploadedFileKind.Sound,
        });
        expect(writeByteArrayAsFile).toHaveBeenCalledWith(
            expect.stringMatching(/private\/sounds\/Rain-a1b2c3d4\.MP3$/),
            file
        );
    });

    it("refuses a sound sent as a document, and a document sent as a sound", async () => {
        writeByteArrayAsFile.mockClear();
        await expect(
            service.uploadFile({
                id: "upload",
                name: "rain.mp3",
                propertyId: "a1b2c3d4",
                file,
                kind: UploadedFileKind.Document,
            })
        ).rejects.toThrow("not a supported format");
        await expect(
            service.uploadFile({
                id: "upload",
                name: "notes.pdf",
                propertyId: "a1b2c3d4",
                file,
                kind: UploadedFileKind.Sound,
            })
        ).rejects.toThrow("not a supported format");
        expect(writeByteArrayAsFile).not.toHaveBeenCalled();
    });

    it("refuses a kind it does not know", async () => {
        await expect(
            service.uploadFile({
                id: "upload",
                name: "rain.mp3",
                propertyId: "a1b2c3d4",
                file,
                kind: UploadedFileKind.UNRECOGNIZED,
            })
        ).rejects.toThrow("Unknown kind of file");
    });
});

describe("CustomFileService.deleteFile", () => {
    const service = new CustomFileService("localhost");

    it("deletes an uploaded sound from the sounds folder (#1626)", async () => {
        deleteFiles.mockClear();
        await service.deleteFile({
            id: "a1b2c3d4",
            type: "playAudio",
            audioLink: "http://localhost/private/sounds/rain-a1b2c3d4.mp3",
            audioName: "rain.mp3",
        });
        expect(deleteFiles).toHaveBeenCalledWith(expect.stringMatching(/private\/sounds\/rain-a1b2c3d4\.mp3$/));
    });

    it("refuses an id or an extension that would leave the folder or is not a file of this kind", async () => {
        deleteFiles.mockClear();
        await expect(
            service.deleteFile({
                id: "../../other-world/x",
                type: "playAudio",
                audioLink: "http://localhost/private/sounds/rain.mp3",
                audioName: "rain.mp3",
            })
        ).rejects.toThrow("Invalid property id");
        await expect(
            service.deleteFile({ id: "../x", type: "openFile", link: "http://localhost/f", name: "notes.pdf" } as never)
        ).rejects.toThrow("Invalid property id");
        await expect(
            service.deleteFile({
                id: "a1b2c3d4",
                type: "playAudio",
                audioLink: "http://localhost/private/sounds/rain.sh",
                audioName: "rain.sh",
            })
        ).rejects.toThrow("not a supported format");
        expect(deleteFiles).not.toHaveBeenCalled();
    });

    it("has nothing to delete for a pasted sound link", async () => {
        await expect(
            service.deleteFile({ id: "a1b2c3d4", type: "playAudio", audioLink: "https://example.com/rain.mp3" })
        ).rejects.toThrow("missing name");
    });
});
