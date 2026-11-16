import { Subject } from "rxjs";
import { writable } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import { shareOnACall } from "../CallPresence";

function fakeSpace() {
    return { emitUpdateUser: vi.fn(), reconnected: new Subject<void>() };
}

describe("telling the world a person is on a call (game #2004)", () => {
    it("says nothing while there is no call, then says it once when the call starts and once when it ends", () => {
        const onACall = writable(false);
        const space = fakeSpace();
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
        const first = fakeSpace();
        shareOnACall(first, onACall)();
        const second = fakeSpace();
        const stop = shareOnACall(second, onACall);
        expect(second.emitUpdateUser).toHaveBeenCalledWith({ onACall: true });
        stop();
    });

    it("says it again when the space is joined again during a call, and says nothing when there is no call", () => {
        const onACall = writable(true);
        const space = fakeSpace();
        const stop = shareOnACall(space, onACall);
        expect(space.emitUpdateUser).toHaveBeenCalledTimes(1);

        space.reconnected.next();
        expect(space.emitUpdateUser).toHaveBeenCalledTimes(2);
        expect(space.emitUpdateUser).toHaveBeenLastCalledWith({ onACall: true });

        // The call ends: told once. A reconnect after that has nothing to say.
        onACall.set(false);
        expect(space.emitUpdateUser).toHaveBeenCalledTimes(3);
        space.reconnected.next();
        expect(space.emitUpdateUser).toHaveBeenCalledTimes(3);

        // A later call is still told once.
        onACall.set(true);
        expect(space.emitUpdateUser).toHaveBeenCalledTimes(4);
        stop();
        space.reconnected.next();
        expect(space.emitUpdateUser).toHaveBeenCalledTimes(4);
    });

    it("sends only the call label, never a status", () => {
        const onACall = writable(true);
        const space = fakeSpace();
        shareOnACall(space, onACall)();
        expect(Object.keys(space.emitUpdateUser.mock.calls[0][0])).toEqual(["onACall"]);
    });
});
