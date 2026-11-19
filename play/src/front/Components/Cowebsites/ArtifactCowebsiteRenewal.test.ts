import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { writable } from "svelte/store";

vi.hoisted(() => {
    (window as unknown as { env: Record<string, unknown> }).env = {};
});

const api = vi.hoisted(() => ({
    fetchArtifact: vi.fn(),
}));
vi.mock("../../Artifacts/ArtifactApi", () => {
    class ArtifactRequestError extends Error {
        constructor(public readonly status: number, public readonly code: string) {
            super(code);
        }
    }
    return {
        ArtifactRequestError,
        artifactLink: (id: string) => `https://play.test/a/${id}`,
        fetchArtifact: api.fetchArtifact,
        fetchArtifactCode: vi.fn(),
        fetchArtifactVersions: vi.fn(() => Promise.resolve([])),
        restoreArtifactVersion: vi.fn(),
        shareArtifact: vi.fn(),
        payOnArtifact: vi.fn(),
    };
});
vi.mock("../EmbedScreens/OpenHereRow.svelte", async () => ({
    default: (await import("./ArtifactTestStub.svelte")).default,
}));
vi.mock("../EmbedScreens/OpenHereItemIcon.svelte", async () => ({
    default: (await import("./ArtifactTestStub.svelte")).default,
}));
vi.mock("./FileViewer/CodeView.svelte", async () => ({ default: (await import("./ArtifactTestStub.svelte")).default }));

import { loadLocale } from "../../../i18n/i18n-util.sync";
import { setLocale } from "../../../i18n/i18n-svelte";
import { ArtifactRequestError } from "../../Artifacts/ArtifactApi";
import ArtifactCowebsiteComponent from "./ArtifactCowebsiteComponent.svelte";

const opened = (number: number, url: string) => ({
    artifact: {
        id: "a1",
        title: "Menu",
        kind: "html",
        makerName: "Omar",
        version: number,
        openScope: "everyone",
        changeScope: "owner",
        chatKind: null,
        expiresAt: null,
    },
    version: {
        number,
        summary: null,
        askedByName: null,
        sizeBytes: 10,
        createdAt: "2026-11-11T10:00:00.000Z",
        url,
        urlLifeMs: 300_000,
        urlHasMedia: true,
    },
    you: { owner: false, change: false, manage: false, copy: false },
});

const settle = async () => {
    await vi.advanceTimersByTimeAsync(0);
    await tick();
};

describe("an artifact window's renewals of the address on show", () => {
    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = "";
        vi.clearAllMocks();
    });

    it("never uses a renewal of version 1 that was asked before 2 was opened and 1 was opened again", async () => {
        vi.useFakeTimers();
        const version = writable<number | undefined>(undefined);
        const cowebsite = {
            artifactId: "a1",
            chat: undefined,
            version,
            summary: writable({ title: "Menu", kind: "html", makerName: "Omar" }),
        };
        // The renewal of version 1, still on its way: answered "kept private" later
        let answerRenewal: (error: Error) => void = () => {};
        let asked = 0;
        api.fetchArtifact.mockImplementation((_id: string, _chat: unknown, wanted: number | undefined) => {
            asked++;
            if (asked === 1) return Promise.resolve(opened(1, "https://files.test/1-first"));
            if (asked === 2)
                return new Promise((_, reject) => {
                    answerRenewal = reject;
                });
            if (wanted === 2) return Promise.resolve(opened(2, "https://files.test/2"));
            return Promise.resolve(opened(1, "https://files.test/1-again"));
        });

        const target = document.createElement("div");
        document.body.appendChild(target);
        const view = new ArtifactCowebsiteComponent({
            target,
            props: { actualCowebsite: cowebsite as never, visible: true },
        });
        await settle();
        expect(target.querySelector("iframe")?.getAttribute("src")).toBe("https://files.test/1-first");

        // The address is about to stop: version 1 is opened again, quietly, and the answer is slow
        await vi.advanceTimersByTimeAsync(275_000);
        expect(asked).toBe(2);

        version.set(2);
        await settle();
        version.set(1);
        await settle();
        expect(target.querySelector("iframe")?.getAttribute("src")).toBe("https://files.test/1-again");

        // The old renewal ends: its "kept private" is about what was on show before, and puts nothing away
        answerRenewal(new ArtifactRequestError(404, "kept_private"));
        await settle();
        expect(target.querySelector("iframe")?.getAttribute("src")).toBe("https://files.test/1-again");
        view.$destroy();
    });
});
