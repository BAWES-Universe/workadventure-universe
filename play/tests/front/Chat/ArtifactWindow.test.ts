import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import type * as SvelteRuntime from "svelte";
import { readable } from "svelte/store";

vi.mock("svelte", async (importOriginal) => {
    const svelte = await importOriginal<typeof SvelteRuntime>();
    // eslint-disable-next-line svelte/no-svelte-internal
    const { onMount } = await import("svelte/internal");
    return { ...svelte, onMount };
});

const api = vi.hoisted(() => {
    class ArtifactRequestError extends Error {
        constructor(public readonly status: number, public readonly code: string) {
            super(code);
        }
    }
    return {
        ArtifactRequestError,
        fetchArtifact: vi.fn(),
        fetchArtifactVersions: vi.fn(),
        fetchArtifactCode: vi.fn(),
    };
});
vi.mock("../../../src/front/Artifacts/ArtifactApi", () => api);
// Every text is the key it comes from, so the test reads the parts by their test ids.
vi.mock("../../../src/i18n/i18n-svelte", () => {
    const deep = (): unknown => new Proxy(() => "", { get: () => deep() });
    return { default: readable(deep()) };
});

import ArtifactCowebsiteComponent from "../../../src/front/Components/Cowebsites/ArtifactCowebsiteComponent.svelte";
import { ArtifactCoWebsite } from "../../../src/front/WebRtc/CoWebsite/ArtifactCoWebsite";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

function opened(number: number, latest = 3, kind = "app") {
    return {
        artifact: {
            id: ID,
            title: "Quests board",
            kind,
            makerName: "Scout",
            version: latest,
            openScope: "chat",
            changeScope: "owner",
            expiresAt: null,
        },
        version: {
            number,
            summary: null,
            askedByName: null,
            sizeBytes: 10,
            createdAt: "2026-10-26T10:00:00Z",
            url: `https://artifacts.test/v${number}.html`,
        },
        you: { owner: true, change: true, manage: true, copy: true },
    };
}

