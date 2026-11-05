import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import type * as SvelteRuntime from "svelte";
import { readable } from "svelte/store";
import type { FriendSearchResult } from "@workadventure/messages";

vi.mock("svelte", async (importOriginal) => {
    const svelte = await importOriginal<typeof SvelteRuntime>();
    // eslint-disable-next-line svelte/no-svelte-internal
    const { onMount } = await import("svelte/internal");
    return { ...svelte, onMount };
});

const mocks = vi.hoisted(() => ({
    search: vi.fn(),
    requestChatPerson: vi.fn(),
    storedWokaStore: vi.fn(),
}));
vi.mock("../../../src/front/Chat/Stores/FriendsStore", () => ({
    friendsStore: { search: mocks.search },
    relationshipsStore: readable(new Map()),
}));
vi.mock("../../../src/front/Chat/Stores/ChatPeopleLookup", () => ({ requestChatPerson: mocks.requestChatPerson }));
vi.mock("../../../src/front/Chat/Stores/StoredWokaStore", () => ({ storedWokaStore: mocks.storedWokaStore }));
vi.mock("../../../src/front/Chat/Components/UserList/FriendActions", () => ({ runFriendAction: vi.fn() }));
vi.mock("../../../src/front/Chat/Components/UserList/FriendAvatar.svelte", async () => ({
    default: (await import("./stubs/PictureProbe.svelte")).default,
}));
vi.mock("../../../src/i18n/i18n-svelte", () => {
    const deep = (): unknown => new Proxy(() => "", { get: () => deep() });
    return { LL: readable(deep()) };
});

import UniverseSearch from "../../../src/front/Chat/Components/UserList/UniverseSearch.svelte";

const layers = [
    { id: "body", url: "https://assets.test/body.png" },
    { id: "hat", url: "https://assets.test/hat.png" },
];
const result = (overrides: Partial<FriendSearchResult>): FriendSearchResult => ({
    uuid: "uuid",
    name: "Someone",
    universes: [],
    relationship: "none",
    chatId: "",
    characterTextures: [],
    ...overrides,
});

describe("searching all of Universe", () => {
    let target: HTMLElement;
    let component: { $destroy(): void } | undefined;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.storedWokaStore.mockImplementation((textures: { id: string }[]) =>
            textures.length ? readable(`woka:${textures.map((t) => t.id).join("+")}`) : undefined
        );
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
    });

    async function search(
        results: FriendSearchResult[],
        props: Record<string, unknown> = {}
    ): Promise<Record<string, string>> {
        mocks.search.mockResolvedValue(results);
        component = new UniverseSearch({ target, props: { query: "so", ...props } });
        target.querySelector<HTMLButtonElement>('[data-testid="searchUniverse"]')?.click();
        await tick();
        await tick();
        return Object.fromEntries(
            [...target.querySelectorAll('[data-testid^="universe-result-"]')].map((row) => [
                row.getAttribute("data-testid")?.replace("universe-result-", "") ?? "",
                row.querySelector('[data-testid="avatar"]')?.textContent ?? "",
            ])
        );
    }

    it("draws a stranger's real Woka from the layers that came with the result, without a chat ID to ask about", async () => {
        const pictures = await search([result({ uuid: "bilal", name: "Bilal", characterTextures: layers })]);
        expect(pictures).toEqual({ Bilal: "woka:body+hat" });
        expect(mocks.requestChatPerson).not.toHaveBeenCalled();
    });

    it("leaves the default Woka for someone with none to show", async () => {
        expect(await search([result({ name: "Plain" })])).toEqual({ Plain: "default" });
    });

    it("keeps what the world draws for someone in it, and still asks Orbit about a friend that came without layers", async () => {
        const inWorld = readable("woka:world");
        const pictures = await search(
            [
                result({ uuid: "here", name: "Here", characterTextures: layers }),
                result({ uuid: "friend", name: "Friend", relationship: "friends", chatId: "@friend:chat" }),
            ],
            {
                lookOf: (person: { uuid: string }) => (person.uuid === "here" ? { picture: inWorld } : {}),
                inWorld: (uuid: string) => uuid === "here",
            }
        );
        expect(pictures).toEqual({ Here: "woka:world", Friend: "default" });
        expect(mocks.requestChatPerson).toHaveBeenCalledTimes(1);
        expect(mocks.requestChatPerson).toHaveBeenCalledWith("@friend:chat");
    });
});
