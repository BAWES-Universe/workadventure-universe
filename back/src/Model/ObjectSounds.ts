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
 * The server does not read the map: the clicker's map gives the loop, the length and the wait, and every player
 * checks the object's sound in their own map before playing anything (see ObjectSounds in the front).
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
        const playing = this.sounds.get(key);
        if (playing?.loop) {
            this.sounds.delete(key);
            this.send({ entityId, propertyId, playing: false, loop: true, elapsedSeconds: 0 });
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
        this.send({ entityId, propertyId, playing: true, loop: message.loop, elapsedSeconds: 0 });
    }

    /** The sounds still playing, for a player who arrives */
    public getMessages(): ObjectSoundMessage[] {
        const now = this.now();
        const messages: ObjectSoundMessage[] = [];
        for (const [key, sound] of this.sounds) {
            if (!sound.loop && now >= sound.startedAt + sound.durationMs) {
                if (now >= sound.startedAt + sound.durationMs + sound.waitMs) {
                    this.sounds.delete(key);
                }
                continue;
            }
            messages.push({
                entityId: sound.entityId,
                propertyId: sound.propertyId,
                playing: true,
                loop: sound.loop,
                elapsedSeconds: (now - sound.startedAt) / 1000,
            });
        }
        return messages;
    }
}

function isLength(seconds: number): boolean {
    return Number.isFinite(seconds) && seconds >= 0;
}
