import { get } from "svelte/store";
import { FilterType } from "@workadventure/messages";
import { botApiService } from "../../../external-modules/bots/services/BotApiService";
import { localUserStore } from "../../../Connection/LocalUserStore";
import { gameSceneStore } from "../../../Stores/GameSceneStore";
import { setCallMicGate } from "../../../Space/CallMicGate";
import { localVoiceIndicatorStore, requestedMicrophoneState } from "../../../Stores/MediaStore";
import { botCallStore } from "./CallStore";
import { createCallConnection, type CallSpaceLike } from "./CallConnection";
import { createCallRuntime } from "./CallRuntime";
import { nearbyNowFor } from "./NearbyNow";

/**
 * The one call this browser can have with a bot (game #2004), wired to the real game: the bot server, the scene's spaces
 * and the microphone gate. Everything that decides when things happen is in CallConnection.
 */
function currentScene() {
    const scene = get(gameSceneStore);
    if (!scene) throw new Error("There is no game scene to join a call in.");
    return scene;
}

// The scene the call was asked for in. The call's space belongs to that scene's registry: if the person moved to
// another room meanwhile, the call is not joined (it ends as unavailable), and it is left where it was joined.
let callScene: ReturnType<typeof currentScene> | undefined;

const callerUuid = (): string => localUserStore.getLocalUser()?.uuid ?? "";

export const callConnection = createCallConnection({
    store: botCallStore,
    startCall: (botId) => {
        if (callerUuid() === "") return Promise.resolve({ started: false as const, failure: "sign_in" as const });
        callScene = get(gameSceneStore) ?? undefined;
        return botApiService.startCall(botId, callerUuid());
    },
    endCall: (botId) => botApiService.endCall(botId, callerUuid()),
    // Audio and nothing else: the call's space is no bubble on the map, and the gate keeps the camera out of it
    joinSpace: (spaceName, signal) => {
        const scene = currentScene();
        if (scene !== callScene)
            return Promise.reject(new Error("The person left the room the call was asked for in."));
        return scene.spaceRegistry.joinSpace(
            spaceName,
            FilterType.ALL_USERS,
            ["cameraState", "microphoneState", "screenShareState"],
            signal
        ) as Promise<CallSpaceLike>;
    },
    leaveSpace: (space) => (callScene ?? currentScene()).spaceRegistry.leaveSpace(space as never),
    setGate: setCallMicGate,
    microphone: {
        isOn: () => get(requestedMicrophoneState),
        turnOn: () => requestedMicrophoneState.enableMicrophone(),
        turnOff: () => requestedMicrophoneState.disableMicrophone(),
    },
    now: () => Date.now(),
});

// A call that ended by itself says why for a few seconds, then goes (the bot leaving the call is the voice being gone:
// the same line as when it is not available); one the person ended just goes
let clearing: ReturnType<typeof setTimeout> | undefined;
// Lives as long as the page does
export const stopClearingEndedCalls = botCallStore.subscribe((call) => {
    if (call?.state.phase !== "ended") {
        if (clearing) clearTimeout(clearing);
        clearing = undefined;
        return;
    }
    if (clearing) return;
    const says = call.state.endedBy === "quiet" || call.state.endedBy === "unavailable" || call.state.endedBy === "bot";
    clearing = setTimeout(
        () => {
            clearing = undefined;
            botCallStore.clear();
        },
        says ? 6000 : 0
    );
});

/**
 * What goes on around a live call: the quiet stretch's clock, the person's own voice, someone walking up, a meeting.
 * Lives as long as the page does, and does nothing while there is no call.
 */
export const callRuntime = createCallRuntime({
    store: botCallStore,
    nearby: nearbyNowFor(() => ({
        uuid: localUserStore.getLocalUser()?.uuid,
        chatId: localUserStore.getChatId() ?? undefined,
    })),
    speaking: localVoiceIndicatorStore,
    now: () => Date.now(),
});
