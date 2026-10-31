import type { Observable, Subscription } from "rxjs";
import type { EntityDataProperties, ObjectSoundSettings, PlayAudioPropertyData } from "@workadventure/map-editor";
import { objectSoundGain, objectSoundSettings } from "@workadventure/map-editor";
import type { ClickObjectSoundMessage, ObjectSoundMessage } from "@workadventure/messages";
import type { AudioControls, AudioSource } from "../../Components/AudioManager/AudioPlayback";

/** An object on the map that may hold a sound, with its center in pixels. */
export interface SoundObject {
    id: string;
    x: number;
    y: number;
    properties: EntityDataProperties;
}

/** One sound playing (an AudioPlayback in the game). */
export interface Voice {
    setSource(source: AudioSource | undefined): void;
    setControls(controls: AudioControls): void;
    retry(): void;
    destroy(): void;
}

export interface ObjectSoundsDependencies {
    /** The objects of the map, as they are now */
    objects(): Iterable<SoundObject>;
    tileSize(): number;
    createVoice(onEnded: () => void, onNotAllowed: () => void): Voice;
    /** The link to play: an uploaded sound gets the map's access token */
    playableLink(link: string): Promise<string>;
    /** How long a sound lasts, in seconds; 0 when it cannot be told */
    soundLength(link: string): Promise<number>;
    emitClick(message: ClickObjectSoundMessage): void;
    /** "Block audio" in the settings */
    blocked(): boolean;
    /** Some object sound can be heard, or none any more: the music controls show while one can */
    onAudible(audible: boolean): void;
    /** The browser waits for a tap or a click before it plays */
    onNotAllowed(): void;
    now?: () => number;
}

interface Playing {
    objectId: string;
    property: PlayAudioPropertyData;
    settings: ObjectSoundSettings;
    voice?: Voice;
    /** The link played, with its token */
    url?: string;
    /** Waiting for the link with its token */
    pending: boolean;
    loop: boolean;
    /** The sound follows the listener's distance to the object */
    positional: boolean;
    gain: number;
}

/** A clicked sound that everyone it reaches hears, as the server said: when it started here, and whether it loops */
interface SharedSound {
    entityId: string;
    propertyId: string;
    loop: boolean;
    startedAt: number;
}

const keyOf = (objectId: string, propertyId: string) => `${objectId}/${propertyId}`;

/**
 * The sounds of the map's objects (#1627). They mix over the room music: a room's music never stops for them. The
 * music controls' volume, mute and Stop cover them too, and "Block audio" silences them.
 *
 * - "When someone is in range": each player hears it within "Heard up to" of the object, louder as they come closer.
 *   Looping, it plays while they are in range; otherwise it plays once each time they come within range.
 * - "When someone clicks it", for "Only the person who clicked": it plays here only.
 * - For "Everyone within range" or "Everyone on the map", the click goes to the server, which keeps one playing sound
 *   per object and tells everyone (see ObjectSounds in the back). The clicker hears it like everyone else. What is
 *   played always comes from this player's own map, never from the message.
 *
 * A click while a sound plays never restarts it; a click on a looping sound stops it (a jukebox). The wait before a
 * sound can play again is counted from when it ends.
 */
export class ObjectSounds {
    private readonly playing = new Map<string, Playing>();
    private readonly shared = new Map<string, SharedSound>();
    /** Range sounds that play once: the ones this player is in range of now */
    private readonly inRange = new Set<string>();
    private readonly endedAt = new Map<string, number>();
    /**
     * Sounds silenced with the music controls' Stop: a range sound until this player leaves its range, a shared one
     * until it starts again
     */
    private readonly dismissed = new Set<string>();
    private readonly subscription: Subscription;
    private listener: { x: number; y: number } | undefined;
    private controls: AudioControls | undefined;
    private stopped = false;
    private audible = false;
    private destroyed = false;
    private readonly now: () => number;

    constructor(
        private readonly dependencies: ObjectSoundsDependencies,
        initial: ObjectSoundMessage[],
        updates: Observable<ObjectSoundMessage>
    ) {
        this.now = dependencies.now ?? (() => Date.now());
        for (const message of initial) {
            this.onMessage(message);
        }
        this.subscription = updates.subscribe((message) => {
            this.onMessage(message);
            this.update();
        });
    }

    /** The player moved: range sounds start, stop, or change volume */
    public setListenerPosition(x: number, y: number): void {
        this.listener = { x, y };
        this.update();
    }

    /** Objects were placed, moved, changed or removed */
    public refresh(): void {
        this.update();
    }

