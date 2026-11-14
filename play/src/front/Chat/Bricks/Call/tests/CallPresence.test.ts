import { writable } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import { shareOnACall } from "../CallPresence";

describe("telling the world a person is on a call (game #2004)", () => {
    it("says nothing while there is no call, then says it once when the call starts and once when it ends", () => {
        const onACall = writable(false);
        const space = { emitUpdateUser: vi.fn() };
        const stop = shareOnACall(space, onACall);
        expect(space.emitUpdateUser).not.toHaveBeenCalled();

        onACall.set(true);
        onACall.set(true);
        expect(space.emitUpdateUser).toHaveBeenCalledTimes(1);
        expect(space.emitUpdateUser).toHaveBeenLastCalledWith({ onACall: true });

        onACall.set(false);
        expect(space.emitUpdateUser).toHaveBeenCalledTimes(2);
        expect(space.emitUpdateUser).toHaveBeenLastCalledWith({ onACall: false });
        stop();
    });

    it("says it again to a new world space when a call is still on after a reconnect", () => {
        const onACall = writable(true);
        const first = { emitUpdateUser: vi.fn() };
        shareOnACall(first, onACall)();
        const second = { emitUpdateUser: vi.fn() };
        const stop = shareOnACall(second, onACall);
        expect(second.emitUpdateUser).toHaveBeenCalledWith({ onACall: true });
        stop();
    });

    it("sends only the call label, never a status", () => {
        const onACall = writable(true);
        const space = { emitUpdateUser: vi.fn() };
        shareOnACall(space, onACall)();
        expect(Object.keys(space.emitUpdateUser.mock.calls[0][0])).toEqual(["onACall"]);
    });
});
