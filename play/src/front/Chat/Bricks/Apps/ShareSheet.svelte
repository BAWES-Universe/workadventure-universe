<script lang="ts">
    import LL from "../../../../i18n/i18n-svelte";
    import PageButton from "../../../external-modules/bots/components/page/PageButton.svelte";
    import PageChips from "../../../external-modules/bots/components/page/PageChips.svelte";
    import {
        choiceIsComplete,
        limitChoices,
        startingChoice,
        toggled,
        type Share,
        type ShareJobChoice,
    } from "./AppShare";
    import AppSheet from "./AppSheet.svelte";
    import { IconCheck, IconLock } from "@wa-icons";

    /**
     * What people who chat with one of the owner's Bricks can ask an app for (game #2006, mock Part 17): every job the app
     * offers, picked or "Only you", and for a picked job what people fill in and what they get back, then the two limits.
     * Nothing of the app but the picked jobs can be reached, and its link, key and account are never here. With `starting`
     * it begins sharing; without, it changes what is shared. Sends everything at once; false from `onSubmit` keeps it open.
     */
    export let app: string;
    export let brick: string;
    export let share: Share;
    export let starting: boolean;
    export let onSubmit: (change: {
        jobs: ShareJobChoice[];
        usesPerDayEveryone: number;
        usesPerDayPerson: number;
    }) => Promise<boolean>;
    /** Orbit's own words for why the last try was refused, when it worded one */
    export let refusal = "";
    export let onClose: () => void;

    $: text = $LL.chat.brick.apps;
    $: words = $LL.chat.brick.apps.share;

    // A job already shared starts picked, as it is; when starting, the one job there is starts picked
    let choices = new Map<string, ShareJobChoice>();
    // What was set for a job that was then unticked: ticking it again brings back that choice, not the starting one
    let drafts = new Map<string, ShareJobChoice>();
    for (const job of share.jobs) {
        if (job.picked || (starting && share.jobs.length === 1)) choices.set(job.tool, startingChoice(job));
    }
    let everyone = share.usesPerDayEveryone;
    let person = share.usesPerDayPerson;
    let busy = false;
    let failed = false;

    $: everyoneChips = limitChoices("everyone", share.usesPerDayEveryone).map((value) => ({
        value,
        label: String(value),
    }));
    $: personChips = limitChoices("person", share.usesPerDayPerson).map((value) => ({ value, label: String(value) }));
    $: complete = share.jobs.every((job) => {
        const choice = choices.get(job.tool);
        return !choice || choiceIsComplete(job, choice);
    });
    $: canSend = !busy && choices.size > 0 && complete;

    function pick(tool: string) {
        if (busy) return;
        const job = share.jobs.find((one) => one.tool === tool);
        if (!job) return;
        const next = new Map(choices);
        const current = next.get(tool);
        if (current) {
            drafts = new Map(drafts).set(tool, current);
            next.delete(tool);
        } else {
            next.set(tool, drafts.get(tool) ?? startingChoice({ ...job, picked: false }));
        }
        choices = next;
    }

    function fill(tool: string, name: string) {
        if (busy) return;
        const job = share.jobs.find((one) => one.tool === tool);
        const choice = choices.get(tool);
        if (!job || !choice) return;
        const order = job.inputs.map((one) => one.name);
        choices = new Map(choices).set(tool, { ...choice, inputs: toggled(choice.inputs, name, order) });
    }

    function giveBack(tool: string, name: string) {
        if (busy) return;
        const job = share.jobs.find((one) => one.tool === tool);
        const choice = choices.get(tool);
        if (!job || !choice || !job.returns.names) return;
        choices = new Map(choices).set(tool, {
            ...choice,
            returns: toggled(choice.returns ?? job.returns.names, name, job.returns.names),
        });
    }

    async function send() {
        if (!canSend) return;
        busy = true;
        failed = false;
        const jobs = share.jobs.flatMap((job) => {
            const choice = choices.get(job.tool);
            return choice ? [choice] : [];
        });
        const done = await onSubmit({ jobs, usesPerDayEveryone: everyone, usesPerDayPerson: person });
        busy = false;
        if (!done) failed = true;
    }
</script>

<AppSheet
    title={words.sheetTitle({ app })}
    sub={words.sheetSub({ app, brick })}
    onClose={() => {
        // A save on its way is not walked away from: the sheet closes by itself when it is done
        if (!busy) onClose();
    }}
    stickyButtons
    testId="appShareSheet"
