<script lang="ts">
    import Quill from "quill";
    import { createEventDispatcher, onDestroy, onMount } from "svelte";
    import LL from "../../../i18n/i18n-svelte";
    import type { BroadcastReach } from "../../Stores/BroadcastStore";
    import { menuInputFocusStore } from "../../Stores/MenuInputFocusStore";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { reachTitle } from "./reach";
    import { sendBroadcastText } from "./send";
    import { IconSpeakerPhone, IconX } from "@wa-icons";

    export let reach: BroadcastReach;

    const dispatch = createEventDispatcher<{ sent: void }>();

    // The rich editor written broadcasts always had: bold, lists, headings, colours, links, images and video.
    const toolbarOptions = [
        ["bold", "italic", "underline", "strike"],
        ["blockquote", "code-block"],
        [{ header: 1 }, { header: 2 }],
        [{ list: "ordered" }, { list: "bullet" }],
        [{ script: "sub" }, { script: "super" }],
        [{ indent: "-1" }, { indent: "+1" }],
        [{ direction: "rtl" }],
        [{ size: ["small", false, "large", "huge"] }],
        [{ header: [1, 2, 3, 4, 5, 6, false] }],
        [{ color: [] }, { background: [] }],
        [{ font: [] }],
        [{ align: [] }],
        ["clean"],
        ["link", "image", "video"],
    ];

    let error: string | undefined;
    let editorElement: HTMLDivElement;
    let quill: Quill | undefined;

    onMount(() => {
        // The game must not read the keys typed here as moves.
        menuInputFocusStore.set(true);
        quill = new Quill(editorElement, {
            placeholder: $LL.broadcast.write.placeholder(),
            theme: "snow",
            modules: { toolbar: toolbarOptions },
        });
        quill.on("text-change", clearError);
        quill.focus();
    });
    onDestroy(() => {
        menuInputFocusStore.set(false);
        quill?.off("text-change", clearError);
    });

    function clearError() {
        error = undefined;
    }

    function send() {
        if (!quill) return;
        // An image or a video counts as content; only an editor holding nothing but blank lines is empty.
        const contents = quill.getContents();
        const empty = (contents.ops ?? []).every((op) => typeof op.insert === "string" && op.insert.trim() === "");
        if (empty) {
            error = $LL.broadcast.write.empty();
            return;
        }
        try {
            analyticsClient.sendGlocalTextMessage();
            sendBroadcastText(JSON.stringify(contents), reach);
            dispatch("sent");
        } catch (e) {
            console.error(e);
            error = $LL.broadcast.write.sendFailed();
        }
    }
</script>

<div class="broadcast-editor" data-testid="broadcast-text-editor">
    <div bind:this={editorElement} data-testid="broadcast-text" />
</div>
{#if error}
    <div class="u-error-line" role="alert">
        <span class="flex-1">{error}</span>
        <button
            type="button"
            class="u-chip-remove"
            on:click={() => (error = undefined)}
            aria-label={$LL.broadcast.close()}
        >
            <IconX font-size="14" />
        </button>
    </div>
{/if}
<button
    type="button"
    class="u-cta rounded-full w-full py-3.5 text-base font-bold flex items-center justify-center gap-2"
    on:click={send}
    data-testid="broadcast-send"
>
    <IconSpeakerPhone font-size="18" aria-hidden="true" />
    {$LL.broadcast.reach.sendTo({ reach: reachTitle($LL, reach) })}
</button>

<style lang="scss">
    @import "quill/dist/quill.snow.css";

    /* Quill's editor and toolbar in the card's look: one field with the toolbar on top, white on ink. */
    .broadcast-editor {
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
        overflow: hidden;

        &:focus-within {
            border-color: rgba(167, 139, 250, 0.7);
            box-shadow: 0 0 0 1px rgba(167, 139, 250, 0.35);
        }

        :global(.ql-toolbar.ql-snow) {
            border: 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            padding: 6px;
            font-family: inherit;
        }
        :global(.ql-container.ql-snow) {
            border: 0;
            font-family: inherit;
            font-size: 15px;
        }
        :global(.ql-editor) {
            min-height: 7rem;
            max-height: 40vh;
            padding: 12px 14px;
            line-height: 1.4;
            text-align: start;
        }
        :global(.ql-editor.ql-blank::before) {
            color: rgba(255, 255, 255, 0.45);
            font-style: normal;
            inset-inline: 14px;
        }
        :global(.ql-snow .ql-stroke) {
            stroke: #fff;
        }
        :global(.ql-snow .ql-fill),
        :global(.ql-snow .ql-stroke.ql-fill) {
            fill: #fff;
        }
        :global(.ql-snow .ql-picker) {
            color: #fff;
        }
        :global(.ql-snow button:hover .ql-stroke),
        :global(.ql-snow button.ql-active .ql-stroke),
        :global(.ql-snow .ql-picker-label:hover .ql-stroke),
        :global(.ql-snow .ql-picker-label.ql-active .ql-stroke) {
            stroke: #c4b5fd;
        }
        :global(.ql-snow button:hover .ql-fill),
        :global(.ql-snow button.ql-active .ql-fill) {
            fill: #c4b5fd;
        }
        :global(.ql-snow .ql-picker-label:hover),
        :global(.ql-snow .ql-picker-label.ql-active),
        :global(.ql-snow .ql-picker-item:hover),
        :global(.ql-snow .ql-picker-item.ql-selected) {
            color: #c4b5fd;
        }
        :global(.ql-snow .ql-picker-options) {
            background: #1f1c2f;
            border-color: rgba(167, 139, 250, 0.3);
            border-radius: 10px;
        }
        :global(.ql-snow .ql-tooltip) {
            z-index: 1;
            color: #fff;
            background: #1f1c2f;
            border: 1px solid rgba(167, 139, 250, 0.3);
            border-radius: 10px;
            box-shadow: none;
            left: 8px !important;
        }
        :global(.ql-snow .ql-tooltip input[type="text"]) {
            color: #fff;
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 8px;
        }
        :global(.ql-snow a) {
            color: #c4b5fd;
        }
    }
</style>
