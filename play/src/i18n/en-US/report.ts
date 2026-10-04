import type { BaseTranslation } from "../i18n-types";

const report: BaseTranslation = {
    block: {
        title: "Block",
        content: "Block any communication from and to {userName}. This can be reverted.",
        unblock: "Unblock this user",
        block: "Block this user",
        blockOrReport: "Block or report…",
    },
    title: "Report",
    content: "Send a report message to the administrators of this room. They may later ban this user.",
    message: {
        title: "Your message: ",
        empty: "Report message cannot to be empty.",
        error: "Report message error, you can contact the administrator.",
    },
    submit: "Report this user",
    moderate: {
        title: "Moderate {userName}",
        block: "Block",
        report: "Report",
        noSelect: "ERROR : There is no action selected.",
    },
    popup: {
        close: "Close",
        thisWorld: "this world",
        block: {
            title: "Block",
            content: "You won’t see or hear {userName}, and they can’t message you. Only you, and you can undo it.",
            block: "Block {userName}",
            unblock: "Unblock {userName}",
        },
        report: {
            title: "Report to the admins of {worldName}",
            content: "They see what you write, your name, and the room you’re in.",
            placeholder: "What happened?",
            send: "Send report",
            sent: "Report sent to the admins of {worldName}",
        },
    },
};

export default report;
