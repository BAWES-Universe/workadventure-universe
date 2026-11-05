<script lang="ts">
    import { LL } from "../../../i18n/i18n-svelte";
    import { stepMore, type BotStep } from "./BotSteps";
    import { IconCheck, IconHelpCircle, IconMinus, IconX } from "@wa-icons";

    /**
     * One finished call of a bot's steps line (#1723): what it did, in full, with what it was about or why it didn't
     * work under it. Used for the calls listed while the bot still works and for the list of a folded summary.
     */
    export let step: BotStep;
    export let iconSize = 15;

    $: more = stepMore(step);
</script>

<li data-testid="botStepItem">
    {#if step.state === "failed"}
        <IconX class="bot-steps-icon bad" font-size={iconSize} />
    {:else if step.state === "unknown"}
        <IconHelpCircle class="bot-steps-icon" font-size={iconSize} />
    {:else if step.state === "running"}
        <!-- Never finished in view: the line stopped (e.g. you walked away) before it said how it went -->
        <IconMinus class="bot-steps-icon" font-size={iconSize} />
    {:else}
        <IconCheck class="bot-steps-icon" font-size={iconSize} />
    {/if}
    <span class="bot-steps-words">
        <span>{step.done}</span>
        {#if more}
            <small>{more}</small>
        {/if}
    </span>
    {#if step.again}
        <em>{$LL.chat.botSteps.again()}</em>
    {/if}
</li>
