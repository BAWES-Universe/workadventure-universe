import { describe, it, vi, expect } from "vitest";

vi.hoisted(() => {
    process.env.API_URL = "localhost:50051";
    process.env.PUSHER_URL = "http://localhost";
    process.env.MAP_STORAGE_API_TOKEN = "test";
    process.env.AUTHENTICATION_TOKEN = "test";
});

const { writeByteArrayAsFile } = vi.hoisted(() => ({ writeByteArrayAsFile: vi.fn() }));
vi.mock("../../fileSystem", () => ({ fileSystem: { writeByteArrayAsFile } }));

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
        });
        expect(writeByteArrayAsFile).toHaveBeenCalledWith(
            expect.stringMatching(/private\/files\/notes-0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0\.pdf$/),
            file
        );
    });

    it("refuses a property id that would leave the files folder", async () => {
        writeByteArrayAsFile.mockClear();
        await expect(
            service.uploadFile({ id: "upload", name: "x.png", propertyId: "/../../../other-world/escaped", file })
        ).rejects.toThrow("Invalid property id");
        expect(writeByteArrayAsFile).not.toHaveBeenCalled();
    });
});
