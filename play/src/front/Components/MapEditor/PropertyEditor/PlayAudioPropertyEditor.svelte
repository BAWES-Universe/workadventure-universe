<script lang="ts">
    import { createEventDispatcher, onDestroy } from "svelte";
    import { get } from "svelte/store";
    import { v4 as uuidv4 } from "uuid";
    import type { GameObjects, Math as PhaserMath } from "phaser";
    import * as Sentry from "@sentry/svelte";
    import type { ObjectSoundSettings, PlayAudioPropertyData } from "@workadventure/map-editor";
    import { objectSoundHasRange, objectSoundSettings, UPLOADED_FILE_FORMATS } from "@workadventure/map-editor";
    import { UploadedFileKind } from "@workadventure/messages";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { GRPC_MAX_MESSAGE_SIZE } from "../../../Enum/EnvironmentVariable";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { gameSceneStore } from "../../../Stores/GameSceneStore";
    import { mapEditorSelectedEntityStore } from "../../../Stores/MapEditorStore";
    import { UploadFileFrontCommand } from "../../../Phaser/Game/MapEditor/Commands/File/UploadFileFrontCommand";
    import { playableSoundLink, uploadedSoundLink } from "../../../Phaser/Game/MapEditor/uploadedSoundLink";
    import { soundLength } from "../../../Phaser/Game/soundLength";
    import PropertyEditorBase from "./PropertyEditorBase.svelte";
    import PanelSwitch from "./PanelSwitch.svelte";
    import { IconCloudUpload, IconFileMusic, IconPlayerPlayFilled, IconPlayerStopFilled } from "@wa-icons";

    export let property: PlayAudioPropertyData;
    export let isArea = false;
    let optionAdvancedActivated = false;

    const dispatch = createEventDispatcher<{
        change: undefined;
        close: undefined;
        audioLink: PlayAudioPropertyData;
    }>();

    const SOUND_FORMAT = UPLOADED_FILE_FORMATS[UploadedFileKind.Sound];
    const BYTES_TO_MB = 1024 * 1024;

    let HTMLAudioPlayer: HTMLAudioElement;
    let fileInput: HTMLInputElement;
    let playing = false;
    let errorMessage = "";

    // Uploads go through the map editor's own rights, as "Open file" uploads do
    const canUpload = gameManager.getCurrentGameScene()?.connection?.userCanEdit ?? false;

    $: volumePercent = Math.round((property.volume ?? 1) * 100);

    // An object's sound (#1627): when it starts, who hears it, whether it loops, and how far it carries
    const tileSize = gameManager.getCurrentGameScene()?.getGameMapFrontWrapper().getTileDimensions().width ?? 32;
    $: settings = objectSoundSettings(property, tileSize);
    let loop = objectSoundSettings(property, tileSize).loop;
    const startChoices = [
        {
            value: "range" as const,
            title: $LL.mapEditor.properties.playAudio.startsInRange(),
            description: $LL.mapEditor.properties.playAudio.startsInRangeDescription(),
        },
        {
            value: "click" as const,
            title: $LL.mapEditor.properties.playAudio.startsOnClick(),
            description: $LL.mapEditor.properties.playAudio.startsOnClickDescription(),
        },
    ];
    const hearerChoices = [
        { value: "clicker" as const, title: $LL.mapEditor.properties.playAudio.heardByClicker() },
        { value: "range" as const, title: $LL.mapEditor.properties.playAudio.heardByRange() },
        { value: "map" as const, title: $LL.mapEditor.properties.playAudio.heardByMap() },
    ];

    /**
     * Writes every choice into the property as the panel shows it, so that a sound saved before #1627 (or made in
     * upstream WorkAdventure) keeps what it does once someone edits it.
     */
    function writeSettings(changes: Partial<ObjectSoundSettings>) {
        const next = { ...objectSoundSettings(property, tileSize), ...changes };
        property.startsOn = next.startsOn;
        property.heardBy = next.heardBy;
        property.loop = next.loop;
        property.fullVolumeWithin = next.fullVolumeWithin;
        property.heardUpTo = Math.max(next.fullVolumeWithin, next.heardUpTo);
        property.clickWait = next.clickWait;
        delete property.playForAllUsers;
        delete property.audibleRadius;
        loop = next.loop;
        onValueChange();
    }

    function setStartsOn(startsOn: ObjectSoundSettings["startsOn"]) {
        // A fireplace loops; a clicked sound plays once
        writeSettings({ startsOn, loop: startsOn === "range" });
    }

    function onNumberChange(field: "fullVolumeWithin" | "heardUpTo" | "clickWait", event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        const value = Number(input.value);
        if (input.value === "" || !Number.isFinite(value) || value < 0) {
            input.value = String(settings[field]);
            return;
        }
        writeSettings({ [field]: value });
    }

    // While the panel is open, two circles around the object show "Full volume within" and "Heard up to"
    let circles: GameObjects.Graphics | undefined;
    $: drawCircles(isArea ? undefined : settings, $mapEditorSelectedEntityStore?.getCenter());

    function drawCircles(settings: ObjectSoundSettings | undefined, center: PhaserMath.Vector2 | undefined) {
        const scene = gameManager.getCurrentGameScene();
        if (!scene || !settings || !center || !objectSoundHasRange(settings)) {
            circles?.clear();
            return;
        }
        circles ??= scene.add.graphics().setDepth(Number.MAX_SAFE_INTEGER);
        circles.clear();
        circles.fillStyle(0x4156f6, 0.08).fillCircle(center.x, center.y, settings.heardUpTo * tileSize);
        circles.lineStyle(2, 0x4156f6, 0.9).strokeCircle(center.x, center.y, settings.heardUpTo * tileSize);
        circles.fillStyle(0x8629fc, 0.18).fillCircle(center.x, center.y, settings.fullVolumeWithin * tileSize);
        circles.lineStyle(2, 0x8629fc, 1).strokeCircle(center.x, center.y, settings.fullVolumeWithin * tileSize);
        scene.markDirty();
    }

    onDestroy(() => {
        circles?.destroy();
        gameManager.getCurrentGameScene()?.markDirty();
    });

    async function playAudio() {
        if (!property.audioLink) {
            if (HTMLAudioPlayer) HTMLAudioPlayer.pause();
            return;
        }
        HTMLAudioPlayer.pause();
        errorMessage = "";
        try {
            const scene = gameManager.getCurrentGameScene();
            const connection = scene?.connection;
            const src = await playableSoundLink(
                property.audioLink,
                scene?.room.mapStorageUrl,
                connection ? () => connection.queryMapStorageJwtToken() : undefined
            );
            const player = HTMLAudioPlayer;
            player.src = src;
            if (property.volume !== undefined) {
                player.volume = property.volume;
            }

            player.onended = () => {
                playing = false;
            };

            await player.play();
            playing = true;
        } catch (error) {
            playing = false;
            if (error instanceof DOMException) {
                errorMessage = $LL.mapEditor.properties.playAudio.error() + ": " + error.message;
            } else {
                errorMessage = $LL.mapEditor.properties.playAudio.error();
            }
            console.error(error);
        }
    }

    function stopAudio() {
        if (HTMLAudioPlayer) HTMLAudioPlayer.pause();
        playing = false;
    }

    function onValueChange() {
        errorMessage = "";
        // A sound saved before its length was kept gets it with its next change
        if (
            !isArea &&
            property.audioLink &&
            property.durationSeconds === undefined &&
            measuringLink !== property.audioLink
        ) {
            measureLinkLength(property.audioLink);
        }
        dispatch("change");
        // Fixme: this is a hack to force the map editor to update the property
        dispatch("audioLink", property);
    }

    /**
     * An object's sound keeps its length in the map (#1627), so that the server knows when a sound others hear ends.
     * It is measured from the sound's own metadata once the sound is set, then saved like any other change.
     */
    let measuringLink: string | undefined;

    function measureLength(audioLink: string, source: Promise<string>, cleanUp?: () => void) {
        if (isArea) {
            cleanUp?.();
            return;
        }
        measuringLink = audioLink;
        delete property.durationSeconds;
        source
            .then((url) => soundLength(url))
            .then((seconds) => {
                // The sound was changed again meanwhile: that change measures its own
                if (property.audioLink !== audioLink) {
                    return;
                }
                if (seconds > 0) {
                    property.durationSeconds = seconds;
                    onValueChange();
                }
            })
            .catch((error) => console.error("Could not tell how long the sound lasts", error))
            .finally(() => {
                if (measuringLink === audioLink) {
                    measuringLink = undefined;
                }
                cleanUp?.();
            });
    }

    function measureLinkLength(audioLink: string) {
        const scene = gameManager.getCurrentGameScene();
        const connection = scene?.connection;
        measureLength(
            audioLink,
            Promise.resolve().then(() =>
                playableSoundLink(
                    audioLink,
                    scene?.room.mapStorageUrl,
                    connection ? () => connection.queryMapStorageJwtToken() : undefined
                )
            )
        );
    }

    function onLinkChange() {
        // A pasted link replaces the uploaded sound, which map-storage then deletes
        if (property.audioName) {
            property.audioName = null;
        }
        stopAudio();
        if (property.audioLink) {
            measureLinkLength(property.audioLink);
        }
        onValueChange();
    }

    function onVolumeInput(event: Event) {
        property.volume = Number((event.currentTarget as HTMLInputElement).value) / 100;
        if (HTMLAudioPlayer) {
            HTMLAudioPlayer.volume = property.volume;
        }
        onValueChange();
    }

    async function uploadSound(file: File): Promise<void> {
        errorMessage = "";
        if (!SOUND_FORMAT.extensions.test(file.name)) {
            errorMessage = $LL.mapEditor.properties.openFile.uploadFile.errorOnFileFormat();
            return;
        }
        if (file.size > GRPC_MAX_MESSAGE_SIZE) {
            errorMessage = $LL.mapEditor.properties.openFile.uploadFile.errorOnFileSize({
                size: GRPC_MAX_MESSAGE_SIZE / BYTES_TO_MB,
            });
            return;
        }
        const mapStorageUrl = get(gameSceneStore)?.room.mapStorageUrl;
        const connection = gameManager.getCurrentGameScene()?.connection;
        if (!mapStorageUrl || !connection) {
            throw new Error("Map storage is not available");
        }

        new UploadFileFrontCommand({
            id: uuidv4(),
            file: new Uint8Array(await file.arrayBuffer()),
            name: file.name,
            propertyId: property.id,
            kind: UploadedFileKind.Sound,
        }).emitEvent(connection);

        stopAudio();
        property.audioName = file.name;
        property.audioLink = uploadedSoundLink(mapStorageUrl, file.name, property.id);
        // Measured from the chosen file itself, before it has reached the map
        const fileUrl = URL.createObjectURL(file);
        measureLength(property.audioLink, Promise.resolve(fileUrl), () => URL.revokeObjectURL(fileUrl));
        onValueChange();
    }

    function onFileChosen() {
        const file = fileInput.files?.item(0);
        fileInput.value = "";
        if (!file) {
            return;
        }
        uploadSound(file).catch((error) => {
            console.error("Error uploading a sound:", error);
            Sentry.captureException(error);
            errorMessage = $LL.mapEditor.properties.playAudio.error();
        });
    }
