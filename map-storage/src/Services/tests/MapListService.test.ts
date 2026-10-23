import { describe, it, vi, expect } from "vitest";

vi.hoisted(() => {
    process.env.API_URL = "localhost:50051";
    process.env.PUSHER_URL = "http://localhost";
    process.env.MAP_STORAGE_API_TOKEN = "test";
    process.env.AUTHENTICATION_TOKEN = "test";
});

// Mock the global fileSystem module (used by generateCacheFileNoLimit)
vi.mock("../../fileSystem", () => ({
    fileSystem: {
        listFiles: vi.fn().mockResolvedValue([]),
        readFileAsString: vi.fn(),
        writeStringAsFile: vi.fn(),
    },
}));

// Mock WebHookService
vi.mock("../WebHookService");

import { MapListService } from "../MapListService";
import type { FileSystemInterface } from "../../Upload/FileSystemInterface";
import type { WebHookService } from "../WebHookService";

type ReadWamFile = (wamFilePath: string, domain: string) => Promise<unknown>;

function createReadWamFile(readError: unknown): ReadWamFile {
    const fileSystem = {
        readFileAsString: vi.fn().mockRejectedValue(readError),
    } as unknown as FileSystemInterface;
    const service = new MapListService(fileSystem, {} as unknown as WebHookService);
    const { readWamFile } = service as unknown as { readWamFile: ReadWamFile };
    return readWamFile.bind(service);
}

describe("MapListService.readWamFile", () => {
    it("wraps an Error using its message and keeps it as the cause", async () => {
        const original = new Error("connection refused");
        const readWamFile = createReadWamFile(original);

        const thrown = await readWamFile("test.wam", "example.com").catch((e: unknown) => e);

        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).toContain('Error while trying to read WAM file "test.wam"');
        expect((thrown as Error).message).toContain("connection refused");
        expect((thrown as Error).cause).toBe(original);
    });

    it("does not fail with a circular JSON error when the caught value is a circular object", async () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        const readWamFile = createReadWamFile(circular);

        const thrown = await readWamFile("broken.wam", "example.com").catch((e: unknown) => e);

        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).toContain('Error while trying to read WAM file "broken.wam"');
        expect((thrown as Error).message).toContain("[object Object]");
        expect((thrown as Error).message).not.toMatch(/circular/i);
        expect((thrown as Error).cause).toBe(circular);
    });
});
