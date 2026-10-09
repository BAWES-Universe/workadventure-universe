import { get } from "svelte/store";
import { describe, expect, it } from "vitest";
import type { RoomConnection } from "../../Connection/RoomConnection";
import { AdminUserProvider } from "./AdminUserProvider";

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
});
