import { get } from "svelte/store";
import type { ObjectSoundMessage } from "@workadventure/messages";
import { AudioPlayback } from "../../Components/AudioManager/AudioPlayback";
import { localUserStore } from "../../Connection/LocalUserStore";
import type { RoomConnection } from "../../Connection/RoomConnection";
import {
    audioManagerFileStore,
    audioManagerRetryPlaySubject,
    audioManagerVisibilityStore,
    audioManagerVolumeStore,
} from "../../Stores/AudioManagerStore";
import { ObjectSounds } from "./ObjectSounds";
import { playableSoundLink } from "./MapEditor/uploadedSoundLink";
import { soundLength } from "./soundLength";
import type { GameScene } from "./GameScene";

/**
 * The objects' sounds of this scene (#1627), wired to the game: the player's position, the music controls, "Block
 * audio", the server's shared sounds and the map's objects. Returns a function that stops them all.
 */
export function startObjectSounds(
    scene: GameScene,
    connection: RoomConnection,
    initial: ObjectSoundMessage[]
): { objectSounds: ObjectSounds; stop: () => void } {
    const entitiesManager = scene.getGameMapFrontWrapper().getEntitiesManager();
    // The sounds' media sit in the page like the room music's
    const audioContainer = document.createElement("div");
    audioContainer.hidden = true;
    audioContainer.dataset.testid = "object-sounds";
    document.body.append(audioContainer);
    // The events that let a browser start a sound, as for the room music: iPhone counts a touch when the finger lifts
    // (a pointerdown from a finger does not count there), a mouse when its button goes down.
    const gestures = ["pointerdown", "pointerup", "touchend", "keydown"] as const;
    const disarmGestures = () => {
        for (const type of gestures) window.removeEventListener(type, retryOnGesture, { capture: true });
    };
    const retryOnGesture = (event: Event) => {
        const pointerType = (event as PointerEvent).pointerType;
        if (pointerType !== undefined && (event.type === "pointerdown") !== (pointerType === "mouse")) {
            return;
        }
        disarmGestures();
        objectSounds.retry();
    };
    const objectSounds = new ObjectSounds(
        {
            objects: function* () {
                for (const entity of entitiesManager.getEntities().values()) {
                    const center = entity.getCenter();
                    yield { id: entity.entityId, x: center.x, y: center.y, properties: entity.getProperties() };
                }
            },
            tileSize: () => scene.getGameMapFrontWrapper().getTileDimensions().width,
            createVoice: (onEnded, onNotAllowed) =>
                new AudioPlayback(
                    (state) => {
                        if (state === "not_allowed") onNotAllowed();
                    },
                    onEnded,
                    undefined,
                    undefined,
                    audioContainer
                ),
            playableLink: (link) =>
                playableSoundLink(new URL(link, scene.getMapUrl()).toString(), scene.room.mapStorageUrl, () =>
                    connection.queryMapStorageJwtToken()
                ),
            soundLength,
            emitClick: (message) => connection.emitClickObjectSound(message),
            blocked: () => localUserStore.getBlockAudio(),
            onAudible: (audible) => {
                // The music controls cover the objects' sounds: they show while one can be heard
                if (audible && get(audioManagerVisibilityStore) === "hidden") {
                    audioManagerVisibilityStore.set("visible");
                } else if (
                    !audible &&
                    get(audioManagerFileStore) === "" &&
                    get(audioManagerVisibilityStore) === "visible"
                ) {
                    audioManagerVisibilityStore.set("hidden");
                }
            },
            onNotAllowed: () => {
                audioManagerVisibilityStore.set("visible");
                for (const type of gestures) {
                    window.addEventListener(type, retryOnGesture, { capture: true, passive: true });
                }
            },
        },
        initial,
        connection.objectSoundMessageStream
    );
    objectSounds.setListenerPosition(scene.CurrentPlayer.x, scene.CurrentPlayer.y);
    const unsubscribeControls = audioManagerVolumeStore.subscribe((controls) => objectSounds.setControls(controls));
    const retrySubscription = audioManagerRetryPlaySubject.subscribe(() => objectSounds.retry());
    const entitiesSubscription = entitiesManager.entitiesChanged.subscribe(() => objectSounds.refresh());
    return {
        objectSounds,
        stop: () => {
            unsubscribeControls();
            retrySubscription.unsubscribe();
            entitiesSubscription.unsubscribe();
            disarmGestures();
            objectSounds.destroy();
            audioContainer.remove();
        },
    };
}
