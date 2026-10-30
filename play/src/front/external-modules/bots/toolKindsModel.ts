/** What a tool does (prototype), which decides whether the bot asks before using it. */
export type ToolKind = "look" | "make" | "change" | "send";
/** For each kind of action: runs right away, asks first, or off. */
export type ToolRun = "run" | "ask" | "off";

export interface KindedTool {
    name: string;
    /** The tool's own title from the server, or its name. */
    title: string;
    /** The first line of the tool's own description. */
    description: string;
    kind: ToolKind;
    /** Where the kind came from, always a suggestion: server: the server labels it. read: from its description.
     * you: someone moved it. */
    from: "server" | "read" | "you";
    /** Who confirmed the suggestion or moved the tool. Until someone does, the tool waits to be confirmed. */
    reviewedBy?: string;
}
