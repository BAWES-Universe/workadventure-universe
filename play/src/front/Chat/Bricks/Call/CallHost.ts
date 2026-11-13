import { get } from "svelte/store";
import { FilterType } from "@workadventure/messages";
import { botApiService } from "../../../external-modules/bots/services/BotApiService";
import { localUserStore } from "../../../Connection/LocalUserStore";
import { gameSceneStore } from "../../../Stores/GameSceneStore";
import { setCallMicGate } from "../../../Space/CallMicGate";
import { requestedMicrophoneState } from "../../../Stores/MediaStore";
import { botCallStore } from "./CallStore";
import { createCallConnection, type CallSpaceLike } from "./CallConnection";

/**
 * The one call this browser can have with a bot (game #2004), wired to the real game: the bot server, the scene's spaces
 * and the microphone gate. Everything that decides when things happen is in CallConnection.
 */
function spaces() {
    const scene = get(gameSceneStore);
    if (!scene) throw new Error("There is no game scene to join a call in.");
    return scene.spaceRegistry;
}

const callerUuid = (): string => localUserStore.getLocalUser()?.uuid ?? "";

export const callConnection = createCallConnection({
    store: botCallStore,
    startCall: (botId) =>
        callerUuid() === ""
            ? Promise.resolve({ started: false as const, failure: "sign_in" as const })
            : botApiService.startCall(botId, callerUuid()),
    endCall: (botId) => botApiService.endCall(botId, callerUuid()),
    // Audio and nothing else: the call's space is no bubble on the map, and the gate keeps the camera out of it
    joinSpace: (spaceName, signal) =>
        spaces().joinSpace(
            spaceName,
            FilterType.ALL_USERS,
            ["cameraState", "microphoneState", "screenShareState"],
            signal
        ) as Promise<CallSpaceLike>,
    leaveSpace: (space) => spaces().leaveSpace(space as never),
    setGate: setCallMicGate,
    microphone: {
        isOn: () => get(requestedMicrophoneState),
        turnOn: () => requestedMicrophoneState.enableMicrophone(),
        turnOff: () => requestedMicrophoneState.disableMicrophone(),
    },
    now: () => Date.now(),
});

// A call that ended by itself says why for a few seconds, then goes; one the person or the bot ended just goes
let clearing: ReturnType<typeof setTimeout> | undefined;
// Lives as long as the page does
export const stopClearingEndedCalls = botCallStore.subscribe((call) => {
    if (call?.state.phase !== "ended") {
        if (clearing) clearTimeout(clearing);
        clearing = undefined;
        return;
    }
    if (clearing) return;
    const says = call.state.endedBy === "quiet" || call.state.endedBy === "unavailable";
    clearing = setTimeout(
        () => {
            clearing = undefined;
            botCallStore.clear();
        },
        says ? 6000 : 0
    );
});
