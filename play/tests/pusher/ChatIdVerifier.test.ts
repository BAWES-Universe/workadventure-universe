import { describe, expect, it, vi } from "vitest";
import { AxiosError, AxiosHeaders } from "axios";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => ({
    MATRIX_API_URI: "http://synapse:8008/",
    MATRIX_DOMAIN: "matrix.test",
}));

import {
    ChatIdVerifier,
    verifyChatId,
    withoutChatIdUpdate,
    withoutUncheckedChatId,
} from "../../src/pusher/services/ChatIdVerifier";

function verifierAnswering(answer: () => Promise<unknown>, matrixDomain: string | undefined = "matrix.test") {
    const getWhoami = vi.fn(answer);
    return {
        getWhoami,
        verifier: new ChatIdVerifier({ matrixApiUri: "http://synapse:8008/", matrixDomain, getWhoami }),
    };
}

function httpError(status: number): AxiosError {
    return new AxiosError("refused", "ERR_BAD_REQUEST", undefined, undefined, {
        status,
        statusText: "",
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: {},
    });
}

describe("ChatIdVerifier.getMatrixUserIdForAccessToken", () => {
    it("asks the Matrix server whose token it is", async () => {
        const { verifier, getWhoami } = verifierAnswering(() =>
            Promise.resolve({ user_id: "@alice:matrix.test", is_guest: false })
        );
        await expect(verifier.getMatrixUserIdForAccessToken("syt_alice")).resolves.toBe("@alice:matrix.test");
        expect(getWhoami).toHaveBeenCalledWith(
            "http://synapse:8008/_matrix/client/v3/account/whoami",
            "syt_alice",
            expect.any(Number)
        );
    });

    it.each([401, 403])("gives nothing for a token the Matrix server refuses (%i)", async (status) => {
        const { verifier } = verifierAnswering(() => Promise.reject(httpError(status)));
        await expect(verifier.getMatrixUserIdForAccessToken("syt_old")).resolves.toBeUndefined();
    });

    it("lets other errors through (Matrix server down), so nothing is changed", async () => {
        const { verifier } = verifierAnswering(() => Promise.reject(new Error("ECONNREFUSED")));
        await expect(verifier.getMatrixUserIdForAccessToken("syt_alice")).rejects.toThrow("ECONNREFUSED");
    });

    it.each([
        [{ user_id: "@guest:matrix.test", is_guest: true }],
        [{ user_id: "@alice:evil.test" }],
        [{ user_id: 42 }],
        ["not json"],
        [null],
    ])("gives nothing for a guest, another server's user, or an odd answer (%j)", async (answer) => {
        const { verifier } = verifierAnswering(() => Promise.resolve(answer));
        await expect(verifier.getMatrixUserIdForAccessToken("syt_x")).resolves.toBeUndefined();
    });

    it("does nothing without Matrix or without a token", async () => {
        const getWhoami = vi.fn();
        const noMatrix = new ChatIdVerifier({ matrixApiUri: undefined, matrixDomain: undefined, getWhoami });
        await expect(noMatrix.getMatrixUserIdForAccessToken("syt_alice")).resolves.toBeUndefined();
        const { verifier, getWhoami: called } = verifierAnswering(() => Promise.resolve({}));
        await expect(verifier.getMatrixUserIdForAccessToken("")).resolves.toBeUndefined();
        expect(getWhoami).not.toHaveBeenCalled();
        expect(called).not.toHaveBeenCalled();
    });
});

