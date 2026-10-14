/**
 * On a phone, the microphone is kept closed while nobody can hear it.
 *
 * An open microphone costs a phone more than it costs a computer: iOS plays a sound each time the game starts or stops
 * using the microphone, and shows its orange dot for as long as it is open. Leaving the app and coming back closed the
 * microphone and opened it again, so it played those sounds with nobody near. With the microphone closed while alone
 * there is nothing to close or open, and it opens when a bubble, a live session or a screen that needs it starts.
 */
export interface MicrophoneNeeds {
    /** People in the bubble with the player (their video boxes). */
    peers: number;
    /** Speaking or answering in a live session (megaphone, a space, a meeting room). */
    live: boolean;
    speaker: boolean;
    listener: boolean;
    inLivekit: boolean;
    /** The megaphone is on, or its set-up screen is open (it shows the microphone's level). */
    megaphone: boolean;
    /** The camera and microphone set-up screen is open (it shows the microphone's level). */
    setupScreen: boolean;
}

/** Whether a phone can leave its microphone closed right now. */
export function phoneMicrophoneCanRest(needs: MicrophoneNeeds): boolean {
    return (
        needs.peers === 0 &&
        !needs.live &&
        !needs.speaker &&
        !needs.listener &&
        !needs.inLivekit &&
        !needs.megaphone &&
        !needs.setupScreen
    );
}
