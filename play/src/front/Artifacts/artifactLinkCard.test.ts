import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../Enum/ComputedConst", () => ({ ABSOLUTE_PUSHER_URL: "https://pusher.test/" }));
vi.mock("../Enum/EnvironmentVariable", () => ({ ADMIN_URL: "https://orbit.example" }));
vi.mock("../Connection/LocalUserStore", () => ({ localUserStore: { getAuthToken: () => "token" } }));

import type { ArtifactChat } from "./ArtifactApi";
import { artifactLink } from "./ArtifactApi";
import { artifactIdOfLink, forgetLinkedArtifacts, linkedArtifactCard } from "./artifactLinkCard";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const chat: ArtifactChat = { kind: "dm", ref: "!room:chat.example" };

function answer(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const opened = {
    artifact: { id: ID, title: "Dubai trip, day 3", kind: "page", makerName: "Laura", version: 4 },
    version: { number: 4 },
    you: { owner: false, change: false, manage: false, copy: false },
};

describe("a pasted artifact link", () => {
    it("is only Universe's own share address", () => {
        expect(artifactIdOfLink(artifactLink(ID) ?? "")).toBe(ID);
        expect(artifactIdOfLink(`https://orbit.example/a/${ID.toUpperCase()}/`)).toBe(ID);
        // Orbit's address without its scheme, as some setups give it
        expect(artifactIdOfLink(`https://orbit.example/a/${ID}`, "//orbit.example")).toBe(ID);
        expect(artifactIdOfLink(`https://orbit.example.evil.com/a/${ID}`)).toBeUndefined();
        expect(artifactIdOfLink(`https://evil.com/a/${ID}`)).toBeUndefined();
        expect(artifactIdOfLink(`https://orbit.example/a/${ID}/more`)).toBeUndefined();
        expect(artifactIdOfLink(`https://orbit.example/a/${ID}?x=1`)).toBeUndefined();
        expect(artifactIdOfLink("https://orbit.example/a/not-an-id")).toBeUndefined();
        expect(artifactIdOfLink(`https://orbit.example/admin/a/${ID}`)).toBeUndefined();
        expect(artifactIdOfLink(`https://orbit.example/a/${ID}`, "")).toBeUndefined();
    });
});

describe("the card a pasted artifact link shows", () => {
    beforeEach(() => {
        forgetLinkedArtifacts();
        vi.restoreAllMocks();
    });

    it("is the latest version with its name, kind and maker, once Orbit says this person may open it", async () => {
        const fetching = vi.spyOn(globalThis, "fetch").mockResolvedValue(answer(200, opened));
        expect(await linkedArtifactCard(ID, chat)).toEqual({
            id: ID,
            version: 4,
            title: "Dubai trip, day 3",
            kind: "page",
            maker: "Laura",
        });
        // The same artifact in the same chat is checked once
        await linkedArtifactCard(ID, chat);
        expect(fetching).toHaveBeenCalledTimes(1);
        expect(fetching.mock.calls[0][0]).toBe(`https://pusher.test/artifacts/${ID}/open`);
        expect(JSON.parse(fetching.mock.calls[0][1]?.body as string)).toEqual({ chat });
    });

    it("is none when the person may not open it from here, and that answer is kept", async () => {
        const fetching = vi.spyOn(globalThis, "fetch").mockResolvedValue(answer(404, { error: "not_found" }));
        expect(await linkedArtifactCard(ID, chat)).toBeUndefined();
        expect(await linkedArtifactCard(ID, chat)).toBeUndefined();
        expect(fetching).toHaveBeenCalledTimes(1);
    });

    it("is none when Orbit can't be reached, and is asked again next time", async () => {
        const fetching = vi
            .spyOn(globalThis, "fetch")
            .mockRejectedValueOnce(new TypeError("offline"))
            .mockResolvedValueOnce(answer(200, opened));
        expect(await linkedArtifactCard(ID, chat)).toBeUndefined();
        expect((await linkedArtifactCard(ID, chat))?.title).toBe("Dubai trip, day 3");
        expect(fetching).toHaveBeenCalledTimes(2);
    });

    it("is checked again in another chat, where the answer can differ", async () => {
        const fetching = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(answer(200, opened))
            .mockResolvedValueOnce(answer(404, { error: "not_found" }));
        expect(await linkedArtifactCard(ID, chat)).toBeDefined();
        expect(await linkedArtifactCard(ID, { kind: "nearby", ref: "bubble-2" })).toBeUndefined();
        expect(fetching).toHaveBeenCalledTimes(2);
    });
});
