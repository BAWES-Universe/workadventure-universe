import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";

vi.mock("../Enum/ComputedConst", () => ({ ABSOLUTE_PUSHER_URL: "https://pusher.test/" }));
vi.mock("../Enum/EnvironmentVariable", () => ({ ADMIN_URL: undefined }));
vi.mock("../Connection/LocalUserStore", () => ({ localUserStore: { getAuthToken: () => "token" } }));

import type { ArtifactChat, ChatArtifact, ChatArtifactPage } from "./ArtifactApi";
import { ChatArtifactsList, chatArtifactsList } from "./chatArtifactsList";

const chat: ArtifactChat = { kind: "dm", ref: "!room:chat.example" };
const artifact = (id: string): ChatArtifact => ({
    id,
    title: `Artifact ${id}`,
    kind: "app",
    makerName: "Scout",
    owner: { name: "Alice" },
    version: 1,
    yours: true,
    updatedAt: "2026-10-29T08:00:00.000Z",
});
const page = (ids: string[], total: number, next: number | null): ChatArtifactPage => ({
    artifacts: ids.map(artifact),
    total,
    next,
});

describe("a chat's artifacts", () => {
    it("reads the newest first, then the next pages, showing one that moved between pages once", async () => {
        const fetchPage = vi
            .fn()
            .mockResolvedValueOnce(page(["a", "b"], 4, 2))
            .mockResolvedValueOnce(page(["b", "c", "d"], 4, null));
        const list = new ChatArtifactsList(chat, fetchPage);
        await list.refresh();
        expect(get(list)).toMatchObject({ total: 4, next: 2, loaded: true, loading: false });
        await list.loadMore();
        expect(fetchPage).toHaveBeenLastCalledWith(chat, 2);
        expect(get(list).artifacts.map((one) => one.id)).toEqual(["a", "b", "c", "d"]);
        // At the end: nothing more to read
        await list.loadMore();
        expect(fetchPage).toHaveBeenCalledTimes(2);
    });

    it("keeps what it had when a read fails, and says so", async () => {
        const fetchPage = vi
            .fn()
            .mockResolvedValueOnce(page(["a"], 2, 1))
            .mockRejectedValueOnce(new Error("offline"));
        const list = new ChatArtifactsList(chat, fetchPage);
        await list.refresh();
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        await list.loadMore();
        expect(get(list)).toMatchObject({ failed: true, loading: false, next: 1 });
        expect(get(list).artifacts).toHaveLength(1);
    });

    it("drops an answer that a newer read overtook", async () => {
        let answerFirst: (page: ChatArtifactPage) => void = () => undefined;
        const fetchPage = vi
            .fn()
            .mockReturnValueOnce(
                new Promise<ChatArtifactPage>((resolve) => {
                    answerFirst = resolve;
                })
            )
            .mockResolvedValueOnce(page(["new"], 1, null));
        const list = new ChatArtifactsList(chat, fetchPage);
        const first = list.refresh();
        await list.refresh();
        answerFirst(page(["old"], 1, null));
        await first;
        expect(get(list).artifacts.map((one) => one.id)).toEqual(["new"]);
    });

    it("is the same list for a chat's group and its page", () => {
        expect(chatArtifactsList(chat)).toBe(chatArtifactsList({ ...chat }));
        expect(chatArtifactsList(chat)).not.toBe(chatArtifactsList({ kind: "nearby", ref: chat.ref }));
    });
});
