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
    /** server: the server labels it. read: worked out from its description. you: someone moved it. */
    from: "server" | "read" | "you";
}
