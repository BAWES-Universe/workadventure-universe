<script lang="ts">
    import Quill from "quill";
    import { onDestroy, onMount } from "svelte";
    import { menuInputFocusStore } from "../../Stores/MenuInputFocusStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { AdminMessageEventTypes } from "../../Connection/AdminMessagesService";
    import type { PlayGlobalMessageInterface } from "../../Connection/ConnexionModels";
    import { LL } from "../../../i18n/i18n-svelte";
    import { isQuillTextEmpty } from "../GlobalMessage/GlobalMessageComposer";

    // Kept short so the toolbar fits on a phone. Images and video are left out: they would be embedded in the message.
    const toolbarOptions = [
        ["bold", "italic", "underline", "strike"],
        [{ header: 1 }, { header: 2 }],
        [{ list: "ordered" }, { list: "bullet" }],
        [{ color: [] }],
        ["link", "clean"],
    ];

    const gameScene = gameManager.getCurrentGameScene();
    const MESSAGE_TYPE = AdminMessageEventTypes.admin;
    let quill: Quill;
    let QUILL_EDITOR: HTMLDivElement;

    /** True while the editor holds no text. Bind to it to disable sending. */
    export let isEmpty = true;
    /** The editor content as Quill ops, kept up to date for the preview. */
    export let ops: unknown[] = [];

    export const handleSending = {
        /** Returns false when nothing was sent (no scene or no connection). */
        sendTextMessage(broadcastToWorld: boolean): boolean {
            const connection = gameScene?.connection;
            if (connection === undefined || isQuillTextEmpty(quill.getText())) {
                return false;
            }
            const text = JSON.stringify(quill.getContents(0, quill.getLength()));

            const textGlobalMessage: PlayGlobalMessageInterface = {
                type: MESSAGE_TYPE,
                content: text,
                broadcastToWorld: broadcastToWorld,
            };

            connection.emitGlobalMessage(textGlobalMessage);
            quill.deleteText(0, quill.getLength());
            return true;
        },
    };

    function onTextChange() {
        isEmpty = isQuillTextEmpty(quill.getText());
        ops = quill.getContents().ops ?? [];
    }

    //Quill
    onMount(() => {
        quill = new Quill(QUILL_EDITOR, {
            placeholder: $LL.menu.globalMessage.enter(),
            theme: "snow",
            modules: {
                toolbar: toolbarOptions,
            },
        });
        quill.on("text-change", onTextChange);
        onTextChange();
        // Don't pop the on-screen keyboard over the sheet as soon as it opens on a phone.
        if (window.matchMedia("(pointer: fine)").matches) {
            quill.focus();
        }
        menuInputFocusStore.set(true);
    });

    onDestroy(() => {
        quill?.off("text-change", onTextChange);
        menuInputFocusStore.set(false);
    });
</script>

<section class="section-input-send-text test">
    <div class="input-send-text" role="textbox" bind:this={QUILL_EDITOR} />
</section>

<style lang="scss">
    @import "quill/dist/quill.snow.css";

    section.section-input-send-text {
        :global(.ql-toolbar) {
            border-top-left-radius: 12px;
            border-top-right-radius: 12px;
            border-color: #879fc2;
        }
        :global(.ql-toolbar.ql-snow .ql-picker-label) {
            color: whitesmoke;
        }

        :global(.ql-toolbar .ql-stroke) {
            fill: none;
            stroke: #fff;
        }

        :global(.ql-toolbar .ql-fill) {
            fill: #fff;
            stroke: none;
        }

        :global(.ql-toolbar.ql-snow .ql-formats button) {
            color: whitesmoke;
        }

        :global(.ql-container) {
            background-color: #1b2a41;
            border-bottom-left-radius: 12px;
            border-bottom-right-radius: 12px;
            border: 1px solid #879fc2;
            color: whitesmoke;
            font-size: 1rem;
        }

        :global(.ql-editor) {
            background-color: #1b2a41;
            border-bottom-left-radius: 12px;
            border-bottom-right-radius: 12px;
            text-align: start;
            min-height: 7rem;
            max-height: 14rem;
            overflow-y: auto;
        }

        :global(.ql-editor.ql-blank::before) {
            color: rgba(245, 245, 245, 0.6);
            font-size: 1rem;
        }

        :global(.ql-tooltip) {
            color: whitesmoke;
            background-color: #333333;
            z-index: 1;
        }
    }
</style>
