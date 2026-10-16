import axios from "axios";
import * as Sentry from "@sentry/node";
import { MATRIX_API_URI, MATRIX_DOMAIN } from "../enums/EnvironmentVariable";
import type { SocketData } from "../models/Websocket/SocketData";

/**
 * A player's chat ID is their Matrix user ID. The browser can claim any ID it wants, so the server only uses one it
 * checked itself: either the Matrix server confirms whose access token the player holds, or (for bots) the ID is
 * derived from the bot identity in a token signed with our secret.
 */

const WHOAMI_TIMEOUT_MS = 5000;

// A bot's identity in its token (bot-<botId>); its Matrix account is @bot_<botId>:<domain>, as the bot server
// creates it for direct messages.
const BOT_IDENTIFIER = /^bot-([a-z0-9._=\-/]+)$/;

export interface ChatIdVerifierDependencies {
    matrixApiUri: string | undefined;
    matrixDomain: string | undefined;
    getWhoami(url: string, accessToken: string, timeoutMs: number): Promise<unknown>;
}

export class ChatIdVerifier {
    constructor(private readonly deps: ChatIdVerifierDependencies) {}

    /**
     * Asks the Matrix server who owns this access token.
     * Returns undefined when the token is refused, belongs to a guest or to another server, or Matrix is not set up.
     */
    async getMatrixUserIdForAccessToken(accessToken: string): Promise<string | undefined> {
        const { matrixApiUri, matrixDomain } = this.deps;
        if (!matrixApiUri || !accessToken) {
            return undefined;
        }
        // MATRIX_API_URI ends with a slash, like everywhere else it is used (see MatrixProvider).
        const url = `${matrixApiUri}_matrix/client/v3/account/whoami`;
        let data: unknown;
        try {
            data = await this.deps.getWhoami(url, accessToken, WHOAMI_TIMEOUT_MS);
        } catch (e) {
            if (axios.isAxiosError(e) && (e.response?.status === 401 || e.response?.status === 403)) {
                // A token the Matrix server does not know: nothing to verify.
                return undefined;
            }
            throw e;
        }
        if (typeof data !== "object" || data === null) {
            return undefined;
        }
        const { user_id: userId, is_guest: isGuest } = data as { user_id?: unknown; is_guest?: unknown };
        if (typeof userId !== "string" || isGuest === true) {
            return undefined;
        }
        if (matrixDomain && !userId.endsWith(`:${matrixDomain}`)) {
            return undefined;
        }
        return userId;
    }

    /**
     * The chat ID a bot may use: exactly its own bot account (@bot_<botId>:<domain>), and only when the token that
     * identifies it as that bot was signed by us. Anything else is refused.
     */
    getBotChatId(identifier: string | undefined, claimedChatId: string | undefined): string | undefined {
        const { matrixDomain } = this.deps;
        if (!identifier || !claimedChatId || !matrixDomain) {
            return undefined;
        }
        const match = BOT_IDENTIFIER.exec(identifier);
        if (!match) {
            return undefined;
        }
        const botChatId = `@bot_${match[1]}:${matrixDomain}`;
        return claimedChatId === botChatId ? botChatId : undefined;
    }
}

/**
 * What may go to the logs and the error tracker about a failed check. The error axios throws carries the whole request,
 * including the player's access token (the Authorization header), so only what failed is kept: the message, the error
 * code and the HTTP status.
 */
export function describeChatIdError(e: unknown): Error {
    if (axios.isAxiosError(e)) {
        const details = [e.code, e.response?.status && `HTTP ${e.response.status}`].filter(Boolean).join(", ");
        return new Error(`Matrix server check failed: ${e.message}${details ? ` (${details})` : ""}`);
    }
    return e instanceof Error ? e : new Error(String(e));
}

type ChatIdSocketData = Pick<SocketData, "isLogged" | "chatID" | "chatIdVerification" | "disconnecting">;

interface VerificationQueue {
    // The token waiting for the running check to end (only the latest one is kept).
    next?: string;
    // The last token the Matrix server answered for.
    lastAnswered?: string;
}

