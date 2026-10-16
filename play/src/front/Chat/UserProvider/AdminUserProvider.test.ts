import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import type { RoomConnection } from "../../Connection/RoomConnection";
import { AdminUserProvider, MEMBERS_REFRESH_AFTER_MS } from "./AdminUserProvider";

function member(name: string, characterTextures: { id: string; url: string }[] = []) {
    return { chatId: `@${name}:server`, wokaName: name, tags: [] as string[], characterTextures };
}

describe("AdminUserProvider", () => {
    it("shows the latest search's members even when an older search answers last", async () => {
        const pending = new Map<string, (members: ReturnType<typeof member>[]) => void>();
        const connection = {
            queryChatMembers: (text: string) =>
                new Promise<{ members: ReturnType<typeof member>[] }>((resolve) => {
                    pending.set(text, (members) => resolve({ members }));
                }),
        } as unknown as RoomConnection;
        const provider = new AdminUserProvider(connection);
        const unsubscribe = provider.users.subscribe(() => undefined);
        pending.get("")?.([member("Everyone")]);

        const older = provider.setFilter("S");
        const newer = provider.setFilter("Sara");
        pending.get("Sara")?.([member("Sara")]);
        await newer;
        pending.get("S")?.([member("Sam"), member("Sara")]);
        // The older search still settles, so nothing waiting on it hangs.
        await older;

        expect(get(provider.users).map((user) => user.username)).toEqual(["Sara"]);
        unsubscribe();
    });

    it("carries the name the back office has for each member as the name they go by in Universe", async () => {
        const connection = {
            queryChatMembers: () =>
                Promise.resolve({ members: [member("Ada"), { ...member("Nameless"), wokaName: undefined }] }),
        } as unknown as RoomConnection;
        const provider = new AdminUserProvider(connection);
        const unsubscribe = provider.users.subscribe(() => undefined);
        await provider.setFilter("");

        const [ada, nameless] = get(provider.users);
        expect(ada.gameName).toBe("Ada");
        expect(nameless.gameName).toBeUndefined();
        unsubscribe();
    });

    it("gives members who have a saved Woka a picture to show while they're away, and others none", async () => {
        const answer = [member("Ada", [{ id: "male1", url: "resources/male1.png" }]), member("Bob")];
        const connection = {
            queryChatMembers: () => Promise.resolve({ members: answer }),
        } as unknown as RoomConnection;
        const provider = new AdminUserProvider(connection);
        const unsubscribe = provider.users.subscribe(() => undefined);
        await provider.setFilter("");

        const [ada, bob] = get(provider.users);
        expect(ada.storedWoka).toBeDefined();
        expect(bob.storedWoka).toBeUndefined();
        unsubscribe();
    });

    it("copes with an answer that has no Woka field (an older server)", async () => {
        const old = { chatId: "@old:server", wokaName: "Old", tags: [] as string[] };
        const connection = {
            queryChatMembers: () => Promise.resolve({ members: [old] }),
        } as unknown as RoomConnection;
        const provider = new AdminUserProvider(connection);
        const unsubscribe = provider.users.subscribe(() => undefined);
        await provider.setFilter("");

        expect(get(provider.users)[0].storedWoka).toBeUndefined();
        unsubscribe();
    });

    it("keeps each member's account id, so an away member can be invited, befriended or reported", async () => {
        const answer = [
            { ...member("Ada"), uuid: "uuid-ada" },
            { ...member("Bob"), uuid: "" },
        ];
        const connection = {
            queryChatMembers: () => Promise.resolve({ members: answer }),
        } as unknown as RoomConnection;
        const provider = new AdminUserProvider(connection);
        const unsubscribe = provider.users.subscribe(() => undefined);
        await provider.setFilter("");

        expect(get(provider.users).map((user) => user.uuid)).toEqual(["uuid-ada", undefined]);
        unsubscribe();
    });

    describe("reading the members again for a chat that shows them", () => {
        /** A provider whose member list answers from `members`, with a clock the test moves. */
        function providerWithClock(members: { current: ReturnType<typeof member>[] }) {
            const clock = { now: 1_000 };
            const queryChatMembers = vi.fn((text: string) => Promise.resolve({ members: members.current, text }));
            const provider = new AdminUserProvider({ queryChatMembers } as unknown as RoomConnection, () => clock.now);
            const unsubscribe = provider.users.subscribe(() => undefined);
            return { provider, clock, queryChatMembers, unsubscribe };
        }

        it("shows the new Woka and name of an away member once the list is two minutes old", async () => {
            const members = { current: [member("Ada", [{ id: "male1", url: "resources/male1.png" }])] };
            const { provider, clock, queryChatMembers, unsubscribe } = providerWithClock(members);
            await vi.waitFor(() => expect(get(provider.users)).toHaveLength(1));
            expect(get(provider.users)[0].username).toBe("Ada");

            // Ada changes her Woka and name in Orbit.
            members.current = [member("Ada Lovelace", [{ id: "female2", url: "resources/female2.png" }])];
            clock.now += MEMBERS_REFRESH_AFTER_MS;
            await provider.refreshIfStale();

            expect(queryChatMembers).toHaveBeenCalledTimes(2);
            expect(get(provider.users)[0].username).toBe("Ada Lovelace");
            expect(get(provider.users)[0].gameName).toBe("Ada Lovelace");
            unsubscribe();
        });

        it("reads at most once in two minutes, however often chats ask", async () => {
            const { provider, clock, queryChatMembers, unsubscribe } = providerWithClock({
                current: [member("Ada")],
            });
            await vi.waitFor(() => expect(queryChatMembers).toHaveBeenCalledTimes(1));

            clock.now += MEMBERS_REFRESH_AFTER_MS - 1;
            await provider.refreshIfStale();
            await provider.refreshIfStale();
            expect(queryChatMembers).toHaveBeenCalledTimes(1);

            clock.now += 1;
            await Promise.all([provider.refreshIfStale(), provider.refreshIfStale(), provider.refreshIfStale()]);
            expect(queryChatMembers).toHaveBeenCalledTimes(2);

            await provider.refreshIfStale();
            expect(queryChatMembers).toHaveBeenCalledTimes(2);
            unsubscribe();
        });

        it("keeps the search the player typed, and counts a search as a read", async () => {
            const { provider, clock, queryChatMembers, unsubscribe } = providerWithClock({
                current: [member("Sara")],
            });
            await provider.setFilter("Sara");
            clock.now += MEMBERS_REFRESH_AFTER_MS - 1;
            await provider.refreshIfStale();
            expect(queryChatMembers).toHaveBeenCalledTimes(2);

            clock.now += MEMBERS_REFRESH_AFTER_MS;
            await provider.refreshIfStale();
            expect(queryChatMembers).toHaveBeenLastCalledWith("Sara");
            unsubscribe();
        });

        it("does not let an old refresh overwrite a search typed since", async () => {
            const answers = new Map<string, (members: ReturnType<typeof member>[]) => void>();
            const clock = { now: 1_000 };
            const connection = {
                queryChatMembers: (text: string) =>
                    new Promise<{ members: ReturnType<typeof member>[] }>((resolve) => {
                        answers.set(text, (members) => resolve({ members }));
                    }),
            } as unknown as RoomConnection;
            const provider = new AdminUserProvider(connection, () => clock.now);
            const unsubscribe = provider.users.subscribe(() => undefined);
            answers.get("")?.([member("Everyone")]);
            await vi.waitFor(() => expect(get(provider.users)).toHaveLength(1));

            clock.now += MEMBERS_REFRESH_AFTER_MS;
            const refresh = provider.refreshIfStale();
            const search = provider.setFilter("Sara");
            answers.get("Sara")?.([member("Sara")]);
            await search;
            answers.get("")?.([member("Everyone"), member("Sam")]);
            await refresh;

            expect(get(provider.users).map((user) => user.username)).toEqual(["Sara"]);
            unsubscribe();
        });

        it("tries again the next time when the read fails, and does nothing without a list on show", async () => {
            const members = { current: [member("Ada")] };
            const { provider, clock, queryChatMembers, unsubscribe } = providerWithClock(members);
            await vi.waitFor(() => expect(queryChatMembers).toHaveBeenCalledTimes(1));
            vi.spyOn(console, "warn").mockImplementation(() => {});

            queryChatMembers.mockRejectedValueOnce(new Error("offline"));
            clock.now += MEMBERS_REFRESH_AFTER_MS;
            await expect(provider.refreshIfStale()).resolves.toBeUndefined();
            expect(get(provider.users)[0].username).toBe("Ada");

            clock.now += MEMBERS_REFRESH_AFTER_MS;
            await provider.refreshIfStale();
            expect(queryChatMembers).toHaveBeenCalledTimes(3);
            unsubscribe();

            const idle = new AdminUserProvider({ queryChatMembers: vi.fn() } as unknown as RoomConnection);
            await idle.refreshIfStale();
        });
    });
});