function byTestId(id: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

describe("the artifact window", () => {
    let target: HTMLElement;
    let component: { $destroy(): void } | undefined;

    beforeEach(() => {
        vi.clearAllMocks();
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
    });

    function mountWindow(version?: number, kind: "app" | "markdown" = "app") {
        const website = new ArtifactCoWebsite(
            ID,
            { kind: "nearby", ref: "bubble" },
            { title: "Quests board", kind, makerName: "Scout" },
            version
        );
        component = new ArtifactCowebsiteComponent({ target, props: { actualCowebsite: website, visible: true } });
        return website;
    }

    it("opens the version asked for in a locked frame, with no note when it is the latest", async () => {
        api.fetchArtifact.mockResolvedValue(opened(3));
        const website = mountWindow(3);
        await vi.waitFor(() => expect(byTestId("artifactFrame")).not.toBeNull());

        const frame = byTestId("artifactFrame") as HTMLIFrameElement;
        expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
        expect(frame.getAttribute("src")).toBe("https://artifacts.test/v3.html");
        expect(byTestId("artifactOldNote")).toBeNull();
        expect(api.fetchArtifact).toHaveBeenCalledTimes(1);
        expect(api.fetchArtifact).toHaveBeenCalledWith(ID, { kind: "nearby", ref: "bubble" }, 3);
        let shown: number | undefined;
        website.version.subscribe((value) => (shown = value))();
        expect(shown).toBe(3);
    });

    it("writes the latest version back when it was opened without one", async () => {
        api.fetchArtifact.mockResolvedValue(opened(3));
        const website = mountWindow();
        await vi.waitFor(() => expect(byTestId("artifactFrame")).not.toBeNull());
        let shown: number | undefined;
        website.version.subscribe((value) => (shown = value))();
        expect(shown).toBe(3);
        await tick();
        expect(api.fetchArtifact).toHaveBeenCalledTimes(1);
    });

    it("opens an earlier version once, with the note, and goes back to the latest", async () => {
        api.fetchArtifact.mockImplementation((_id: string, _chat: unknown, version?: number) =>
            Promise.resolve(opened(version ?? 3))
        );
        const website = mountWindow(3);
        await vi.waitFor(() => expect(byTestId("artifactFrame")).not.toBeNull());

        website.version.set(1);
        await vi.waitFor(() => expect(byTestId("artifactOldNote")).not.toBeNull());
        expect(byTestId("artifactFrame")?.getAttribute("src")).toBe("https://artifacts.test/v1.html");
        expect(api.fetchArtifact).toHaveBeenCalledTimes(2);

        byTestId("artifactOldNote")?.querySelector<HTMLButtonElement>("button")?.click();
        await vi.waitFor(() => expect(byTestId("artifactOldNote")).toBeNull());
        expect(byTestId("artifactFrame")?.getAttribute("src")).toBe("https://artifacts.test/v3.html");
        expect(api.fetchArtifact).toHaveBeenCalledTimes(3);
    });

    it("keeps the version on show when another one cannot be opened, and still opens it again", async () => {
        api.fetchArtifact.mockResolvedValueOnce(opened(3));
        const website = mountWindow(3);
        await vi.waitFor(() => expect(byTestId("artifactFrame")).not.toBeNull());

        api.fetchArtifact.mockRejectedValueOnce(new api.ArtifactRequestError(404, "version_not_found"));
        website.version.set(1);
        await vi.waitFor(() => expect(byTestId("artifactSwitchFailed")).not.toBeNull());
        expect(byTestId("artifactFrame")?.getAttribute("src")).toBe("https://artifacts.test/v3.html");
        let shown: number | undefined;
        website.version.subscribe((value) => (shown = value))();
        expect(shown).toBe(3);

        api.fetchArtifact.mockResolvedValueOnce(opened(1));
        website.version.set(1);
        await vi.waitFor(() =>
            expect(byTestId("artifactFrame")?.getAttribute("src")).toBe("https://artifacts.test/v1.html")
        );
        expect(byTestId("artifactSwitchFailed")).toBeNull();
    });

    it("reads a document again when its text could not be read and Try again is tapped", async () => {
        api.fetchArtifact.mockResolvedValue(opened(1, 1, "markdown"));
        api.fetchArtifactCode.mockRejectedValueOnce(new Error("offline"));
        api.fetchArtifactCode.mockResolvedValueOnce({ version: opened(1, 1).version, content: "# Notes" });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        mountWindow(1, "markdown");
        await vi.waitFor(() =>
            expect(document.querySelector('[data-testid="artifactDocument"] button')).not.toBeNull()
        );

        document.querySelector<HTMLButtonElement>('[data-testid="artifactDocument"] button')?.click();
        await vi.waitFor(() => expect(byTestId("artifactDocument")?.textContent).toContain("Notes"));
        expect(api.fetchArtifactCode).toHaveBeenCalledTimes(2);
        warn.mockRestore();
    });

    it("reads the code of the version on show when Code is on", async () => {
        api.fetchArtifact.mockResolvedValue(opened(2, 2));
        api.fetchArtifactCode.mockResolvedValue({ version: opened(2, 2).version, content: "<h1>Hi</h1>\n<p>x</p>" });
        mountWindow(2);
        await vi.waitFor(() => expect(byTestId("artifactCode")).not.toBeNull());

        byTestId("artifactCode")?.click();
        await vi.waitFor(() => expect(byTestId("artifactCodeView")?.textContent).toContain("<h1>Hi</h1>"));
        expect(api.fetchArtifactCode).toHaveBeenCalledTimes(1);
        expect(byTestId("artifactFrame")).toBeNull();
    });

    it("lists the versions when asked and opens the one picked", async () => {
        api.fetchArtifact.mockImplementation((_id: string, _chat: unknown, version?: number) =>
            Promise.resolve(opened(version ?? 2, 2))
        );
        api.fetchArtifactVersions.mockResolvedValue([opened(2, 2).version, opened(1, 2).version]);
        mountWindow(2);
        await vi.waitFor(() => expect(byTestId("artifactVersions")).not.toBeNull());

        byTestId("artifactVersions")?.click();
        await vi.waitFor(() => expect(byTestId("artifactVersionMenu")?.querySelectorAll(".menu-row")).toHaveLength(2));
        byTestId("artifactVersionMenu")?.querySelectorAll<HTMLButtonElement>(".menu-row")[1].click();

        await vi.waitFor(() =>
            expect(byTestId("artifactFrame")?.getAttribute("src")).toBe("https://artifacts.test/v1.html")
        );
        expect(byTestId("artifactVersionMenu")).toBeNull();
    });

    it("says it is gone for a missing artifact, and offers another try only when the server cannot be reached", async () => {
        api.fetchArtifact.mockRejectedValue(new api.ArtifactRequestError(404, "not_found"));
        mountWindow(1);
        await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
        expect(document.querySelector('[role="alert"] button')).toBeNull();
        component?.$destroy();

        api.fetchArtifact.mockRejectedValueOnce(new api.ArtifactRequestError(0, "offline"));
        api.fetchArtifact.mockResolvedValueOnce(opened(1, 1));
        mountWindow(1);
        await vi.waitFor(() => expect(document.querySelector('[role="alert"] button')).not.toBeNull());
        document.querySelector<HTMLButtonElement>('[role="alert"] button')?.click();
        await vi.waitFor(() => expect(byTestId("artifactFrame")).not.toBeNull());
        expect(api.fetchArtifact).toHaveBeenCalledTimes(3);
    });
});
