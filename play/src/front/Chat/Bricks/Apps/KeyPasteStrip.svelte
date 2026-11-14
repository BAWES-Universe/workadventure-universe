<script lang="ts">
    import LL from "../../../../i18n/i18n-svelte";
    import { IconAlertTriangle } from "@wa-icons";

    /**
     * The strip over the message box when something that looks like a key is typed or pasted into a Brick's chat (game #2044).
     * The message is held, never sent: a key in chat would sit in the conversation and in the Brick's memory. The person clears
     * it, or goes to Apps, where keys are added on the safe form.
     */
    export let onClear: () => void;
    export let onApps: () => void;

    $: text = $LL.chat.brick.apps;
</script>

<div class="kp pointer-events-auto u-surface text-white" role="alert" data-testid="keyPasteStrip">
    <IconAlertTriangle font-size="20" />
    <div class="kp-tx">
        <span class="kp-t">{text.keyPasteTitle()}</span>
        <span class="kp-l">{text.keyPasteLine()}</span>
        <span class="kp-b">
            <button type="button" class="kp-btn" data-testid="keyPasteApps" on:click={onApps}>{text.keyPasteApps()}</button>
            <button type="button" class="kp-btn" data-testid="keyPasteClear" on:click={onClear}
                >{text.keyPasteClear()}</button
            >
        </span>
    </div>
</div>

<style>
    .kp {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 12px 14px;
        border-radius: 14px;
        color: #ffd89a;
    }
    .kp-tx {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }
    .kp-t {
        font-size: 14px;
        font-weight: 700;
        color: #fff;
    }
    .kp-l {
        font-size: 13px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.74);
    }
    .kp-b {
        display: flex;
        gap: 14px;
        margin-top: 6px;
    }
    .kp-btn {
        margin: 0;
        padding: 6px 0;
        border: 0;
        background: transparent;
        font: inherit;
        font-size: 13px;
        font-weight: 700;
        color: #a78bfa;
        cursor: pointer;
    }
</style>