    public setControls(controls: AudioControls): void {
        // Stop is a one-shot, as for the room music: it stops what plays now, and the next sound plays again
        const stopping = controls.stopped && !this.stopped;
        this.stopped = controls.stopped;
        this.controls = { ...controls, stopped: false };
        for (const playing of this.playing.values()) {
            playing.voice?.setControls(this.controls);
        }
        if (stopping) {
            for (const key of [...this.playing.keys()]) {
                this.dismissed.add(key);
                this.stop(key);
            }
        }
    }

    /** Called in a tap or a click, so that the browser lets the sounds play */
    public retry(): void {
        for (const playing of this.playing.values()) {
            playing.voice?.retry();
        }
    }

    /** Someone clicked the object's "Play a sound" */
    public click(objectId: string, property: PlayAudioPropertyData): void {
        const settings = objectSoundSettings(property, this.dependencies.tileSize());
        if (settings.startsOn !== "click") {
            return;
        }
        if (this.dependencies.blocked()) {
            return;
        }
        const key = keyOf(objectId, property.id);
        if (settings.heardBy !== "clicker") {
            this.clickShared(objectId, property, settings).catch((error) =>
                console.error("Could not play the object's sound", error)
            );
            return;
        }
        const playing = this.playing.get(key);
        if (playing) {
            if (playing.loop) {
                this.stop(key);
            }
            return;
        }
        if (this.now() < (this.endedAt.get(key) ?? -Infinity) + settings.clickWait * 1000) {
            return;
        }
        this.dismissed.delete(key);
        this.start(key, objectId, property, settings, { loop: settings.loop, positional: false, gain: 1 });
    }

    public destroy(): void {
        this.destroyed = true;
        this.subscription.unsubscribe();
        for (const key of [...this.playing.keys()]) {
            this.stop(key);
        }
        this.setAudible(false);
    }

    private async clickShared(
        objectId: string,
        property: PlayAudioPropertyData,
        settings: ObjectSoundSettings
    ): Promise<void> {
        const key = keyOf(objectId, property.id);
        const playing = this.playing.get(key);
        // A click while it plays never restarts it. A looping one is stopped, for everyone, by the server.
        if (playing && !playing.loop) {
            return;
        }
        const durationSeconds = settings.loop
            ? 0
            : await this.dependencies.soundLength(await this.dependencies.playableLink(property.audioLink));
        if (this.destroyed) {
            return;
        }
        this.dependencies.emitClick({
            entityId: objectId,
            propertyId: property.id,
            loop: settings.loop,
            durationSeconds,
            waitSeconds: settings.clickWait,
        });
    }

    private onMessage(message: ObjectSoundMessage): void {
        const key = keyOf(message.entityId, message.propertyId);
        if (!message.playing) {
            this.shared.delete(key);
            this.stop(key);
            return;
        }
        // A new start replaces what played before: the server never restarts a sound that still plays
        this.stop(key);
        this.dismissed.delete(key);
        this.shared.set(key, {
            entityId: message.entityId,
            propertyId: message.propertyId,
            loop: message.loop,
            startedAt: this.now() - message.elapsedSeconds * 1000,
        });
    }

    private update(): void {
        if (this.destroyed) {
            return;
        }
        const tileSize = this.dependencies.tileSize();
        const seen = new Set<string>();
        for (const object of this.dependencies.objects()) {
            for (const property of object.properties) {
                if (property.type !== "playAudio" || !property.audioLink) {
                    continue;
                }
                const key = keyOf(object.id, property.id);
                const settings = objectSoundSettings(property, tileSize);
                const gain = this.gainAt(object, settings, tileSize);
                const shared = this.shared.get(key);
                if (settings.startsOn === "range") {
                    seen.add(key);
                    this.updateRangeSound(key, object, property, settings, gain);
                } else if (shared && settings.heardBy !== "clicker") {
                    seen.add(key);
                    this.updateSharedSound(key, object, property, settings, gain, shared);
                } else if (settings.heardBy === "clicker" && this.playing.get(key)?.settings.startsOn === "click") {
                    // A click the clicker alone hears plays to its end. A range sound switched to click stops.
                    seen.add(key);
                }
            }
        }
        // Sounds whose object or setting is gone
        for (const key of [...this.playing.keys()]) {
            if (!seen.has(key)) {
                this.stop(key);
            }
        }
        for (const key of [...this.inRange]) {
            if (!seen.has(key)) {
                this.inRange.delete(key);
            }
        }
        this.updateAudible();
    }

