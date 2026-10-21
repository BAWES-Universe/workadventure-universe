import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

const { saveMessageFiles } = vi.hoisted(() => ({ saveMessageFiles: vi.fn(() => Promise.resolve()) }));
vi.mock("../../Chat/Components/Room/MessageActions/availableActions", () => ({ saveMessageFiles }));

import { coWebsites, fullScreenCowebsite } from "../../Stores/CoWebsiteStore";
import { FileViewerCoWebsite } from "../../WebRtc/CoWebsite/FileViewerCoWebsite";
import {
    createMapFileViewer,
    mapFileName,
    mapFileOpensInViewer,
    openChatFileInNewTab,
    openChatFileInViewer,
    openFileViewerKeys,
} from "../openFileViewer";

function setPhoneScreen(isPhone: boolean) {
    window.matchMedia = vi.fn((query: string) => ({
        matches: isPhone && query === "(max-width: 640px)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
}

function opened(): FileViewerCoWebsite[] {
    return get(coWebsites).filter(
        (coWebsite): coWebsite is FileViewerCoWebsite => coWebsite instanceof FileViewerCoWebsite
    );
}

describe("opening a chat file in the viewer", () => {
    beforeEach(() => {
        setPhoneScreen(false);
        coWebsites.removeAll();
        fullScreenCowebsite.set(false);
        saveMessageFiles.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        coWebsites.removeAll();
        fullScreenCowebsite.set(false);
    });

    it("adds one panel that knows its name and who sent the file", () => {
        openChatFileInViewer({ url: "blob:http://play/abc", name: "Q3 roadmap.pdf", senderName: "Sara" });

        const [viewer] = opened();
        expect(opened()).toHaveLength(1);
        expect(viewer.source.name).toBe("Q3 roadmap.pdf");
        expect(viewer.source.senderName).toBe("Sara");
        expect(viewer.isClosable()).toBe(true);
        expect(get(fullScreenCowebsite)).toBe(false);
    });

    it("does not open the same file twice", () => {
        const file = { url: "blob:http://play/abc", name: "plan.pdf" };
        openChatFileInViewer(file);
        openChatFileInViewer(file);

        expect(opened()).toHaveLength(1);
    });

    it("lets the card of the open file show as open, and not once it is closed", () => {
        openChatFileInViewer({ url: "blob:http://play/abc", name: "plan.pdf" });
        expect(get(openFileViewerKeys).has("chat:blob:http://play/abc")).toBe(true);

        coWebsites.remove(opened()[0]);
        expect(get(openFileViewerKeys).has("chat:blob:http://play/abc")).toBe(false);
    });

    it("fills a phone's screen, and says so, so closing gives the screen back", () => {
        setPhoneScreen(true);
        openChatFileInViewer({ url: "blob:http://play/abc", name: "plan.pdf" });

        expect(get(fullScreenCowebsite)).toBe(true);
        expect(opened()[0].openedFullScreen).toBe(true);
    });

    it("reads the bytes chat already fetched, with no token in any link", async () => {
        const fetched = vi.fn(() => Promise.resolve(new Response(new Uint8Array([1, 2, 3]))));
        vi.stubGlobal("fetch", fetched);
        openChatFileInViewer({ url: "blob:http://play/abc", name: "plan.pdf" });

        const bytes = await opened()[0].source.load(new AbortController().signal);

        expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3]));
        expect(fetched).toHaveBeenCalledWith("blob:http://play/abc", expect.anything());
        vi.unstubAllGlobals();
    });

    it("saves with the same call as the card's Download button and the message menu", async () => {
        openChatFileInViewer({ url: "blob:http://play/abc", name: "plan.pdf" });

        await opened()[0].source.download(undefined);

        expect(saveMessageFiles).toHaveBeenCalledWith([{ url: "blob:http://play/abc", name: "plan.pdf" }]);
    });

    it("says a file you sent is from you", () => {
        openChatFileInViewer({ url: "blob:http://play/mine", name: "plan.pdf", sentByMe: true });

        expect(opened()[0].source.sentByMe).toBe(true);
    });

    it("opens a PDF in the browser's own viewer in a new tab with a PDF type", () => {
        const open = vi.spyOn(window, "open").mockReturnValue(null);
        const createObjectURL = vi.fn(() => "blob:http://play/new");
        URL.createObjectURL = createObjectURL;
        URL.revokeObjectURL = vi.fn();
        openChatFileInViewer({ url: "blob:http://play/abc", name: "plan.pdf" });

        opened()[0].source.openInNewTab?.(new Uint8Array([37, 80, 68, 70]).buffer);

        expect(open).toHaveBeenCalledWith("blob:http://play/new", "_blank", "noopener,noreferrer");
        const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
        expect(blob.type).toBe("application/pdf");
    });

    it("opens a card clicked with Ctrl or Cmd as a new tab, without the panel", async () => {
        const open = vi.spyOn(window, "open").mockReturnValue(null);
        URL.createObjectURL = vi.fn(() => "blob:http://play/new");
        URL.revokeObjectURL = vi.fn();
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response(new Uint8Array([37, 80, 68, 70]))))
        );

        openChatFileInNewTab({ url: "blob:http://play/abc", name: "plan.pdf" });
        await vi.waitFor(() => expect(open).toHaveBeenCalled());

        expect(opened()).toHaveLength(0);
        vi.unstubAllGlobals();
    });
});