describe("ChatIdVerifier.getBotChatId", () => {
    const { verifier } = verifierAnswering(() => Promise.resolve({}));
    const BOT_ID = "3f2c9a1e-7b4d-4c1a-9e2f-123456789abc";

    it("lets a bot use exactly its own bot account", () => {
        expect(verifier.getBotChatId(`bot-${BOT_ID}`, `@bot_${BOT_ID}:matrix.test`)).toBe(`@bot_${BOT_ID}:matrix.test`);
    });

    it("refuses another account, another bot's account, or a non-bot identity", () => {
        expect(verifier.getBotChatId(`bot-${BOT_ID}`, "@alice:matrix.test")).toBeUndefined();
        expect(verifier.getBotChatId(`bot-${BOT_ID}`, "@bot_other:matrix.test")).toBeUndefined();
        expect(verifier.getBotChatId(`bot-${BOT_ID}`, `@bot_${BOT_ID}:evil.test`)).toBeUndefined();
        expect(verifier.getBotChatId("alice@example.test", "@alice:matrix.test")).toBeUndefined();
        expect(verifier.getBotChatId("bot-x@example.test", "@bot_x@example.test:matrix.test")).toBeUndefined();
        expect(verifier.getBotChatId(undefined, `@bot_${BOT_ID}:matrix.test`)).toBeUndefined();
        expect(verifier.getBotChatId(`bot-${BOT_ID}`, undefined)).toBeUndefined();
    });

    it("gives bots no chat ID when Matrix has no domain", () => {
        const noDomain = new ChatIdVerifier({ matrixApiUri: undefined, matrixDomain: undefined, getWhoami: vi.fn() });
        expect(noDomain.getBotChatId(`bot-${BOT_ID}`, `@bot_${BOT_ID}:matrix.test`)).toBeUndefined();
    });
});

describe("verifyChatId", () => {
    function socketData(overrides: Partial<Parameters<typeof verifyChatId>[0]> = {}) {
        return {
            isLogged: true,
            chatID: undefined as string | undefined,
            chatIdVerification: undefined as Promise<void> | undefined,
            disconnecting: false,
            ...overrides,
        };
    }

    it("uses the ID the Matrix server confirms, saves and shows it", async () => {
        const data = socketData({ chatID: "@someone-else:matrix.test" });
        const apply = vi.fn(() => Promise.resolve());
        await verifyChatId(
            data,
            "syt_alice",
            { getMatrixUserIdForAccessToken: () => Promise.resolve("@alice:matrix.test") },
            apply
        );
        expect(data.chatID).toBe("@alice:matrix.test");
        expect(apply).toHaveBeenCalledWith("@alice:matrix.test");
    });

    it.each([
        ["refused", () => Promise.resolve(undefined)],
        ["server down", () => Promise.reject(new Error("down"))],
    ])("changes nothing when the token is %s", async (_case, answer: () => Promise<string | undefined>) => {
        const data = socketData({ chatID: "@alice:matrix.test" });
        const apply = vi.fn(() => Promise.resolve());
        await verifyChatId(data, "syt_x", { getMatrixUserIdForAccessToken: answer }, apply).catch(() => undefined);
        expect(data.chatID).toBe("@alice:matrix.test");
        expect(apply).not.toHaveBeenCalled();
    });

    it("does not save or broadcast again an ID it already has", async () => {
        const data = socketData({ chatID: "@alice:matrix.test" });
        const apply = vi.fn(() => Promise.resolve());
        await verifyChatId(
            data,
            "syt_alice",
            { getMatrixUserIdForAccessToken: () => Promise.resolve("@alice:matrix.test") },
            apply
        );
        expect(apply).not.toHaveBeenCalled();
    });

    it("ignores guests and empty tokens", async () => {
        const lookup = vi.fn(() => Promise.resolve("@alice:matrix.test"));
        await verifyChatId(
            socketData({ isLogged: false }),
            "syt_alice",
            { getMatrixUserIdForAccessToken: lookup },
            vi.fn()
        );
        await verifyChatId(socketData(), "", { getMatrixUserIdForAccessToken: lookup }, vi.fn());
        expect(lookup).not.toHaveBeenCalled();
    });

    it("drops the result when the player left in the meantime", async () => {
        const data = socketData();
        const apply = vi.fn(() => Promise.resolve());
        const pending = verifyChatId(
            data,
            "syt_alice",
            { getMatrixUserIdForAccessToken: () => Promise.resolve("@alice:matrix.test") },
            apply
        );
        data.disconnecting = true;
        await pending;
        expect(apply).not.toHaveBeenCalled();
    });

    it("marks the check as running right away, and clears it once done", async () => {
        const data = socketData();
        let answer: (value: string) => void = () => undefined;
        const pending = verifyChatId(
            data,
            "syt_alice",
            {
                getMatrixUserIdForAccessToken: () =>
                    new Promise<string>((resolve) => {
                        answer = resolve;
                    }),
            },
            () => Promise.resolve()
        );
        // Set synchronously: a later "enter area" message sees it and waits.
        expect(data.chatIdVerification).toBeInstanceOf(Promise);
        answer("@alice:matrix.test");
        await pending;
        await data.chatIdVerification;
        await Promise.resolve();
        expect(data.chatID).toBe("@alice:matrix.test");
        expect(data.chatIdVerification).toBeUndefined();
    });
});

