import { EventProcessor } from "./EventProcessor";

export const eventProcessor = new EventProcessor();

eventProcessor.registerPublicEventProcessor("muteAudioForEverybody", (event, sender) => {
    if (!sender || !sender.tags.includes("admin")) {
        throw new Error("Only admins can mute everyone");
    }
    return event;
});

eventProcessor.registerPublicEventProcessor("muteVideoForEverybody", (event, sender) => {
    if (!sender || !sender.tags.includes("admin")) {
        throw new Error("Only admins can mute everyone");
    }
    return event;
});

eventProcessor.registerPrivateEventProcessor("muteAudio", (event, sender, receiver) => {
    if (event.$case !== "muteAudio") {
        // FIXME: improve the typing of the method to avoid this
        throw new Error("Invalid event type");
    }

    if (!sender) {
        throw new Error("Sender not found");
    }

    if (sender.tags.includes("admin")) {
        event.muteAudio.force = true;
    }

    return event;
});

eventProcessor.registerPrivateEventProcessor("muteVideo", (event, sender, receiver) => {
    if (event.$case !== "muteVideo") {
        // FIXME: improve the typing of the method to avoid this
        throw new Error("Invalid event type");
    }

    if (!sender) {
        throw new Error("Sender not found");
    }

    if (sender.tags.includes("admin")) {
        event.muteVideo.force = true;
    }

    return event;
});

eventProcessor.registerPrivateEventProcessor("lowerHand", (event, sender) => {
    if (!sender || !sender.tags.includes("admin")) {
        throw new Error("Only admins can lower someone else's hand");
    }
    return event;
});

eventProcessor.registerPublicEventProcessor("lowerAllHands", (event, sender) => {
    if (!sender || !sender.tags.includes("admin")) {
        throw new Error("Only admins can lower all hands");
    }
    return event;
});

// On a podium, the people streaming (the speakers) and admins can bring someone from the audience on stage, and send
// them back.
const canBringOnStage = (sender: { megaphoneState: boolean; tags: string[] }) =>
    sender.megaphoneState || sender.tags.includes("admin");

eventProcessor.registerPrivateEventProcessor("inviteToSpeak", (event, sender) => {
    if (!canBringOnStage(sender)) {
        throw new Error("Only speakers and admins can invite someone to speak");
    }
    return event;
});

eventProcessor.registerPrivateEventProcessor("moveToAudience", (event, sender) => {
    if (!canBringOnStage(sender)) {
        throw new Error("Only speakers and admins can move someone to the audience");
    }
    return event;
});