describe("opening a map's file in the viewer", () => {
    const link = "https://map-storage.example.com/files/room/Plan%20A.pdf?token=a.b.c";

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("shows PDFs and pictures, and leaves other files to the plain panel", () => {
        expect(mapFileOpensInViewer(link)).toBe(true);
        expect(mapFileOpensInViewer("https://x.example.com/a.png?token=t")).toBe(true);
        expect(mapFileOpensInViewer("https://x.example.com/a.docx")).toBe(false);
        expect(mapFileOpensInViewer("https://x.example.com/page")).toBe(false);
    });

    it("names the panel after the file, never its address", () => {
        expect(mapFileName(link)).toBe("Plan A.pdf");
        const viewer = createMapFileViewer({ link });
        expect(viewer.source.name).toBe("Plan A.pdf");
        expect(viewer.getUrl().toString()).toBe("about:blank");
        expect(viewer.source.key).toBe("map:https://map-storage.example.com/files/room/Plan%20A.pdf");
    });

    it("keeps the object's or zone's width, can be closed and Hide URL", () => {
        const viewer = createMapFileViewer({ link, width: 40, closable: false, hideUrl: true });

        expect(viewer.getWidthPercent()).toBe(40);
        expect(viewer.isClosable()).toBe(false);
        expect(viewer.getHideUrl()).toBe(true);
    });

    it("fetches the file with the pass from the link", async () => {
        const fetched = vi.fn(() => Promise.resolve(new Response(new Uint8Array([1]))));
        vi.stubGlobal("fetch", fetched);

        await createMapFileViewer({ link }).source.load(new AbortController().signal);

        expect(fetched).toHaveBeenCalledWith(link, expect.anything());
    });

    it("fails a file the map storage refuses, so the panel can say it can't preview it", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response("Forbidden", { status: 403 })))
        );

        await expect(createMapFileViewer({ link }).source.load(new AbortController().signal)).rejects.toThrow("403");
    });

    it("opens the original link in a new tab, unless Hide URL is on", () => {
        const open = vi.spyOn(window, "open").mockReturnValue(null);

        createMapFileViewer({ link }).source.openInNewTab?.(undefined);
        expect(open).toHaveBeenCalledWith(link, "_blank", "noopener,noreferrer");
        expect(createMapFileViewer({ link, hideUrl: true }).source.openInNewTab).toBeUndefined();
    });

    it("downloads the bytes under the file's real name, as a download type", () => {
        const createObjectURL = vi.fn(() => "blob:http://play/dl");
        URL.createObjectURL = createObjectURL;
        URL.revokeObjectURL = vi.fn();
        const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

        void createMapFileViewer({ link }).source.download(new Uint8Array([1, 2]).buffer);

        expect(click).toHaveBeenCalled();
        const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
        expect(blob.type).toBe("application/octet-stream");
    });
});
