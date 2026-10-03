import type { BaseTranslation } from "../i18n-types";

const megaphone: BaseTranslation = {
    modal: {
        backToSelectCommunication: "Back to select communication",
        selectCommunication: "Select communication",
        title: "Global communication",
        selectCamera: "Select a camera 📹",
        selectMicrophone: "Select a microphone 🎙️",
        liveMessage: {
            startMegaphone: "Start megaphone",
            stopMegaphone: "Stop megaphone",
            goingToStream: "You are going to stream",
            yourMicrophone: "your microphone",
            yourCamera: "your camera",
            yourScreen: "your screen",
            title: "Megaphone",
            button: "Start live message",
            and: "and",
            toAll: "to all participants",
            confirm: "Confirm",
            cancel: "Cancel",
            notice: `
            The live message or "Megaphone" allows you to send a live message with your camera and microphone to all the people connected in the room or the world.

            This message will be displayer at the bottom corner of the screen, like a video call or bubble discussion.

            An example of a live message use case: "Hello everyone, shall we start the conference? 🎉 Follow my avatar to the conference area and open the video app 🚀"
            `,
            settings: "Settings",
            offInRoom: "Megaphone is off in this room",
            turnOn: "Turn it on",
            offAskEditor: "Megaphone is off in this room. Ask someone who can edit this room to turn it on.",
            notAllowed: "You are not allowed to use the megaphone in this room. Ask a room admin for access.",
        },
        composer: {
            close: "Close",
            tabText: "Text",
            tabAudio: "Audio",
            tabLive: "Live",
            sendTo: "Send to",
            thisRoom: "This room",
            thisRoomHint: "Everyone in this room now",
            wholeWorld: "Whole world",
            wholeWorldHint: "Everyone in every room of this world",
            sendToRoom: "Send to this room",
            sendToWorld: "Send to the whole world",
            sending: "Sending…",
            sendFailed: "The message was not sent. Check your connection and try again.",
            preview: "Preview",
            editMessage: "Edit message",
            previewHint: "This is how the popup will look for everyone who receives it.",
            sentText: "Text message sent",
            sentAudio: "Audio message sent",
            sentToRoom: "Everyone in this room gets it now.",
            sentToWorld: "Everyone in this world gets it now.",
            sendAnother: "Send another",
            done: "Done",
            audioHint: "MP3, OGG or WAV. It plays for everyone as soon as it arrives.",
            replaceFile: "Choose another file",
            liveIntro: "Stream your camera and microphone to everyone, like a stage announcement.",
            liveReachRoom: "Everyone in this room will see and hear you.",
            liveReachWorld: "Everyone in this world will see and hear you.",
            willStream: "You will stream {what}.",
            youAreLive: "You're live",
            liveAudienceRoom: "Everyone in this room can see and hear you.",
            liveAudienceWorld: "Everyone in this world can see and hear you.",
            streaming: "Streaming {what}.",
        },
        textMessage: {
            title: "Text message",
            notice: `
            The text message allows you to send a message to all the people connected in the room or the world.

            This message will be displayed as a popup at the top of the page and will be accompanied by a sound to identify that the information is readable.

            An example of a message: "The conference in room 3 starts in 2 minutes 🎉. You can go to conference area 3 and open the video app 🚀"
            `,
            button: "Send a text message",
            noAccess: "You don't have access to this feature 😱 Please contact the administrator 🙏",
        },
        audioMessage: {
            title: "Audio message",
            notice: `
            The audio message is a message of type "MP3, OGG..." sent to all users connected in the room or in the world.

            This audio message will be downloaded and launched to all people receiving this notification.

            An audio message can consist of an audio recording that indicates a conference will begin in a few minutes.
            `,
            button: "Send an audio message",
            noAccess: "You don't have access to this feature 😱 Please contact the administrator 🙏",
        },
    },
};

export default megaphone;
