import { randomUUID } from "node:crypto";
import type { LinearSocket } from "./LinearShGateway";

/** Uses server membership and actual signed socket identity, never names/tags.
 * Both participants must be local. Cross-pusher membership propagation is not atomic.
 */
export class LinearShInteraction<T extends LinearSocket> {
    private generation = randomUUID();
    private owner?: { socket: T; token: string; subject: string; id: string };
    private delivered = new Set<string>();
    private notices = new WeakMap<T, string>();
    constructor(
        private conversation: string,
        private members: () => Iterable<string>,
        private sockets: () => Map<string, T>,
        private paused?: (socket: T) => void
    ) {}
    invalidate(): void {
        this.generation = randomUUID();
        this.owner = undefined;
        this.delivered.clear();
        // Membership mutation finishes synchronously first. Only this bot's bubble gets a data-free notice.
        queueMicrotask(() => {
            const sockets = [...this.sockets().values()];
            if (
                process.env.LINEAR_SH_BOT_ID &&
                sockets.some((s) => s.getUserData().userUuid === `bot-${process.env.LINEAR_SH_BOT_ID}`) &&
                (sockets.length > 2 || [...this.members()].length > 2)
            ) {
                for (const socket of sockets)
                    if (socket.getUserData().userUuid !== `bot-${process.env.LINEAR_SH_BOT_ID}`)
                        this.notice(socket, "Please use Linear SH one person at a time.", () => this.paused?.(socket));
            }
        });
    }
    private sole(): T | undefined {
        const botId = process.env.LINEAR_SH_BOT_ID;
        if (!botId) return;
        const members = [...this.members()];
        const sockets = this.sockets();
        if (members.length !== 2 || sockets.size !== 2 || members.some((id) => !sockets.has(id))) return;
        const live = [...sockets.values()];
        const bots = live.filter((s) => s.getUserData().userUuid === `bot-${botId}`);
        if (bots.length !== 1) return;
        return live.find((s) => s !== bots[0]);
    }
    capture(socket: T): string | undefined {
        const data = socket.getUserData();
        if (this.sole() !== socket || !data.isLogged || data.disconnecting || !data.spaces.has(this.conversation)) {
            this.invalidate();
            return;
        }
        if (
            this.owner &&
            (this.owner.socket !== socket ||
                this.owner.token !== data.token ||
                this.owner.subject !== data.userUuid ||
                this.owner.id !== data.spaceUserId)
        )
            this.invalidate();
        this.owner = { socket, token: data.token, subject: data.userUuid, id: data.spaceUserId };
        return this.generation;
    }
    current(interactionId: string, socket?: T): boolean {
        const owner = this.owner;
        return !!owner && (!socket || owner.socket === socket) && this.capture(owner.socket) === interactionId;
    }
    participant(): T | undefined {
        return this.sole();
    }
    botSenderId(): string {
        return [...this.sockets().values()].find(s => s.getUserData().userUuid === `bot-${process.env.LINEAR_SH_BOT_ID}`)
            ?.getUserData().spaceUserId ?? "linear-sh-notice";
    }
    displayed(interactionId: string, requestId: string): void {
        if (this.current(interactionId) && this.delivered.size < 100) this.delivered.add(requestId);
    }
    check(interactionId: string, requestId = ""): Promise<boolean> {
        const until = Date.now() + 3000;
        return new Promise((resolve) => {
            const poll = () => {
                if (!this.current(interactionId)) resolve(false);
                else if (!requestId || this.delivered.has(requestId)) resolve(true);
                else if (Date.now() >= until) resolve(false);
                else setTimeout(poll, 20);
            };
            poll();
        });
    }
    notice(socket: T, message: string, emit: () => void): void {
        if (this.notices.get(socket) === message) return;
        this.notices.set(socket, message);
        emit();
    }
    clearNotice(socket: T): void {
        this.notices.delete(socket);
    }
}
