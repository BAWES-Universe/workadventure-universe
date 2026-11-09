import { EventProcessor } from "./EventProcessor";

export const eventProcessor = new EventProcessor();

eventProcessor.registerPublicEventProcessor("spaceMessage", (event, senderId, users) => {
    if (event.$case !== "spaceMessage") {
        // FIXME: improve the typing of the method to avoid this
        throw new Error("Invalid event type");
    }

    const sender = users.find((user) => user.spaceUserId === senderId);

    if (!sender) {
        throw new Error("Sender not found");
    }

    return {
        $case: "spaceMessage",
        spaceMessage: {
            message: event.spaceMessage.message,
            characterTextures: sender.characterTextures,
            name: sender.name,
            url: event.spaceMessage.url,
            mediaType: event.spaceMessage.mediaType,
            mimeType: event.spaceMessage.mimeType,
            galleryUrls: event.spaceMessage.galleryUrls,
            fileName: event.spaceMessage.fileName,
            fileNames: event.spaceMessage.fileNames,
            id: event.spaceMessage.id,
            replyTo: event.spaceMessage.replyTo,
            spoken: event.spaceMessage.spoken,
            voiceDurationMs: event.spaceMessage.voiceDurationMs,
            voiceWaveform: event.spaceMessage.voiceWaveform ?? [],
        },
    };
});

eventProcessor.registerPublicEventProcessor("spaceMessageReaction", (event, senderId, users) => {
    if (event.$case !== "spaceMessageReaction") {
        // FIXME: improve the typing of the method to avoid this
        throw new Error("Invalid event type");
    }

    const sender = users.find((user) => user.spaceUserId === senderId);

    if (!sender) {
        throw new Error("Sender not found");
    }

    return {
        $case: "spaceMessageReaction",
        spaceMessageReaction: {
            messageId: event.spaceMessageReaction.messageId,
            reaction: event.spaceMessageReaction.reaction,
            add: event.spaceMessageReaction.add,
            name: sender.name,
        },
    };
});

eventProcessor.registerPublicEventProcessor("spaceMessageTranscript", (event, senderId, users) => {
    if (event.$case !== "spaceMessageTranscript") {
        // FIXME: improve the typing of the method to avoid this
        throw new Error("Invalid event type");
    }

    if (!users.some((user) => user.spaceUserId === senderId)) {
        throw new Error("Sender not found");
    }

    // Passed on as it is: receivers accept it only from a bot, and only under the note with that id from that sender.
    return {
        $case: "spaceMessageTranscript",
        spaceMessageTranscript: {
            messageId: event.spaceMessageTranscript.messageId,
            state: event.spaceMessageTranscript.state,
            text: event.spaceMessageTranscript.text,
            senderUserId: event.spaceMessageTranscript.senderUserId,
        },
    };
});

eventProcessor.registerPublicEventProcessor("spaceIsTyping", (event, senderId, users) => {
    if (event.$case !== "spaceIsTyping") {
        // FIXME: improve the typing of the method to avoid this
        throw new Error("Invalid event type");
    }

    const sender = users.find((user) => user.spaceUserId === senderId);

    if (!sender) {
        throw new Error("Sender not found");
    }

    return {
        $case: "spaceIsTyping",
        spaceIsTyping: {
            isTyping: event.spaceIsTyping.isTyping,
            characterTextures: sender.characterTextures,
            name: sender.name,
        },
    };
});
