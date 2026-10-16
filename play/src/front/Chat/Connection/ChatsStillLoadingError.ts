/** Opening a chat was refused because the account's chats have not loaded yet, so the chat may exist but is not found. */
export class ChatsStillLoadingError extends Error {
    constructor() {
        super("The chats are still loading");
        this.name = "ChatsStillLoadingError";
    }
}
