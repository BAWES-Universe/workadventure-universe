import type { BaseTranslation } from "../i18n-types";

const area: BaseTranslation = {
    noAccess: "Sorry, you don't have access to this area.",
    // A room with "Max people" that is full (#1621)
    full: "The {name} is full right now",
    fullUnnamed: "This room is full right now",
    fullLabel: "Full · {count:number}/{max:number}",
    // A lockable room that is locked (#1622)
    locked: "The {name} is locked right now",
    lockedUnnamed: "This room is locked right now",
    lockedLabel: "Locked",
    unlockHint: "Press [SPACE] to unlock the {name}",
    unlockHintUnnamed: "Press [SPACE] to unlock this room",
    youLocked: "You locked the {name}",
    youLockedUnnamed: "You locked this room",
    lockRoom: "Lock room",
    unlockRoom: "Unlock room",
    // In the Audience of a Stage that sees the audience's cameras (#1623)
    speakersSeeYourCamera: "The speakers can see your camera",
    personalArea: {
        claimDescription: "This is a personal area. Do you want to make it yours?",
        yourName: "Your name",
        buttons: {
            yes: "Yes",
            no: "No",
        },
        personalSpaceWithNames: "{name}'s personal space",
        alreadyHavePersonalArea: "You already have a personal area. Will be deleted if you claim this one.",
    },
};

export default area;
