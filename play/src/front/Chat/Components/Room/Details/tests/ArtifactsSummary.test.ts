import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { get, readable } from "svelte/store";

const mocks = vi.hoisted(() => ({ fetchChatArtifacts: vi.fn() }));

// The tests run Svelte's server build, where onMount does nothing; the group reads its list on mount.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../ArtifactRow.svelte", async () => await import("./ArtifactRowStub.svelte"));
vi.mock("../../../../../Artifacts/ArtifactApi", () => ({ fetchChatArtifacts: mocks.fetchChatArtifacts }));
// Every text is the path it was asked by, with the bot's name when it is given one.
vi.mock("../../../../../../i18n/i18n-svelte", () => {
    const text = (path: string[]): unknown =>
        new Proxy(() => path.join("."), {
            get: (_target, key) => text([...path, String(key)]),
            apply: (_target, _this, args: { name?: string }[]) =>
                args[0]?.name ? `${path.join(".")}:${args[0].name}` : path.join("."),
        });
    return { default: readable(text([])), LL: readable(text([])) };
});

import type { ChatRoom } from "../../../../Connection/ChatConnection";
import { openArtifactsListStore } from "../../../../Stores/ChatDetailsStore";
import { ARTIFACT_CHAT_CONTEXT } from "../../../../../Artifacts/artifactChatContext";
import ArtifactsSummary from "../ArtifactsSummary.svelte";

const artifact = (id: string) => ({
    id,
    title: id,
    kind: "app",
    makerName: "Scout",
    owner: null,
    version: 1,
    yours: true,
    updatedAt: "2026-10-29T08:00:00.000Z",
});

let ref = 0;

describe("a chat's Artifacts group", () => {
    let component: ArtifactsSummary | undefined;
    let target: HTMLElement;
    const room = { id: "!room:chat.example" } as unknown as ChatRoom;

    async function show(props: { botName?: string }, chat: unknown = { kind: "dm", ref: `!room-${++ref}` }) {
        component = new ArtifactsSummary({
            target,
            props: { room, ...props },
            context: new Map([[ARTIFACT_CHAT_CONTEXT, () => chat]]),
        });
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });
        await tick();
    }
    const find = (id: string) => target.querySelector<HTMLElement>(`[data-testid="${id}"]`);

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
        mocks.fetchChatArtifacts.mockReset();
        openArtifactsListStore.set(undefined);
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
    });

    it("counts them all, shows the latest three and opens the page with every one", async () => {
        mocks.fetchChatArtifacts.mockResolvedValue({
            artifacts: ["a", "b", "c", "d"].map(artifact),
            total: 7,
            next: null,
        });
        await show({});
        expect(find("artifactsSummaryCount")?.textContent).toBe("7");
        expect(target.querySelectorAll('[data-testid="chatArtifact"]')).toHaveLength(3);
        find("artifactsSummaryOpen")?.click();
        expect(get(openArtifactsListStore)).toBe(room.id);
    });

    it("tells how to get one in a bot's chat that has none yet", async () => {
        mocks.fetchChatArtifacts.mockResolvedValue({ artifacts: [], total: 0, next: null });
        await show({ botName: "Scout" });
        expect(find("artifactsBotHint")?.textContent?.trim()).toBe("chat.details.artifactsBotHint:Scout");
        expect(find("artifactsSummaryOpen")?.hasAttribute("disabled")).toBe(true);
    });

    it("stays out of a chat between people with none, of one it could not read, and of a chat with no artifacts", async () => {
        mocks.fetchChatArtifacts.mockResolvedValue({ artifacts: [], total: 0, next: null });
        await show({});
        expect(find("artifactsSummary")).toBeNull();
        component?.$destroy();

        vi.spyOn(console, "error").mockImplementation(() => undefined);
        mocks.fetchChatArtifacts.mockRejectedValue(new Error("offline"));
        await show({ botName: "Scout" });
        expect(find("artifactsSummary")).toBeNull();
        component?.$destroy();

        mocks.fetchChatArtifacts.mockClear();
        await show({ botName: "Scout" }, null);
        expect(find("artifactsSummary")).toBeNull();
        expect(mocks.fetchChatArtifacts).not.toHaveBeenCalled();
    });
});
