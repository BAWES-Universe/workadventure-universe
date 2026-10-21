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

describe("MapListService.readWamFile", () => {
    it("wraps a normal Error without throwing a secondary JSON error", async () => {
        const mockFs = {
            readFileAsString: vi.fn().mockRejectedValue(new Error("connection refused")),
        } as unknown as FileSystemInterface;

        const mockWebHook = {} as unknown as WebHookService;
        const service = new MapListService(mockFs, mockWebHook);

        // Access the private method via cast
        const readWamFile = (service as unknown as Record<string, Function>)["readWamFile"].bind(service);

        await expect(readWamFile("test.wam", "example.com")).rejects.toThrow(
            /Error while trying to read WAM file "test\.wam".*connection refused/
        );
    });

    it("does not throw when the caught error contains circular references", async () => {
        // Build a circular-reference error object (simulates TLSSocket graph)
        const circularError: Record<string, unknown> = { message: "tls handshake failed" };
        circularError["self"] = circularError; // circular!

        const mockFs = {
            readFileAsString: vi.fn().mockRejectedValue(circularError),
        } as unknown as FileSystemInterface;

        const mockWebHook = {} as unknown as WebHookService;
        const service = new MapListService(mockFs, mockWebHook);

        const readWamFile = (service as unknown as Record<string, Function>)["readWamFile"].bind(service);

        // Should throw an Error whose message does NOT cause a secondary TypeError
        await expect(readWamFile("circular.wam", "example.com")).rejects.toThrow(Error);

        // The thrown error should itself be serializable (no circular refs)
        const thrown = await readWamFile("circular.wam", "example.com").catch((e: unknown) => e);
        expect(() => JSON.stringify(thrown)).not.toThrow();
    });
});
