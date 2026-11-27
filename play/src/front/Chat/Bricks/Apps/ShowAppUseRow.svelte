<script lang="ts">
    import LL from "../../../../i18n/i18n-svelte";
    import PageSwitch from "../../../external-modules/bots/components/page/PageSwitch.svelte";
    import { warningMessageStore } from "../../../Stores/ErrorStore";
    import { changeShowAppUse, showAppUseStates } from "./BrickShowAppUse";

    /**
     * "Show app use" on a Brick's Apps screen: one switch, with the words the bot page's own switch has. Moving it saves at
     * once; when Orbit does not take it, it goes back and the person is told.
     */
    export let botId: string;

    $: text = $LL.mapEditor.edit.bots.page.tools;
    $: on = $showAppUseStates[botId] === true;
    let busy = false;

    function change(show: boolean) {
        if (busy) return;
        busy = true;
        changeShowAppUse(botId, show)
            .then((saved) => {
                if (!saved) warningMessageStore.addWarningMessage($LL.chat.brick.apps.onBrick.useNotSaved());
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
</style>