describe("verifyChatId, many tokens", () => {
    function socketData() {
        return {
            isLogged: true,
            chatID: undefined as string | undefined,
            chatIdVerification: undefined as Promise<void> | undefined,
            disconnecting: false,
        };
    }

    it("runs one check at a time and, of the tokens sent meanwhile, only checks the last one", async () => {
        const data = socketData();
        const answers: Array<(id: string) => void> = [];
        const lookup = vi.fn(
            (token: string) =>
                new Promise<string>((resolve) => {
                    answers.push(() => resolve(`@${token}:matrix.test`));
                })
        );
        const apply = vi.fn(() => Promise.resolve());
        const first = verifyChatId(data, "one", { getMatrixUserIdForAccessToken: lookup }, apply);
        void verifyChatId(data, "two", { getMatrixUserIdForAccessToken: lookup }, apply);
        void verifyChatId(data, "three", { getMatrixUserIdForAccessToken: lookup }, apply);
        expect(lookup).toHaveBeenCalledTimes(1);
        answers[0]("");
        await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(2));
        expect(lookup).toHaveBeenLastCalledWith("three");
        answers[1]("");
        await first;
        expect(data.chatID).toBe("@three:matrix.test");
        expect(lookup).toHaveBeenCalledTimes(2);
    });

    it("does not ask again for a token it already has an answer for", async () => {
        const data = socketData();
        const lookup = vi.fn(() => Promise.resolve("@alice:matrix.test"));
        await verifyChatId(data, "same", { getMatrixUserIdForAccessToken: lookup }, () => Promise.resolve());
        await verifyChatId(data, "same", { getMatrixUserIdForAccessToken: lookup }, () => Promise.resolve());
        expect(lookup).toHaveBeenCalledTimes(1);
    });

    it("asks again for a token when the Matrix server could not answer the first time", async () => {
        const data = socketData();
        const lookup = vi
            .fn<(token: string) => Promise<string | undefined>>()
            .mockRejectedValueOnce(new Error("down"))
            .mockResolvedValueOnce("@alice:matrix.test");
        await verifyChatId(data, "same", { getMatrixUserIdForAccessToken: lookup }, () => Promise.resolve());
        expect(data.chatID).toBeUndefined();
        await verifyChatId(data, "same", { getMatrixUserIdForAccessToken: lookup }, () => Promise.resolve());
        expect(data.chatID).toBe("@alice:matrix.test");
    });
});

describe("chat IDs sent by the browser", () => {
    it("keeps a player details chat ID only when it is the checked one", () => {
        expect(withoutUncheckedChatId({ chatID: "@bob:matrix.test" }, "@alice:matrix.test").chatID).toBe("");
        expect(withoutUncheckedChatId({ chatID: "@bob:matrix.test" }, undefined).chatID).toBe("");
        expect(withoutUncheckedChatId({ chatID: "@alice:matrix.test" }, "@alice:matrix.test").chatID).toBe(
            "@alice:matrix.test"
        );
        // Other details go through untouched.
        expect(withoutUncheckedChatId({ chatID: "", availabilityStatus: 2 }, undefined)).toEqual({
            chatID: "",
            availabilityStatus: 2,
        });
    });

    it("removes the chat ID from a space user update, and keeps the rest", () => {
        const message = withoutChatIdUpdate({
            spaceName: "world.lobby",
            updateMask: ["cameraState", "chatID", "chatID.value"],
            user: { spaceUserId: "1", cameraState: true, chatID: "@bob:matrix.test" },
        });
        expect(message.updateMask).toEqual(["cameraState"]);
        expect(message.user?.chatID).toBeUndefined();
        expect(message.user).toEqual(expect.objectContaining({ spaceUserId: "1", cameraState: true }));
    });
});
