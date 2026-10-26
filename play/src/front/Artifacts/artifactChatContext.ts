import type { ArtifactChat } from "./ArtifactApi";

/**
 * The chat open around a message, for the cards inside it: asked when a card is tapped, because a bubble's space
 * changes while the same chat stays open. Undefined when the chat is neither a bubble nor a direct chat.
 */
export const ARTIFACT_CHAT_CONTEXT = Symbol("artifactChat");

export type ArtifactChatOf = () => ArtifactChat | undefined;