</script>

<PropertyEditorBase
    on:close={() => {
        dispatch("close");
    }}
>
    <span slot="header" class="flex justify-center items-center">
        <IconFileMusic font-size="18" class="mr-2" />
        {$LL.mapEditor.properties.playAudio.label()}
    </span>
    <span slot="content" class="op">
        <div class="op-field">
            <label for="audioLink" class="op-label">{$LL.mapEditor.properties.playAudio.audioLinkLabel()}</label>
            <div class="op-line">
                <div class="u-join-field op-link" class:u-join-field-error={errorMessage !== ""}>
                    <IconFileMusic font-size="18" class="flex-none text-white/75" />
                    <input
                        id="audioLink"
                        type="text"
                        placeholder={$LL.mapEditor.properties.playAudio.audioLinkPlaceholder()}
                        bind:value={property.audioLink}
                        on:change={onLinkChange}
                    />
                </div>
                <button
                    type="button"
                    class="u-cta-secondary op-round"
                    data-testid="listenToSound"
                    aria-label={playing
                        ? $LL.mapEditor.properties.playAudio.stopListening()
                        : $LL.mapEditor.properties.playAudio.listen()}
                    disabled={!property.audioLink}
                    on:click={() => (playing ? stopAudio() : playAudio())}
                >
                    {#if playing}
                        <IconPlayerStopFilled font-size="18" />
                    {:else}
                        <IconPlayerPlayFilled font-size="18" />
                    {/if}
                </button>
            </div>
            <audio class="audio-manager-audioplayer" bind:this={HTMLAudioPlayer} />
            {#if errorMessage}
                <div class="u-error-line">{errorMessage}</div>
            {/if}
            {#if canUpload}
                <div class="op-line">
                    <button
                        type="button"
                        class="u-cta-secondary op-pill"
                        data-testid="uploadSound"
                        on:click={() => fileInput.click()}
                    >
                        <IconCloudUpload font-size="18" />
                        {$LL.mapEditor.properties.playAudio.uploadSound()}
                    </button>
                    <input
                        bind:this={fileInput}
                        type="file"
                        class="hidden"
                        data-testid="uploadSoundInput"
                        accept={SOUND_FORMAT.accept}
                        on:change={onFileChosen}
                    />
                </div>
                <p class="op-hint">{$LL.mapEditor.properties.playAudio.uploadHint()}</p>
            {/if}
        </div>

        {#if !isArea}
            <div class="op-field" role="radiogroup" aria-label={$LL.mapEditor.properties.playAudio.whenItStarts()}>
                <span class="op-label">{$LL.mapEditor.properties.playAudio.whenItStarts()}</span>
                {#each startChoices as choice (choice.value)}
                    <button
                        type="button"
                        class="u-option op-opt"
                        class:u-selected={settings.startsOn === choice.value}
                        role="radio"
                        aria-checked={settings.startsOn === choice.value}
                        data-testid="soundStarts-{choice.value}"
                        on:click={() => setStartsOn(choice.value)}
                    >
                        <span class="u-option-text">
                            <span class="u-option-title block">{choice.title}</span>
                            <span class="u-option-desc block">{choice.description}</span>
                        </span>
                        <span class="u-radio" aria-hidden="true" />
                    </button>
                {/each}
            </div>

            {#if settings.startsOn === "click"}
                <div class="op-field" role="radiogroup" aria-label={$LL.mapEditor.properties.playAudio.whoHearsIt()}>
                    <span class="op-label">{$LL.mapEditor.properties.playAudio.whoHearsIt()}</span>
                    {#each hearerChoices as choice (choice.value)}
                        <button
                            type="button"
                            class="u-option op-opt"
                            class:u-selected={settings.heardBy === choice.value}
                            role="radio"
                            aria-checked={settings.heardBy === choice.value}
                            data-testid="soundHeardBy-{choice.value}"
                            on:click={() => writeSettings({ heardBy: choice.value })}
                        >
                            <span class="u-option-text"><span class="u-option-title block">{choice.title}</span></span>
                            <span class="u-radio" aria-hidden="true" />
                        </button>
                    {/each}
                </div>
            {/if}

            <div class="op-field">
                <PanelSwitch
                    id="soundLoop"
                    label={$LL.mapEditor.properties.playAudio.loopIt()}
                    bind:value={loop}
                    onChange={() => writeSettings({ loop })}
                />
                <p class="op-hint">
                    {settings.startsOn === "click"
                        ? settings.loop
                            ? $LL.mapEditor.properties.playAudio.loopOnClick()
                            : $LL.mapEditor.properties.playAudio.onceOnClick()
                        : settings.loop
                        ? $LL.mapEditor.properties.playAudio.loopInRange()
                        : $LL.mapEditor.properties.playAudio.onceInRange()}
                </p>
            </div>

            {#if objectSoundHasRange(settings)}
                <div class="op-field">
                    <span class="op-label">{$LL.mapEditor.properties.playAudio.distance()}</span>
                    <div class="op-pair">
                        <label class="op-num">
                            <span>{$LL.mapEditor.properties.playAudio.fullVolumeWithin()}</span>
                            <span class="u-join-field">
                                <input
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    data-testid="soundFullVolumeWithin"
                                    value={settings.fullVolumeWithin}
                                    on:change={(event) => onNumberChange("fullVolumeWithin", event)}
                                />
                                <em>{$LL.mapEditor.properties.playAudio.tiles()}</em>
                            </span>
                        </label>
                        <label class="op-num">
                            <span>{$LL.mapEditor.properties.playAudio.heardUpTo()}</span>
                            <span class="u-join-field">
                                <input
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    data-testid="soundHeardUpTo"
                                    value={settings.heardUpTo}
                                    on:change={(event) => onNumberChange("heardUpTo", event)}
                                />
                                <em>{$LL.mapEditor.properties.playAudio.tiles()}</em>
                            </span>
                        </label>
                    </div>
                    <p class="op-hint">
                        {$LL.mapEditor.properties.playAudio.distanceHint({
                            fullVolumeWithin: settings.fullVolumeWithin,
                            heardUpTo: settings.heardUpTo,
                        })}
                    </p>
                </div>
            {/if}

            {#if settings.startsOn === "click"}
                <div class="op-field">
                    <label class="op-num op-num-wide">
                        <span>{$LL.mapEditor.properties.playAudio.clickWait()}</span>
                        <span class="u-join-field">
                            <input
                                type="number"
                                min="0"
                                step="1"
                                data-testid="soundClickWait"
                                value={settings.clickWait}
                                on:change={(event) => onNumberChange("clickWait", event)}
                            />
                            <em>{$LL.mapEditor.properties.playAudio.seconds()}</em>
                        </span>
                    </label>
                    <p class="op-hint">{$LL.mapEditor.properties.playAudio.clickWaitHint()}</p>
                </div>
            {/if}
        {/if}

        <div class="op-slider">
            <div class="op-slider-top">
                <label for="volume">{$LL.mapEditor.properties.playAudio.volumeLabel()}</label>
                <span class="op-slider-value">{volumePercent} %</span>
            </div>
            <div class="op-track">
                <div class="op-track-fill" style="width: {volumePercent}%" />
                <div class="op-track-thumb" style="left: {volumePercent}%" />
                <input
                    id="volume"
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={volumePercent}
                    on:input={onVolumeInput}
                />
            </div>
        </div>

        <!-- Nobody clicks a sound that plays in range -->
        {#if !isArea && settings.startsOn === "click"}
            <PanelSwitch
                id="advancedOption"
                strong
                label={$LL.mapEditor.properties.advancedOptions()}
                bind:value={optionAdvancedActivated}
            />
            <div class:active={optionAdvancedActivated} class="advanced-option op-group">
                <div class="op-field">
                    <label for="triggerMessage" class="op-label"
                        >{$LL.mapEditor.properties.openWebsite.triggerMessage()}</label
                    >
                    <div class="u-join-field">
                        <input
                            id="triggerMessage"
                            type="text"
                            placeholder={$LL.trigger.object()}
                            bind:value={property.triggerMessage}
                            on:change={onValueChange}
                        />
                    </div>
                </div>
                {#if !property.hideButtonLabel}
                    <div class="op-field">
                        <label for="audioButtonLabel" class="op-label">{$LL.mapEditor.entityEditor.buttonLabel()}</label
                        >
                        <div class="u-join-field">
                            <input
                                id="audioButtonLabel"
                                type="text"
                                bind:value={property.buttonLabel}
                                on:change={onValueChange}
                            />
                        </div>
                    </div>
                {/if}
            </div>
        {/if}
    </span>
</PropertyEditorBase>

<style lang="scss">
    .op {
        display: flex;
        flex-direction: column;
        gap: 14px;
        min-width: 0;
    }
    .op-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
    }
    .op-label {
        padding-inline-start: 2px;
        font-size: 0.8125rem;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.72);
    }
    .op-line {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    .op-link {
        flex: 1 1 0;
        min-width: 0;
    }
    .op-round,
    .op-pill {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 3rem;
        margin: 0;
        border-radius: 999px;
        font: inherit;
        font-size: 0.8125rem;
        font-weight: 600;
        cursor: pointer;
    }
    .op-round {
        width: 3rem;
        padding: 0;
        &:disabled {
            opacity: 0.4;
            cursor: default;
        }
    }
    .op-pill {
        padding: 0 16px;
    }
    .op-hint {
        margin: 0;
        padding-inline-start: 2px;
        font-size: 0.75rem;
        line-height: 1.4;
        color: rgba(255, 255, 255, 0.55);
    }
    .op-opt {
        padding: 12px 14px;
    }
    .op-pair {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 8px;
    }
    .op-num {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
        font-size: 0.8125rem;
        color: rgba(255, 255, 255, 0.85);
        em {
            font-style: normal;
            font-size: 0.8125rem;
            color: rgba(255, 255, 255, 0.55);
        }
        input {
            -moz-appearance: textfield;
            appearance: textfield;
            min-width: 0;
            width: 100%;
        }
    }
    .op-num-wide .u-join-field {
        max-width: 12rem;
    }
    .advanced-option {
        display: none;

        &.active {
            display: flex;
        }
    }
    .op-group {
        flex-direction: column;
        gap: 12px;
        padding: 12px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.04);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
    }
    .op-slider {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .op-slider-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 0.9375rem;
    }
    .op-slider-value {
        padding: 3px 10px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font-size: 0.8125rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
    }
    .op-track {
        position: relative;
        height: 6px;
        margin-inline: 11px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.14);
    }
    .op-track-fill {
        position: absolute;
        inset-block: 0;
        inset-inline-start: 0;
        border-radius: 999px;
        background: linear-gradient(90deg, #8629fc, #4156f6);
    }
    .op-track-thumb {
        position: absolute;
        top: -8px;
        width: 22px;
        height: 22px;
        margin-inline-start: -11px;
        border-radius: 999px;
        background: #fff;
        box-shadow: 0 0 0 4px rgba(134, 41, 252, 0.25), 0 2px 6px rgba(0, 0, 0, 0.4);
        pointer-events: none;
    }
    .op-track input {
        position: absolute;
        /* The tap area is the 44px band around the track */
        inset-block: -19px;
        inset-inline: -11px;
        width: calc(100% + 22px);
        height: 44px;
        margin: 0;
        opacity: 0;
        cursor: pointer;
    }
</style>
