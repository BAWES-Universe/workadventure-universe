import { get, writable } from "svelte/store";
import { describe, expect, it } from "vitest";
import type { ChatConnectionInterface, ChatUser } from "../../Connection/ChatConnection";
import { ChatUserProvider } from "../ChatUserProvider";

const person = (chatId: string, username: string, isBot?: boolean) =>
    ({ chatId, username, isBot } as unknown as ChatUser);

function provider() {
    const directRoomsUsers = writable([
        person("@sara:chat.test", "Sara"),
        person("@bob:chat.test", "Bottle Bob"),
        // A bot met only in direct messages: nothing but its chat address says it is one
        person("@bot_0b7c1d2e-1111-4222-8333-944455556666:chat.test", "Brick"),
        person("@bot_1c8d2e3f-2222-4333-8444-a55566667777:chat.test", "Melody"),
        person("@helper:chat.test", "Helper", true),
    ]);
    return new ChatUserProvider({ directRoomsUsers } as unknown as ChatConnectionInterface);
}
const names = (users: ChatUserProvider) => get(users.users).map((user) => user.username);

describe("the people of your direct chats, searched", () => {
    it("are found by name, as before", async () => {
        const users = provider();
        expect(names(users)).toHaveLength(5);
        await users.setFilter("sar");
        expect(names(users)).toEqual(["Sara"]);
        await users.setFilter("bo");
        expect(names(users)).toEqual(["Bottle Bob"]);
    });

    it('include every bot, whatever it is named, when "Bot" or "Brick" is typed whole (#1995)', async () => {
        const users = provider();
        await users.setFilter("Bot");
        expect(names(users)).toEqual(["Bottle Bob", "Brick", "Melody", "Helper"]);
        await users.setFilter("bricks");
        expect(names(users)).toEqual(["Brick", "Melody", "Helper"]);
    });

    it("list no bot extra while part of the word is typed", async () => {
        const users = provider();
        await users.setFilter("bri");
        expect(names(users)).toEqual(["Brick"]);
    });
});
