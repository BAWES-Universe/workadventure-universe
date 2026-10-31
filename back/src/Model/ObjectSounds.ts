import type { WAMFileFormat } from "@workadventure/map-editor";
import { objectSoundSettings } from "@workadventure/map-editor";
import type { ClickObjectSoundMessage, ObjectSoundMessage } from "@workadventure/messages";

interface PlayingSound {
    entityId: string;
    propertyId: string;
    loop: boolean;
    startedAt: number;
    /** 0 when the clicker could not tell */
    durationMs: number;
    waitMs: number;
}

/**
 * The objects' clicked sounds that other people hear (#1627): at most one playing sound per object, shared with
 * everyone in the room. A click on a looping sound stops it (a jukebox). A click while a sound plays, or during the
 * wait after it, never restarts it.
 *
 * The room's saved map says which objects have such a sound, and gives its loop, its wait and its length (see
 * sharedSoundOf): a click on anything else is ignored. Only for a sound saved before its length was kept does the
 * length come from the clicker, who has loaded the sound. Every player still checks the object's sound in their own
 * map before playing anything (see ObjectSounds in the front).
 */
export class ObjectSounds {
    private sounds = new Map<string, PlayingSound>();

    constructor(
        private readonly send: (message: ObjectSoundMessage) => void,
        private readonly now: () => number = () => Date.now()
    ) {}

    public click(message: ClickObjectSoundMessage): void {
        const { entityId, propertyId } = message;
        if (!entityId || !propertyId || !isLength(message.durationSeconds) || !isLength(message.waitSeconds)) {
            return;
        }
        const key = `${entityId}/${propertyId}`;
        const now = this.now();
        this.forgetEnded(now);
        const playing = this.sounds.get(key);
        if (playing?.loop) {
            this.sounds.delete(key);
            this.send({ entityId, propertyId, playing: false, loop: true, elapsedSeconds: 0, durationSeconds: 0 });
            return;
        }
        if (playing && now < playing.startedAt + playing.durationMs + playing.waitMs) {
            return;
        }
        this.sounds.set(key, {
            entityId,
            propertyId,
            loop: message.loop,
            startedAt: now,
            durationMs: message.durationSeconds * 1000,
            waitMs: message.waitSeconds * 1000,
        });
        this.send({
            entityId,
            propertyId,
            playing: true,
            loop: message.loop,
            elapsedSeconds: 0,
            durationSeconds: message.loop ? 0 : message.durationSeconds,
        });
    }

    /** The sounds still playing, for a player who arrives */
    public getMessages(): ObjectSoundMessage[] {
        const now = this.now();
        this.forgetEnded(now);
        const messages: ObjectSoundMessage[] = [];
        for (const sound of this.sounds.values()) {
            if (!sound.loop && now >= sound.startedAt + sound.durationMs) {
                continue;
            }
            messages.push({
                entityId: sound.entityId,
                propertyId: sound.propertyId,
                playing: true,
                loop: sound.loop,
                elapsedSeconds: (now - sound.startedAt) / 1000,
                durationSeconds: sound.loop ? 0 : sound.durationMs / 1000,
            });
        }
        return messages;
    }

    /** Sounds that ended and whose wait is over are forgotten, so the list never grows past what still counts */
    private forgetEnded(now: number): void {
        for (const [key, sound] of this.sounds) {
            if (!sound.loop && now >= sound.startedAt + sound.durationMs + sound.waitMs) {
                this.sounds.delete(key);
            }
        }
    }
}

/**
 * The clicked sound other people hear that this object has in the room's saved map, with its loop, its wait and its
 * length when the map editor measured it, or undefined when it has none: a click the map does not back is ignored.
 */
export function sharedSoundOf(
    wam: WAMFileFormat | undefined,
    entityId: string,
    propertyId: string
): { loop: boolean; waitSeconds: number; durationSeconds?: number } | undefined {
    const entity = wam?.entities[entityId];
    const property = entity?.properties?.find((p) => p.type === "playAudio" && p.id === propertyId);
    if (property?.type !== "playAudio" || !property.audioLink) {
        return undefined;
    }
    // Distances play no part here, so the tile size does not matter
    const settings = objectSoundSettings(property, 1);
    if (settings.startsOn !== "click" || settings.heardBy === "clicker") {
        return undefined;
    }
    const durationSeconds =
        property.durationSeconds !== undefined &&
        Number.isFinite(property.durationSeconds) &&
        property.durationSeconds > 0
            ? property.durationSeconds
            : undefined;
    return { loop: settings.loop, waitSeconds: settings.clickWait, durationSeconds };
}

function isLength(seconds: number): boolean {
    return Number.isFinite(seconds) && seconds >= 0;
}
