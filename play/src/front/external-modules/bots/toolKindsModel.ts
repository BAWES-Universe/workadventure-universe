/** What a tool does (prototype), which decides whether the bot asks before using it. */
export type ToolKind = "look" | "make" | "change" | "send";
/** For each group: runs right away, asks first, or off. */
export type ToolRun = "run" | "ask" | "off";

export interface KindedTool {
    name: string;
    /** The tool's own title from the server, or its name. */
    title: string;
    /** The first line of the tool's own description. */
    description: string;
    kind: ToolKind;
    /** Where the group came from, always a suggestion: server: the server labels it. read: from its description.
     * you: someone moved it. */
    from: "server" | "read" | "you";
    /** Who reviewed the suggestion or moved the tool. Until someone does, the tool needs review. */
    reviewedBy?: string;
}
