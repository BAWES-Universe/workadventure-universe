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

    it("keeps the fields of a caught object that is not an Error, such as a file system code and path", async () => {
        const readWamFile = createReadWamFile({ code: "ENOENT", path: "/map.wam" });

        const thrown = await readWamFile("missing.wam", "example.com").catch((e: unknown) => e);

        expect((thrown as Error).message).toContain('{"code":"ENOENT","path":"/map.wam"}');
    });

    it("writes out an object that appears twice in different places, as it is not a cycle", async () => {
        const shared = { code: "EACCES" };
        const readWamFile = createReadWamFile({ first: shared, second: shared, nested: { again: shared } });

        const thrown = await readWamFile("shared.wam", "example.com").catch((e: unknown) => e);

        expect((thrown as Error).message).toContain(
            '{"first":{"code":"EACCES"},"second":{"code":"EACCES"},"nested":{"again":{"code":"EACCES"}}}'
        );
        expect((thrown as Error).message).not.toContain("[Circular]");
    });

    it("shows a reference to a parent that is two levels up as circular", async () => {
        const root: Record<string, unknown> = { child: { name: "inner" } };
        (root.child as Record<string, unknown>).back = root;
        const readWamFile = createReadWamFile(root);

        const thrown = await readWamFile("deep.wam", "example.com").catch((e: unknown) => e);

        expect((thrown as Error).message).toContain('{"child":{"name":"inner","back":"[Circular]"}}');
    });

    it("does not fail with a circular JSON error when the caught value is a circular object", async () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        const readWamFile = createReadWamFile(circular);

        const thrown = await readWamFile("broken.wam", "example.com").catch((e: unknown) => e);

        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).toContain('Error while trying to read WAM file "broken.wam"');
        expect((thrown as Error).message).toContain('{"self":"[Circular]"}');
        expect((thrown as Error).message).not.toMatch(/circular structure/i);
        expect((thrown as Error).cause).toBe(circular);
    });
});