    private updateRangeSound(
        key: string,
        object: SoundObject,
        property: PlayAudioPropertyData,
        settings: ObjectSoundSettings,
        gain: number
    ): void {
        const playing = this.playing.get(key);
        if (gain <= 0) {
            this.inRange.delete(key);
            this.dismissed.delete(key);
            this.stop(key);
            return;
        }
        if (this.dismissed.has(key)) {
            this.inRange.add(key);
            return;
        }
        const arriving = !this.inRange.has(key);
        this.inRange.add(key);
        if (playing) {
            this.setGain(playing, gain);
            return;
        }
        // Played once: again only after leaving the range and coming back
        if ((settings.loop || arriving) && !this.dependencies.blocked()) {
            this.start(key, object.id, property, settings, { loop: settings.loop, positional: true, gain });
        }
    }

    private updateSharedSound(
        key: string,
        object: SoundObject,
        property: PlayAudioPropertyData,
        settings: ObjectSoundSettings,
        gain: number,
        shared: SharedSound
    ): void {
        const playing = this.playing.get(key);
        // Out of range, nothing loads or plays. Coming back in range picks the sound up where it has got to.
        if (gain <= 0) {
            this.stop(key);
            return;
        }
        if (playing) {
            this.setGain(playing, gain);
            return;
        }
        if (this.dependencies.blocked() || this.dismissed.has(key)) {
            return;
        }
        this.start(key, object.id, property, settings, {
            loop: shared.loop,
            positional: settings.heardBy === "range",
            gain,
            startAt: (this.now() - shared.startedAt) / 1000,
        });
    }

    private start(
        key: string,
        objectId: string,
        property: PlayAudioPropertyData,
        settings: ObjectSoundSettings,
        options: { loop: boolean; positional: boolean; gain: number; startAt?: number }
    ): void {
        const playing: Playing = {
            objectId,
            property,
            settings,
            pending: true,
            loop: options.loop,
            positional: options.positional,
            gain: options.gain,
        };
        this.playing.set(key, playing);
        const requestedAt = this.now();
        // A link that can't be read throws at once: it ends here like any other failure, never stuck as pending
        Promise.resolve()
            .then(() => this.dependencies.playableLink(property.audioLink))
            .then((url) => {
                if (this.playing.get(key) !== playing || this.destroyed) {
                    return;
                }
                const voice = this.dependencies.createVoice(
                    () => this.onEnded(key, playing),
                    () => this.dependencies.onNotAllowed()
                );
                playing.voice = voice;
                playing.url = url;
                playing.pending = false;
                if (this.controls) {
                    voice.setControls(this.controls);
                }
                const startAt =
                    options.startAt === undefined ? undefined : options.startAt + (this.now() - requestedAt) / 1000;
                voice.setSource({ ...this.sourceOf(playing, url), startAt });
                this.updateAudible();
            })
            .catch((error) => {
                console.error("Could not play the object's sound", error);
                if (this.playing.get(key) === playing) {
                    this.playing.delete(key);
                }
            });
    }

    private onEnded(key: string, playing: Playing): void {
        if (this.playing.get(key) !== playing) {
            return;
        }
        this.endedAt.set(key, this.now());
        this.shared.delete(key);
        this.stop(key);
        this.updateAudible();
    }

    private stop(key: string): void {
        const playing = this.playing.get(key);
        if (!playing) {
            return;
        }
        this.playing.delete(key);
        playing.voice?.destroy();
        this.updateAudible();
    }

    private setGain(playing: Playing, gain: number): void {
        if (Math.abs(playing.gain - gain) < 0.001) {
            return;
        }
        playing.gain = gain;
        if (playing.voice && playing.url) {
            playing.voice.setSource(this.sourceOf(playing, playing.url));
        }
        this.updateAudible();
    }

    private sourceOf(playing: Playing, url: string): AudioSource {
        return {
            url,
            loop: playing.loop,
            volume: playing.settings.volume * (playing.positional ? playing.gain : 1),
        };
    }

    private gainAt(object: SoundObject, settings: ObjectSoundSettings, tileSize: number): number {
        if (!this.listener) {
            return settings.startsOn === "range" ? 0 : 1;
        }
        const distance = Math.hypot(this.listener.x - object.x, this.listener.y - object.y) / tileSize;
        return objectSoundGain(settings, distance);
    }

    private updateAudible(): void {
        let audible = false;
        for (const playing of this.playing.values()) {
            if (!playing.pending && (!playing.positional || playing.gain > 0) && playing.settings.volume > 0) {
                audible = true;
                break;
            }
        }
        this.setAudible(audible);
    }

    private setAudible(audible: boolean): void {
        if (audible === this.audible) {
            return;
        }
        this.audible = audible;
        this.dependencies.onAudible(audible);
    }
}
