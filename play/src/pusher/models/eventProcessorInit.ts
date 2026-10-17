import { hasPermission, Permission, permissionsFrom } from "@workadventure/shared-utils/src/Permissions/permissions";
import { EventProcessor } from "./EventProcessor";

export const eventProcessor = new EventProcessor();

const canModerateCalls = (sender: { permissions?: string; tags: string[] }) =>
    hasPermission(permissionsFrom(sender.permissions, sender.tags), Permission.MODERATE_CALLS);

eventProcessor.registerPublicEventProcessor("muteAudioForEverybody", (event, sender) => {
    if (!sender || !canModerateCalls(sender)) {
        throw new Error("Needs the Moderate calls permission to mute everyone");
    }
    return event;
});

eventProcessor.registerPublicEventProcessor("muteVideoForEverybody", (event, sender) => {
    if (!sender || !canModerateCalls(sender)) {
        throw new Error("Needs the Moderate calls permission to mute everyone");
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

    // Only someone who moderates calls can impose a mute. For anybody else it is a request the other person can
    // refuse, whatever the sender's browser put in the message.
    event.muteAudio.force = canModerateCalls(sender);

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

    event.muteVideo.force = canModerateCalls(sender);

    return event;
});

eventProcessor.registerPrivateEventProcessor("kickOffUser", (event, sender) => {
    if (!sender || !canModerateCalls(sender)) {
        throw new Error("Needs the Moderate calls permission to kick someone off a call");
    }
    return event;
});

eventProcessor.registerPrivateEventProcessor("lowerHand", (event, sender) => {
    if (!sender || !canModerateCalls(sender)) {
        throw new Error("Needs the Moderate calls permission to lower someone else's hand");
    }
    return event;
});

eventProcessor.registerPublicEventProcessor("lowerAllHands", (event, sender) => {
    if (!sender || !canModerateCalls(sender)) {
        throw new Error("Needs the Moderate calls permission to lower all hands");
    }
    return event;
});

// On a podium, the people streaming (the speakers) and those who moderate calls can bring someone from the audience on
// stage, and send them back.
const canBringOnStage = (sender: { megaphoneState: boolean; permissions?: string; tags: string[] }) =>
    sender.megaphoneState || canModerateCalls(sender);

eventProcessor.registerPrivateEventProcessor("inviteToSpeak", (event, sender) => {
    if (!canBringOnStage(sender)) {
        throw new Error("Needs to be speaking or to have the Moderate calls permission to invite someone to speak");
    }
    return event;
});

eventProcessor.registerPrivateEventProcessor("moveToAudience", (event, sender) => {
    if (!canBringOnStage(sender)) {
        throw new Error(
            "Needs to be speaking or to have the Moderate calls permission to move someone to the audience"
        );
    }
    return event;
});
