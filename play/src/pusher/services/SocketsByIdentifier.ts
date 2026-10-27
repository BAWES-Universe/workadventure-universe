/**
 * The open sockets of each person, by the identifier in their sign-in token. The friends list keys them by the account
 * uuid Orbit returns, which for a signed-in member can differ from the token's identifier (an email, say), and the
 * game's HTTP routes only know the token.
 */
export class SocketsByIdentifier<S> {
    private readonly byIdentifier = new Map<string, Set<S>>();

    add(identifier: string | undefined, socket: S): void {
        if (!identifier) return;
        let sockets = this.byIdentifier.get(identifier);
        if (!sockets) {
            sockets = new Set();
            this.byIdentifier.set(identifier, sockets);
        }
        sockets.add(socket);
    }

    remove(identifier: string | undefined, socket: S): void {
        if (!identifier) return;
        const sockets = this.byIdentifier.get(identifier);
        if (sockets?.delete(socket) && sockets.size === 0) this.byIdentifier.delete(identifier);
    }

    of(identifier: string): S[] {
        return Array.from(this.byIdentifier.get(identifier) ?? []);
    }
}
