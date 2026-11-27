<script lang="ts">
    import LL from "../../../../i18n/i18n-svelte";
    import PageSwitch from "../../../external-modules/bots/components/page/PageSwitch.svelte";
    import { changeShowAppUse, shownIn, showAppUseStates } from "./BrickShowAppUse";

    /**
     * "Show app use" on a Brick's Apps screen: one switch, with the words the bot page's own switch has. Moving it saves at
     * once; when Orbit does not take it, it goes back and the line under it says so (not a pop-up: on a phone the panel covers
     * where pop-ups show).
     */
    export let botId: string;

    $: text = $LL.mapEditor.edit.bots.page.tools;
    $: on = shownIn($showAppUseStates, botId);
    let busy = false;
    let failed = false;

    function change(show: boolean) {
        if (busy) return;
        busy = true;
        failed = false;
        changeShowAppUse(botId, show)
            .then((saved) => {
                failed = !saved;
            })
            .catch((error) => console.error(error))
            .finally(() => {
                busy = false;
            });
    }
</script>

<label class="sau" for="brick-show-app-use-{botId}" data-testid="showAppUse">
    <span class="sau-tx">
        <span class="sau-t">{text.showToolCalls()}</span>
        <span class="sau-m">{on ? text.showToolCallsOn() : text.showToolCallsOff()}</span>
    </span>
    <PageSwitch
        checked={on}
        disabled={busy}
        label={text.showToolCalls()}
        id="brick-show-app-use-{botId}"
        testId="showAppUseSwitch"
        onChange={change}
    />
</label>
{#if failed}
    <p class="sau-bad" role="alert" data-testid="showAppUseFailed">{$LL.chat.brick.apps.onBrick.useNotSaved()}</p>
{/if}

<style>
    .sau {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 52px;
        padding: 6px 8px;
        cursor: pointer;
    }
    .sau-tx {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
    }
    .sau-t {
        font-size: 15px;
        color: #fff;
    }
    .sau-m {
        font-size: 13px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
    }
    .sau-bad {
        margin: 0;
        padding: 0 8px 4px;
        font-size: 13px;
        line-height: 1.3;
        color: #ff8a7a;
    }
</style>
