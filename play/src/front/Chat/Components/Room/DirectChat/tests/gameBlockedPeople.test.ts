import { afterEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { blackListManager } from "../../../../../WebRtc/BlackListManager";
import { gameBlockedPeople } from "../gameBlockedPeople";

describe("the people blocked in the game", () => {
    afterEach(() => {
        for (const uuid of [...blackListManager.getBlackListedUsers()]) blackListManager.cancelBlackList(uuid);
    });

    it("lists who is blocked when it is first read", () => {
        blackListManager.blackList("uuid-ada");

        expect(get(gameBlockedPeople).has("uuid-ada")).toBe(true);
    });

    it("follows a block and an unblock made while it is watched, without being read again from scratch", () => {
        const seen: boolean[] = [];
        const stop = gameBlockedPeople.subscribe((people) => seen.push(people.has("uuid-ada")));

        blackListManager.blackList("uuid-ada");
        blackListManager.cancelBlackList("uuid-ada");
        stop();
        blackListManager.blackList("uuid-ada");

        expect(seen).toEqual([false, true, false]);
    });
});
