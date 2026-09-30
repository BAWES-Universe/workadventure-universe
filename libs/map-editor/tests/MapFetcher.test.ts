import { describe, expect, it, vi } from "vitest";
import { mapFetcher } from "../src/MapFetcher";

// Answer DNS lookups from a fixed table, so the tests don't depend on the public nip.io / sslip.io services
// (a slow answer from them used to time the tests out).
const dnsTable: Record<string, string[]> = {
    "127.0.0.1.nip.io": ["127.0.0.1"],
    "fe80--1.sslip.io": ["fe80::1"],
    "maps.workadventu.re": ["51.159.93.108"],
    "2606-4700-4700--1111.sslip.io": ["2606:4700:4700::1111"],
};

vi.mock("dns/promises", () => ({
    default: {
        lookup: (hostname: string) => {
            const addresses = dnsTable[hostname];
            if (!addresses) {
                return Promise.reject(
                    Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" })
                );
            }
            return Promise.resolve(addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
        },
    },
}));

describe("MapFetcher", () => {
    it("should return true on localhost ending URLs", async () => {
        expect(await mapFetcher.isLocalUrl("https://localhost")).toBe(true);
        expect(await mapFetcher.isLocalUrl("https://foo.localhost")).toBe(true);
    });

    it("should return true on DNS resolving to a local domain", async () => {
        expect(await mapFetcher.isLocalUrl("https://127.0.0.1.nip.io")).toBe(true);
        expect(await mapFetcher.isLocalUrl("https://fe80--1.sslip.io")).toBe(true);
    });

    it("should return true on an IP resolving to a local domain", async () => {
        expect(await mapFetcher.isLocalUrl("https://127.0.0.1")).toBe(true);
        expect(await mapFetcher.isLocalUrl("https://192.168.0.1")).toBe(true);
        expect(await mapFetcher.isLocalUrl("https://[fd01::1]")).toBe(true);
    });

    it("should return false on an IP resolving to a global domain", async () => {
        expect(await mapFetcher.isLocalUrl("https://51.12.42.42")).toBe(false);
        expect(await mapFetcher.isLocalUrl("https://[2606:4700:4700::1111]")).toBe(false);
    });

    it("should return false on an DNS resolving to a global domain", async () => {
        expect(await mapFetcher.isLocalUrl("https://maps.workadventu.re")).toBe(false);
        expect(await mapFetcher.isLocalUrl("https://2606-4700-4700--1111.sslip.io")).toBe(false);
    });

    it("should throw error on invalid domain", async () => {
        await expect(
            mapFetcher.isLocalUrl("https://this.domain.name.doesnotexistfoobgjkgfdjkgldf.com")
        ).rejects.toThrowError();
    });
});
