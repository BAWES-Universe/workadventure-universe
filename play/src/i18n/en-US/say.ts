import type { BaseTranslation } from "../i18n-types";

const say: BaseTranslation = {
    /** Default Express phrases. Keep them tiny: the four must fit on one line. */
    quickPhrases: {
        hi: "Hi 👋",
        brb: "Brb",
        thanks: "Thanks",
        ok: "OK",
    },
    type: {
        say: "Say",
        think: "Think",
    },
    placeholder: "Type your message here...",
    button: "Create bubble",
    raiseHand: {
        raise: "Raise hand",
        lower: "Lower hand",
        next: "you're next",
        inLine: "number {position:number} in line",
        handUp: "Your hand is up",
        handUpInLine: "Your hand is up, number {position:number} in line",
        spoke: "You spoke, so your hand will go down",
        keepRaised: "Keep it raised",
        loweredByModerator: "A moderator lowered your hand",
        lowerSomeone: "Lower hand",
        lowerAll: "Lower all hands",
    },
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
        phrases: "Quick phrases",
        edit: "Edit",
        done: "Done",
        editTitle: "Edit Express",
        editHint: "Tap an emote or a phrase to change it",
        changeEmote: "Change {emoji}",
        editPhrase: "Edit “{phrase}”",
        shortcuts: {
            title: "Shortcuts",
            say: "Say something",
            think: "Think something",
            emote: "Play an emote",
            edit: "Edit emotes and phrases",
            rightClick: "Right-click",
            longPress: "Long-press",
        },
    },
    tooltip: {
        description: {
            say: "Displays a chat bubble above your character. Visible to everyone on the map, it remains displayed for 5 seconds.",
            think: "Displays a thought bubble above your character. Visible to all players on the map, it remains displayed as long as you don't move.",
        },
    },
};

export default say;
