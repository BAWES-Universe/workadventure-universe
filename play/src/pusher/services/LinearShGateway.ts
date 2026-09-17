import { jwtTokenManager } from "./JWTTokenManager";
import type { LinearShInteraction } from "./LinearShInteraction";

export interface LinearSocketData {
    token: string;
    isLogged: boolean;
    userUuid: string;
    spaceUserId: string;
    disconnecting: boolean;
    spaces: Set<string>;
}
export interface LinearSocket {
    getUserData(): LinearSocketData;
}

async function internal<T>(body: Record<string, unknown>): Promise<T> {
    const base = process.env.ADMIN_API_URL;
    const secret = process.env.ADMIN_API_TOKEN;
    if (!base || !secret || !process.env.LINEAR_SH_BOT_ID) throw new Error("Unavailable");
    const url = new URL(base);
    url.pathname = `${url.pathname.replace(/\/$/, "")}/api/linear-sh`;
    url.search = "";
    url.hash = "";
    const result = await fetch(url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, botId: process.env.LINEAR_SH_BOT_ID }),
    });
    if (!result.ok) throw new Error("Unavailable");
    return (await result.json()) as T;
}
function accessToken(data: LinearSocketData): string {
    if (!data.isLogged || data.disconnecting) throw new Error("Authentication required");
    const decoded = jwtTokenManager.verifyJWTToken(data.token);
    if (!decoded.accessToken) throw new Error("Authentication required");
    return decoded.accessToken;
}
export async function attestLinearSh(
    data: LinearSocketData,
    conversation: string,
    spaceName: string,
    message: string,
    interactionId: string
): Promise<string | undefined> {
    try {
        if (process.env.LINEAR_SH_ENABLED !== "true" || !data.spaces.has(conversation)) return undefined;
        const result = await internal<{ ticket: string }>({
            action: "attest",
            accessToken: accessToken(data),
            conversation,
            spaceName,
            senderId: data.spaceUserId,
            message,
            interactionId,
        });
        return typeof result.ticket === "string" ? result.ticket : undefined;
    } catch {
        return undefined;
    }
}

/** Authoritative final fan-out. Snapshot exact socket objects, recheck after every await, then emit synchronously. */
export async function authorizedLinearShFanout<T extends LinearSocket>(
    recipients: T[],
    conversation: string,
    authorize: (data: LinearSocketData) => Promise<{ authorized: boolean; subject: string; text: string }>,
    current: (socket: T, spaceUserId: string) => boolean,
    emit: (socket: T, text: string) => void,
    valid: () => boolean = () => false
): Promise<void> {
    await Promise.allSettled(
        recipients.map(async (socket) => {
            const data = socket.getUserData();
            if (!valid() || !data.isLogged || data.disconnecting || !data.spaces.has(conversation)) return;
            const binding = { token: data.token, uuid: data.userUuid, id: data.spaceUserId };
            const result = await authorize(data);
            const latest = socket.getUserData();
            if (
                !valid() ||
                result.authorized !== true ||
                typeof result.text !== "string" ||
                result.subject !== binding.uuid ||
                latest.token !== binding.token ||
                latest.userUuid !== binding.uuid ||
                latest.spaceUserId !== binding.id ||
                !latest.isLogged ||
                latest.disconnecting ||
                !latest.spaces.has(conversation) ||
                !current(socket, binding.id)
            )
                return;
            // No asynchronous gap between membership/identity validation and the final socket queue.
            emit(socket, result.text);
        })
    );
}
export async function deliverLinearSh<T extends LinearSocket>(
    recipients: T[],
    conversation: string,
    message: string,
    reply: string,
    current: (socket: T, id: string) => boolean,
    emit: (socket: T, text: string) => void,
    interaction?: LinearShInteraction<T>
): Promise<void> {
    if (!reply || process.env.LINEAR_SH_ENABLED !== "true" || !process.env.LINEAR_SH_BOT_ID || !interaction) return;
    const owner = interaction.participant();
    const interactionId = owner && interaction.capture(owner);
    if (!owner || !interactionId) return;
    let requestId = "";
    return authorizedLinearShFanout(
        recipients.filter((s) => s === owner),
        conversation,
        async (data) => {
            const result = await internal<{ authorized: boolean; subject: string; text: string; requestId: string }>({
                action: "delivery",
                accessToken: accessToken(data),
                conversation,
                message,
                reply,
                interactionId,
            });
            requestId = result.requestId;
            return result;
        },
        current,
        (socket, text) => {
            emit(socket, text);
            interaction.displayed(interactionId, requestId);
        },
        () => interaction.current(interactionId, owner)
    );
}
