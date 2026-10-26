import { describe, expect, it } from "vitest";
import { SocketsByIdentifier } from "../../src/pusher/services/SocketsByIdentifier";

describe("SocketsByIdentifier", () => {
    it("finds every open socket of a person by the identifier in their token", () => {
        const index = new SocketsByIdentifier<string>();
        index.add("sara@example.com", "tab-1");
        index.add("sara@example.com", "tab-2");
        index.add("omar@example.com", "tab-3");
        expect(index.of("sara@example.com")).toEqual(["tab-1", "tab-2"]);
        expect(index.of("nobody")).toEqual([]);
    });

    it("forgets a socket when it goes, and the person when the last one is gone", () => {
        const index = new SocketsByIdentifier<string>();
        index.add("sara@example.com", "tab-1");
        index.add("sara@example.com", "tab-2");
        index.remove("sara@example.com", "tab-1");
        expect(index.of("sara@example.com")).toEqual(["tab-2"]);
        index.remove("sara@example.com", "tab-2");
        expect(index.of("sara@example.com")).toEqual([]);
    });

    it("ignores a socket with no identifier", () => {
        const index = new SocketsByIdentifier<string>();
        index.add(undefined, "tab-1");
        index.add("", "tab-2");
        index.remove(undefined, "tab-1");
        expect(index.of("")).toEqual([]);
    });
});
