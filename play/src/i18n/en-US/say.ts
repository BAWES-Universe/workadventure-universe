import type { BaseTranslation } from "../i18n-types";

const say: BaseTranslation = {
    type: {
        say: "Say",
        think: "Think",
    },
    placeholder: "Type your message here...",
    button: "Create bubble",
    express: {
        button: "Express yourself",
        close: "Close",
        placeholder: "Say something…",
        say: "Say",
        think: "Think",
        send: "Send",
        emote: "Play {emoji}",
        emotes: "Your emotes",
        forcedSay: "In a meeting, bubbles are said out loud",
        forcedThink: "While you're away or busy, bubbles are thoughts",
        sayHint: "Everyone who can see you reads it for 5 seconds",
        thinkHint: "Stays above you until you move",
        enterToSend: "Enter to send",
    },
    tooltip: {
        description: {
            say: "Displays a chat bubble above your character. Visible to everyone on the map, it remains displayed for 5 seconds.",
            think: "Displays a thought bubble above your character. Visible to all players on the map, it remains displayed as long as you don't move.",
        },
    },
};

export default say;
