import { describe, expect, it, vi } from "vitest";
import { withAreaSpaceRights } from "../../src/pusher/services/SocketManager";

// The pusher's environment is checked when SocketManager is imported
vi.hoisted(() => {
    process.env.SECRET_KEY ??= "test-secret";
    process.env.API_URL ??= "localhost:50051";
    process.env.MAP_STORAGE_API_TOKEN ??= "test-token";
    process.env.UPLOADER_URL ??= "http://uploader.example.com";
    process.env.ICON_URL ??= "http://icon.example.com";
    process.env.ENFORCE_AREA_SPACE_RIGHTS = "false";
});

vi.mock("../../src/pusher/services/MatrixProvider", () => ({ matrixProvider: {} }));

describe("withAreaSpaceRights with ENFORCE_AREA_SPACE_RIGHTS off", () => {
    it("returns settings with no refused or listen-only spaces, so the browser keeps the spaces the server allows", () => {
        const sent = withAreaSpaceRights({
            refusedAreaSpaces: ["Stage"],
            listenOnlyAreaSpaces: ["Hall"],
            areaSpacesUnknown: true,
        });

        expect(sent).toEqual({ refusedAreaSpaces: [], listenOnlyAreaSpaces: [], areaSpacesUnknown: false });
    });

    it("leaves a missing settings message missing", () => {
        expect(withAreaSpaceRights(undefined)).toBeUndefined();
    });
});
