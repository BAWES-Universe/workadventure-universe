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
