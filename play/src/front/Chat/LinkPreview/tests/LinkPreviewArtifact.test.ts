import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

vi.mock("../../../Connection/ConnectionManager", () => ({
    connectionManager: { applications: [], youtubeToolActivated: true },
}));
vi.mock("../../../Stores/CoWebsiteStore", async () => {
    const { writable } = await import("svelte/store");
    return { coWebsites: writable([]), openedByPersonCoWebsite: <T>(coWebsite: T) => coWebsite };
});
vi.mock("../../ChatSheetStore", () => ({ lowerChatSheet: vi.fn() }));
vi.mock("../../../WebRtc/CoWebsite/SimpleCoWebsite", () => ({ SimpleCoWebsite: class {} }));
vi.mock("../../../WebRtc/CoWebsite/ArtifactCoWebsite", () => ({ ArtifactCoWebsite: class {} }));
vi.mock("../../../Artifacts/openArtifact", () => ({ openArtifactFromCard: vi.fn() }));
vi.mock("../../../Enum/EnvironmentVariable", () => ({ ADMIN_URL: "https://orbit.example" }));
vi.mock("../../../Enum/ComputedConst", () => ({ ABSOLUTE_PUSHER_URL: "https://pusher.test/" }));
vi.mock("../../../Connection/LocalUserStore", () => ({ localUserStore: { getAuthToken: () => "token" } }));
vi.mock("../LinkPreviewFetcher", async () => {
    const { writable } = await import("svelte/store");
    return {
        fetchWebPreview: vi.fn(() =>
            Promise.resolve({ title: "Universe", description: "This link is not available." })
        ),
        fetchYoutubePreview: vi.fn(() => new Promise<never>(() => {})),
        playingChatVideoStore: writable(undefined),
    };
});
vi.mock("../../../Stores/UserInputStore", async () => {
    const { writable } = await import("svelte/store");
    return { lightboxOpenStore: writable(false) };
});
vi.mock("../../Components/Room/MessageActions/availableActions", () => ({ saveMessageFiles: vi.fn() }));
vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const text = (value: string) => () => value;
    return {
        default: readable({
            chat: {
                linkPreview: {
                    openHere: text("Open here"),
                    newTab: text("New tab"),
                    play: text("Play"),
                    openOn: text("Open on"),
                },
                messageActions: { save: text("Save") },
                artifacts: {
                    kindPage: text("Page"),
                    badgePage: text("PAGE"),
                    cardLine: ({ kind, version }: { kind: string; version: number }) =>
                        `${kind} · Version ${version} · Tap to open`,
                    linkCardLine: ({ kind, maker }: { kind: string; maker: string }) =>
                        `${kind} · By ${maker} · Tap to open`,
                    linkCardLineOpen: ({ kind, maker }: { kind: string; maker: string }) =>
                        `${kind} · By ${maker} · Open`,
                    cardAria: ({ title }: { title: string }) => `Open ${title}`,
                },
            },
        }),
    };
});

import { openArtifactFromCard } from "../../../Artifacts/openArtifact";
import { forgetLinkedArtifacts } from "../../../Artifacts/artifactLinkCard";
import { fetchWebPreview } from "../LinkPreviewFetcher";
import LinkPreview from "../LinkPreview.svelte";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const LINK = `https://orbit.example/a/${ID}`;

function answer(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("an artifact's share link pasted in a chat", () => {
    let target: HTMLElement;
    let preview: LinkPreview | undefined;

    beforeEach(() => {
        forgetLinkedArtifacts();
        vi.restoreAllMocks();
        vi.mocked(fetchWebPreview).mockClear();
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(() => {
        preview?.$destroy();
        preview = undefined;
        target.remove();
    });

    async function show(body: string): Promise<void> {
        preview = new LinkPreview({ target, props: { body } });
        // Orbit answers, then the card draws
        await vi.waitFor(() => {
            if (
                vi.mocked(fetchWebPreview).mock.calls.length === 0 &&
                !target.querySelector('[data-testid="artifactCard"]')
            )
                throw new Error("not yet");
        });
        await tick();
    }

    it("shows the artifact's card, which opens the latest version in the game window when tapped", async () => {
        const opened = (version: number) =>
            answer(200, {
                artifact: { id: ID, title: "Dubai trip, day 3", kind: "page", makerName: "Laura", version },
            });
        // A newer version is made between the card showing and the tap
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(opened(4)).mockResolvedValueOnce(opened(5));
        await show(`Here is the page ${LINK}`);
        const card = target.querySelector<HTMLButtonElement>('[data-testid="artifactCard"]');
        expect(card?.textContent).toContain("Dubai trip, day 3");
        expect(card?.textContent).toContain("Page · By Laura · Tap to open");
        expect(card?.textContent).toContain("PAGE");
        expect(target.querySelector('[data-testid="webLinkPreview"]')).toBeNull();
        expect(fetchWebPreview).not.toHaveBeenCalled();

        card?.click();
        await vi.waitFor(() => expect(openArtifactFromCard).toHaveBeenCalled());
        expect(openArtifactFromCard).toHaveBeenCalledWith(
            expect.objectContaining({ id: ID, version: 5, title: "Dubai trip, day 3", maker: "Laura" }),
            undefined,
            undefined
        );
    });

    it("stays a plain link when the person may not open it, showing nothing about the artifact", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(answer(404, { error: "not_found" }));
        await show(`Look at this ${LINK}`);
        expect(target.querySelector('[data-testid="artifactCard"]')).toBeNull();
        expect(fetchWebPreview).toHaveBeenCalledWith(LINK);
        expect(target.querySelector('[data-testid="webLinkPreview"]')?.textContent).toContain(
            "This link is not available."
        );
    });

    it("leaves a look-alike address on another site as an ordinary link", async () => {
        const fetching = vi.spyOn(globalThis, "fetch");
        await show(`https://orbit.example.evil.com/a/${ID}`);
        expect(fetching).not.toHaveBeenCalled();
        expect(target.querySelector('[data-testid="artifactCard"]')).toBeNull();
        expect(fetchWebPreview).toHaveBeenCalled();
    });
});
