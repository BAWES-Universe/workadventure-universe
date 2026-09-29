<script lang="ts">
    import { onDestroy } from "svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { AdminMessageEventTypes } from "../../Connection/AdminMessagesService";
    import type { PlayGlobalMessageInterface } from "../../Connection/ConnexionModels";
    import { LL } from "../../../i18n/i18n-svelte";
    import { IconMusicShare } from "@wa-icons";

    const gameScene = gameManager.getCurrentGameScene();
    let fileInput: HTMLInputElement;
    // Kept here rather than read back from the input: a dropped file never reaches the input's file list.
    let selectedFile: File | undefined;
    let previewUrl: string | undefined;
    let errorFile = false;
    let errorUpload = false;
    let dropHover = false;

    /** True once a file is picked. Bind to it to disable sending. */
    export let hasFile = false;
    $: hasFile = selectedFile !== undefined;

    const AUDIO_TYPE = AdminMessageEventTypes.audio;

    export const handleSending = {
        /** Uploads the file and sends it. Returns false (and shows why) when nothing was sent. */
        async sendAudioMessage(broadcast: boolean): Promise<boolean> {
            const connection = gameScene?.connection;
            if (connection === undefined) {
                return false;
            }
            if (!selectedFile) {
                errorFile = true;
                return false;
            }

            const fd = new FormData();
            fd.append("file", selectedFile);
            try {
                const res = await connection.uploadAudio(fd);

                const audioGlobalMessage: PlayGlobalMessageInterface = {
                    content: (res as { path: string }).path,
                    type: AUDIO_TYPE,
                    broadcastToWorld: broadcast,
                };
                connection.emitGlobalMessage(audioGlobalMessage);
                errorUpload = false;
                clearFile();
                return true;
            } catch (err) {
                console.error(err);
                errorUpload = true;
                return false;
            }
        },
    };

    function selectFile(file: File | undefined) {
        if (!file) {
            return;
        }
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
        }
        selectedFile = file;
        previewUrl = URL.createObjectURL(file);
        errorFile = false;
        errorUpload = false;
    }

    function clearFile() {
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
        }
        selectedFile = undefined;
        previewUrl = undefined;
        if (fileInput) {
            fileInput.value = "";
        }
    }

    function dropAudioFile(event: DragEvent) {
        selectFile(event.dataTransfer?.files[0]);
    }

    function inputAudioFile(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        selectFile(input.files?.[0]);
    }

    function getFileSize(number: number) {
        if (number < 1024) {
            return number + " bytes";
        } else if (number < 1048576) {
            return (number / 1024).toFixed(1) + " KB";
        } else {
            return (number / 1048576).toFixed(1) + " MB";
        }
    }

    onDestroy(() => {
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
        }
    });
</script>

<section class="section-input-send-audio flex flex-col gap-3 text-white">
    <button
        type="button"
        class="flex flex-col items-center justify-center gap-2 w-full rounded-lg border-2 border-dashed px-4 py-6 m-0 text-center transition-all {dropHover
            ? 'border-secondary bg-white/10'
            : 'border-white/30 bg-white/5 hover:bg-white/10'}"
        data-testid="global-audio-drop-zone"
        on:dragover|preventDefault={() => {
            dropHover = true;
        }}
        on:dragleave|preventDefault={() => {
            dropHover = false;
        }}
        on:drop|preventDefault={(e) => {
            dropAudioFile(e);
            dropHover = false;
        }}
        on:click={() => {
            fileInput.click();
        }}
    >
        <IconMusicShare font-size="28" class="pointer-events-none" />
        <span class="pointer-events-none text-sm">
            {selectedFile ? $LL.megaphone.modal.composer.replaceFile() : $LL.menu.globalAudio.dragAndDrop()}
        </span>
        <span class="pointer-events-none text-xs opacity-70">{$LL.megaphone.modal.composer.audioHint()}</span>
    </button>

    {#if selectedFile && previewUrl}
        <div class="flex flex-col gap-2 rounded-lg bg-white/10 p-3">
            <p class="m-0 text-sm break-all">
                <span class="font-bold">{selectedFile.name}</span>
                <span class="opacity-70"> · {getFileSize(selectedFile.size)}</span>
            </p>
            <audio class="w-full" controls src={previewUrl} data-testid="global-audio-preview" />
        </div>
    {/if}
    {#if errorFile}
        <p class="err m-0 text-sm">{$LL.menu.globalAudio.error()}</p>
    {/if}
    {#if errorUpload}
        <p class="err m-0 text-sm">{$LL.menu.globalAudio.errorUpload()}</p>
    {/if}
    <input
        class="hidden"
        type="file"
        accept="audio/*"
        id="input-send-audio"
        bind:this={fileInput}
        on:change={inputAudioFile}
    />
</section>

<style lang="scss">
    p.err {
        color: #ff6b6b;
    }
</style>
