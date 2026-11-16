<script lang="ts">
    import LL from "../../../../i18n/i18n-svelte";
    import PageButton from "../../../external-modules/bots/components/page/PageButton.svelte";
    import PageChips from "../../../external-modules/bots/components/page/PageChips.svelte";
    import PageSegment from "../../../external-modules/bots/components/page/PageSegment.svelte";
    import { THINGS, usesChoices, type Lend, type Thing, type UniverseChoice } from "./Apps";
    import AppSheet from "./AppSheet.svelte";
    import { thingLabel } from "./AppWords";
    import { IconCheck, IconPlanet } from "@wa-icons";

    /**
     * "Lend Tavily" (the mock's lend sheet): the universes where the person can manage bots, what bots there may do with the
     * app (all four things, or only the ones ticked) and the uses a day there. The same steps and words as lending an AI key in
     * Orbit. With `current` it is "Change": the universe is fixed and only the two choices change. Lending moves no bot.
     */
    export let app: string;
    /** The universes it could still be lent to; unused when changing */
    export let universes: UniverseChoice[] = [];
    /** The lend being changed */
    export let current: Lend | undefined = undefined;
    /** Sends the choice; true when Orbit took it, false when it did not (the sheet then says so and stays) */
    export let onSubmit: (choice: {
        universeId: string;
        things: Thing[] | null;
        usesPerDay: number | null;
    }) => Promise<boolean>;
    export let onClose: () => void;

    $: text = $LL.chat.brick.apps;
    let universeId = current?.universeId ?? universes[0]?.id ?? "";
    let what: "all" | "only" = current?.things ? "only" : "all";
    let ticked: Thing[] = current?.things ? [...current.things] : [...THINGS];
    // The starting value is a setting, not a rule: 200 a day, or what the lend already has
    let uses: number | null = current ? current.usesPerDay : 200;
    let busy = false;
    let failed = false;

    $: chips = usesChoices(current?.usesPerDay).map((value) => ({
        value,
        label: value === null ? text.noLimitChip() : String(value),
    }));
    $: canSend = !busy && universeId !== "" && (what === "all" || ticked.length > 0);

    function toggle(thing: Thing) {
        ticked = ticked.includes(thing)
            ? ticked.filter((one) => one !== thing)
            : THINGS.filter((one) => one === thing || ticked.includes(one));
    }

    async function send() {
        if (!canSend) return;
        busy = true;
        failed = false;
        const done = await onSubmit({ universeId, things: what === "all" ? null : ticked, usesPerDay: uses });
        busy = false;
        if (!done) failed = true;
    }
</script>

<AppSheet
    title={current ? text.lendChangeTitle({ app, universe: current.universeName }) : text.lendTitle({ app })}
    sub={current ? "" : text.lendSub({ app })}
    {onClose}
    testId="appLendSheet"