// Per socket: at most one check runs at a time, so a browser sending many tokens cannot flood the Matrix server.
const queues = new WeakMap<ChatIdSocketData, VerificationQueue>();

/**
 * Checks the Matrix access token a player sent and, when the Matrix server confirms whose it is, makes that the
 * player's chat ID: `apply` saves it and shows it to the other players. While a check runs,
 * socketData.chatIdVerification is set, so that walking into an area chat can wait for it.
 */
export function verifyChatId(
    socketData: ChatIdSocketData,
    matrixAccessToken: string,
    verifier: Pick<ChatIdVerifier, "getMatrixUserIdForAccessToken">,
    apply: (chatId: string) => Promise<void>
): Promise<void> {
    if (!socketData.isLogged || !matrixAccessToken) {
        // Only signed-in players have a Matrix account.
        return Promise.resolve();
    }
    const queue = queues.get(socketData) ?? {};
    queues.set(socketData, queue);
    if (socketData.chatIdVerification) {
        // A check is running: this token is checked right after it.
        if (matrixAccessToken !== queue.lastAnswered) {
            queue.next = matrixAccessToken;
        }
        return socketData.chatIdVerification;
    }
    if (matrixAccessToken === queue.lastAnswered) {
        return Promise.resolve();
    }

    const checkOne = async (token: string): Promise<void> => {
        const chatId = await verifier.getMatrixUserIdForAccessToken(token);
        if (!chatId || socketData.disconnecting || chatId === socketData.chatID) {
            // Refused, gone, or already the chat ID we have on file: nothing changes.
            queue.lastAnswered = token;
            return;
        }
        const previousChatId = socketData.chatID;
        socketData.chatID = chatId;
        try {
            await apply(chatId);
        } catch (e) {
            // Not saved or not shown to the others: go back, so that sending the same token again retries.
            // Checks run one after the other, so nothing else changed the chat ID while we waited.
            // eslint-disable-next-line require-atomic-updates
            socketData.chatID = previousChatId;
            throw e;
        }
        queue.lastAnswered = token;
    };

    const verification = (async () => {
        let token: string | undefined = matrixAccessToken;
        while (token) {
            try {
                // One check after the other, on purpose.
                // eslint-disable-next-line no-await-in-loop
                await checkOne(token);
            } catch (e) {
                // Usually the Matrix server not answering: the chat ID stays as it was, and the same token can be
                // sent again.
                const safeError = describeChatIdError(e);
                console.error("Could not check the player's chat ID", safeError.message);
                Sentry.captureException(safeError);
            }
            token = queue.next;
            queue.next = undefined;
        }
    })();
    socketData.chatIdVerification = verification;
    void verification.then(() => {
        if (socketData.chatIdVerification === verification) {
            socketData.chatIdVerification = undefined;
        }
    });
    return verification;
}

/**
 * A chat ID in a player details message from the browser is only kept when it is the checked one.
 */
export function withoutUncheckedChatId<T extends { chatID: string }>(details: T, checkedChatId: string | undefined): T {
    if (details.chatID && details.chatID !== checkedChatId) {
        // An empty chat ID means "unchanged".
        return { ...details, chatID: "" };
    }
    return details;
}

/**
 * Removes the chat ID from a space user update sent by the browser: only the server sets it, once checked.
 */
export function withoutChatIdUpdate<T extends { updateMask: string[]; user?: { chatID?: string } }>(message: T): T {
    return {
        ...message,
        updateMask: message.updateMask.filter((field) => field !== "chatID" && !field.startsWith("chatID.")),
        user: message.user ? { ...message.user, chatID: undefined } : message.user,
    };
}

export const chatIdVerifier = new ChatIdVerifier({
    matrixApiUri: MATRIX_API_URI,
    matrixDomain: MATRIX_DOMAIN,
    getWhoami: async (url, accessToken, timeoutMs) => {
        const response = await axios.get(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: timeoutMs,
        });
        return response.data;
    },
});
