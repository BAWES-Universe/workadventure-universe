import { get } from "svelte/store";
import { describe, expect, it } from "vitest";
import type { RoomConnection } from "../../Connection/RoomConnection";
import { AdminUserProvider } from "./AdminUserProvider";

function member(name: string) {
    return { chatId: `@${name}:server`, wokaName: name, tags: [] as string[] };
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
});