>
    <div class="ss-fl">
        <span class="ss-lb">{words.whatTheyCanAsk()}</span>
        {#each share.jobs as job (job.tool)}
            {@const choice = choices.get(job.tool)}
            <div class="ss-job" class:on={!!choice} data-testid="appShareJob">
                <button
                    type="button"
                    role="checkbox"
                    aria-checked={!!choice}
                    disabled={busy}
                    class="ss-pick"
                    data-testid="appShareJobPick"
                    on:click={() => pick(job.tool)}
                >
                    <span class="ss-box" class:on={!!choice}
                        >{#if choice}<IconCheck font-size="14" />{:else}<IconLock font-size="13" />{/if}</span
                    >
                    <span class="ss-tx">
                        <span class="ss-t">{job.title}</span>
                        {#if choice}
                            {#if job.description}<span class="ss-m">{job.description}</span>{/if}
                        {:else if job.needsPicking}
                            <span class="ss-m warn" data-testid="appSharePaused">{words.paused()}</span>
                        {:else}
                            <span class="ss-m">{words.onlyYou()}</span>
                        {/if}
                    </span>
                </button>
                {#if choice}
                    {#if job.inputs.length > 0}
                        <div class="ss-sub">
                            <span class="ss-lab">{words.fillIn()}</span>
                            {#each job.inputs as input (input.name)}
                                <button
                                    type="button"
                                    role="checkbox"
                                    aria-checked={choice.inputs.includes(input.name)}
                                    aria-disabled={input.required || busy}
                                    disabled={input.required || busy}
                                    class="ss-tick"
                                    data-testid="appShareInput"
                                    on:click={() => fill(job.tool, input.name)}
                                >
                                    <span class="ss-box sm" class:on={choice.inputs.includes(input.name)}
                                        ><IconCheck font-size="12" /></span
                                    >
                                    <span class="ss-n">{input.name}</span>
                                    <span class="ss-k">{input.required ? words.needed() : words.optional()}</span>
                                </button>
                            {/each}
                        </div>
                    {/if}
                    <div class="ss-sub">
                        <span class="ss-lab">{words.getBack()}</span>
                        {#if job.returns.names === null}
                            <span class="ss-m" data-testid="appShareGetBackAll">{words.getBackAll({ app })}</span>
                        {:else}
                            {#each job.returns.names as field (field)}
                                {@const on = (choice.returns ?? job.returns.names).includes(field)}
                                <button
                                    type="button"
                                    role="checkbox"
                                    aria-checked={on}
                                    disabled={busy}
                                    class="ss-tick"
                                    data-testid="appShareReturn"
                                    on:click={() => giveBack(job.tool, field)}
                                >
                                    <span class="ss-box sm" class:on><IconCheck font-size="12" /></span>
                                    <span class="ss-n">{field}</span>
                                </button>
                            {/each}
                            {#if (choice.returns ?? job.returns.names).length === 0}
                                <span class="ss-m warn" data-testid="appShareGetBackOne">{words.getBackOne()}</span>
                            {/if}
                        {/if}
                    </div>
                {/if}
            </div>
        {/each}
        {#if choices.size === 0}<span class="ss-m warn" data-testid="appSharePickOne">{words.pickOne()}</span>{/if}
    </div>
    <div class="ss-fl">
        <span class="ss-lb">{words.usesEveryone()}</span>
        <PageChips
            label={words.usesEveryone()}
            options={everyoneChips}
            value={everyone}
            disabled={busy}
            onPick={(value) => (everyone = value)}
        />
    </div>
    <div class="ss-fl">
        <span class="ss-lb">{words.usesPerson()}</span>
        <PageChips
            label={words.usesPerson()}
            options={personChips}
            value={person}
            disabled={busy}
            onPick={(value) => (person = value)}
        />
    </div>
    <p class="ss-note">{words.note()}</p>
    {#if failed}<p class="ss-bad" data-testid="appShareFailed">{refusal || text.workFailed()}</p>{/if}
    <svelte:fragment slot="buttons">
        <PageButton tall disabled={busy} testId="appShareCancel" on:click={onClose}>{text.cancel()}</PageButton>
        <PageButton tall go disabled={!canSend} testId="appShareConfirm" on:click={() => void send()}
            >{starting ? words.start() : text.save()}</PageButton
        >
    </svelte:fragment>
</AppSheet>

<style>
    .ss-fl {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .ss-lb {
        font-size: 13px;
        font-weight: 600;
        color: rgba(244, 242, 250, 0.82);
    }
    .ss-job {
        display: flex;
        flex-direction: column;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.03);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
    }
    .ss-job.on {
        background: rgba(134, 41, 252, 0.1);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.55);
    }
    .ss-pick {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 56px;
        margin: 0;
        padding: 6px 12px 6px 10px;
        border: 0;
        border-radius: 14px;
        background: transparent;
        font: inherit;
        color: #fff;
        text-align: start;
        cursor: pointer;
    }
    .ss-pick:disabled {
        cursor: default;
    }
    .ss-pick:focus-visible,
    .ss-tick:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: -2px;
    }
    .ss-tx {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }
    .ss-t {
        font-size: 14px;
        font-weight: 600;
        overflow-wrap: anywhere;
    }
    .ss-m {
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
    }
    .ss-m.warn {
        color: #f5c451;
    }
    .ss-box {
        display: grid;
        place-items: center;
        flex: none;
        width: 22px;
        height: 22px;
        border: 2px solid rgba(255, 255, 255, 0.35);
        border-radius: 6px;
        box-sizing: border-box;
        color: rgba(255, 255, 255, 0.6);
    }
    .ss-box.sm {
        width: 20px;
        height: 20px;
        color: transparent;
    }
    .ss-box.on {
        border: 0;
        background: linear-gradient(135deg, #8629fc, #4156f6);
        color: #fff;
    }
    .ss-sub {
        display: flex;
        flex-direction: column;
        padding: 0 12px 10px 44px;
    }
    .ss-lab {
        padding: 4px 0;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(244, 242, 250, 0.6);
    }
    .ss-tick {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 40px;
        margin: 0;
        padding: 0 4px;
        border: 0;
        border-radius: 10px;
        background: transparent;
        font: inherit;
        font-size: 14px;
        color: #fff;
        text-align: start;
        cursor: pointer;
    }
    .ss-tick:disabled {
        cursor: default;
    }
    .ss-n {
        flex: 1;
        min-width: 0;
        overflow-wrap: anywhere;
    }
    .ss-k {
        font-size: 12px;
        color: rgba(244, 242, 250, 0.56);
    }
    .ss-note {
        margin: 0;
        font-size: 13px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.64);
    }
    .ss-bad {
        margin: 0;
        font-size: 13px;
        color: #ff8a7a;
    }
</style>