>
    {#if !current}
        <div class="ls-opts" role="radiogroup" aria-label={text.lendTo()}>
            {#each universes as universe (universe.id)}
                <button
                    type="button"
                    role="radio"
                    aria-checked={universe.id === universeId}
                    class="ls-opt"
                    class:sel={universe.id === universeId}
                    data-testid="appLendUniverse"
                    on:click={() => (universeId = universe.id)}
                >
                    <span class="ls-ico"><IconPlanet font-size="20" /></span>
                    <span class="ls-tx">
                        <span class="ls-t">{universe.name}</span>
                        <span class="ls-m"
                            >{universe.access === "owner" ? text.youOwnHere() : text.youManageHere()}</span
                        >
                    </span>
                    <span class="ls-dot" class:on={universe.id === universeId} />
                </button>
            {/each}
        </div>
    {/if}
    <div class="ls-fl">
        <span class="ls-lb">{text.whatBotsMayDo()}</span>
        <PageSegment
            label={text.whatBotsMayDo()}
            options={[
                { value: "all", label: text.allThings({ count: THINGS.length }), testId: "appLendAll" },
                { value: "only", label: text.onlyThese(), testId: "appLendOnly" },
            ]}
            value={what}
            onPick={(value) => (what = value === "only" ? "only" : "all")}
        />
        {#if what === "all"}
            <span class="ls-hint">{text.allThingsHint({ app })}</span>
        {:else}
            <div class="ls-ticks">
                {#each THINGS as thing (thing)}
                    <button
                        type="button"
                        role="checkbox"
                        aria-checked={ticked.includes(thing)}
                        class="ls-tick"
                        data-testid="appLendThing"
                        on:click={() => toggle(thing)}
                    >
                        <span class="ls-box" class:on={ticked.includes(thing)}
                            >{#if ticked.includes(thing)}<IconCheck font-size="14" />{/if}</span
                        >
                        <span>{thingLabel($LL, thing)}</span>
                    </button>
                {/each}
            </div>
            {#if ticked.length === 0}<span class="ls-hint" data-testid="appLendPickOne">{text.pickOne()}</span>{/if}
        {/if}
    </div>
    <div class="ls-fl">
        <span class="ls-lb">{text.usesADayThere()}</span>
        <PageChips label={text.usesADayThere()} options={chips} value={uses} onPick={(value) => (uses = value)} />
        <span class="ls-hint">{text.usesHint()}</span>
    </div>
    <p class="ls-note">{text.lendNote({ app })}</p>
    {#if failed}<p class="ls-bad" data-testid="appLendFailed">{text.workFailed()}</p>{/if}
    <svelte:fragment slot="buttons">
        <PageButton tall testId="appLendCancel" on:click={onClose}>{text.cancel()}</PageButton>
        <PageButton tall go disabled={!canSend} testId="appLendConfirm" on:click={() => void send()}
            >{current ? text.save() : text.lend()}</PageButton
        >
    </svelte:fragment>
</AppSheet>

<style>
    .ls-fl {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .ls-lb {
        font-size: 13px;
        font-weight: 600;
        color: rgba(244, 242, 250, 0.82);
    }
    .ls-hint {
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.56);
    }
    .ls-note {
        margin: 0;
        font-size: 13px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.64);
    }
    .ls-bad {
        margin: 0;
        font-size: 13px;
        color: #ff8a7a;
    }
    .ls-opts {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .ls-opt {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        min-height: 56px;
        margin: 0;
        padding: 6px 12px 6px 10px;
        border: 0;
        border-radius: 14px;
        background: transparent;
        box-sizing: border-box;
        font: inherit;
        color: #fff;
        text-align: start;
        cursor: pointer;
    }
    .ls-opt.sel {
        background: rgba(134, 41, 252, 0.14);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.7);
    }
    .ls-opt:focus-visible,
    .ls-tick:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: -2px;
    }
    .ls-ico {
        display: grid;
        place-items: center;
        flex: none;
        width: 28px;
        color: rgba(167, 139, 250, 0.95);
    }
    .ls-tx {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-width: 0;
    }
    .ls-t {
        font-size: 14px;
        font-weight: 600;
        overflow-wrap: anywhere;
    }
    .ls-m {
        font-size: 12.5px;
        color: rgba(244, 242, 250, 0.64);
    }
    .ls-dot {
        flex: none;
        width: 20px;
        height: 20px;
        border: 2px solid rgba(255, 255, 255, 0.35);
        border-radius: 50%;
        box-sizing: border-box;
    }
    .ls-dot.on {
        border: 0;
        background: radial-gradient(circle, #fff 0 4px, transparent 5px), linear-gradient(135deg, #8629fc, #4156f6);
    }
    .ls-ticks {
        display: flex;
        flex-direction: column;
    }
    .ls-tick {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 44px;
        margin: 0;
        padding: 0 6px;
        border: 0;
        border-radius: 10px;
        background: transparent;
        font: inherit;
        font-size: 14px;
        color: #fff;
        text-align: start;
        cursor: pointer;
    }
    .ls-box {
        display: grid;
        place-items: center;
        flex: none;
        width: 22px;
        height: 22px;
        border: 2px solid rgba(255, 255, 255, 0.35);
        border-radius: 6px;
        box-sizing: border-box;
        color: #fff;
    }
    .ls-box.on {
        border: 0;
        background: linear-gradient(135deg, #8629fc, #4156f6);
    }
</style>
