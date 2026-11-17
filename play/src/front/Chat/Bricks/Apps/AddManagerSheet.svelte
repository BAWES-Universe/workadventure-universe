<script lang="ts">
    import LL from "../../../../i18n/i18n-svelte";
    import PageButton from "../../../external-modules/bots/components/page/PageButton.svelte";
    import type { Person } from "./Apps";
    import AppSheet from "./AppSheet.svelte";

    /**
     * "Add a manager" (game #2001) for an app that belongs to a universe: the people who can manage bots there and do not
     * manage this app yet. One is picked (soft violet), one button adds them. A manager can reconnect the app, choose its
     * bots and disconnect it; nothing of its sign-in is ever shown to them.
     */
    export let app: string;
    export let universe: string;
    export let people: Person[];
    /** Adds the person; true when Orbit took it, false when it did not (the sheet then says so and stays) */
    export let onAdd: (person: Person) => Promise<boolean>;
    export let onClose: () => void;

    $: text = $LL.chat.brick.apps;
    let pickedId: string | undefined = people[0]?.id;
    let busy = false;
    let failed = false;
    $: picked = people.find((person) => person.id === pickedId);

    async function add() {
        if (!picked || busy) return;
        busy = true;
        failed = false;
        const done = await onAdd(picked);
        // eslint-disable-next-line require-atomic-updates
        busy = false;
        if (!done) failed = true;
    }
</script>

<AppSheet
    title={text.addManagerTitle({ app })}
    sub={text.addManagerSub({ app, universe })}
    {onClose}
    testId="addManagerSheet"
>
    {#if people.length === 0}
        <p class="am-note" data-testid="addManagerNone">{text.addManagerNone({ app, universe })}</p>
    {:else}
        <div class="am-opts" role="radiogroup" aria-label={text.addManagerTitle({ app })}>
            {#each people as person (person.id)}
                <button
                    type="button"
                    role="radio"
                    aria-checked={person.id === pickedId}
                    class="am-opt"
                    class:sel={person.id === pickedId}
                    data-testid="addManagerPerson"
                    on:click={() => (pickedId = person.id)}
                >
                    <span class="am-face" aria-hidden="true">{person.name.charAt(0).toUpperCase()}</span>
                    <span class="am-tx">
                        <span class="am-t">{person.name}</span>
                        <span class="am-m">{text.addManagerHint({ universe })}</span>
                    </span>
                    <span class="am-dot" class:on={person.id === pickedId} />
                </button>
            {/each}
        </div>
        {#if picked}<p class="am-note">{text.addManagerNote({ name: picked.name, app })}</p>{/if}
    {/if}
    {#if failed}<p class="am-bad" data-testid="addManagerFailed">{text.workFailed()}</p>{/if}
    <svelte:fragment slot="buttons">
        <PageButton tall testId="addManagerCancel" on:click={onClose}>{text.cancel()}</PageButton>
        {#if picked}
            <PageButton tall go disabled={busy} testId="addManagerGo" on:click={() => void add()}
                >{text.addPerson({ name: picked.name })}</PageButton
            >
        {/if}
    </svelte:fragment>
</AppSheet>

<style>
    .am-note {
        margin: 0;
        font-size: 13px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.64);
    }
    .am-bad {
        margin: 0;
        font-size: 13px;
        color: #ff8a7a;
    }
    .am-opts {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .am-opt {
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
    .am-opt.sel {
        background: rgba(134, 41, 252, 0.14);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.7);
    }
    .am-opt:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: -2px;
    }
    .am-face {
        display: grid;
        place-items: center;
        flex: none;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: rgba(167, 139, 250, 0.2);
        font-size: 14px;
        font-weight: 700;
    }
    .am-tx {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-width: 0;
    }
    .am-t {
        font-size: 14px;
        font-weight: 600;
        overflow-wrap: anywhere;
    }
    .am-m {
        font-size: 12.5px;
        color: rgba(244, 242, 250, 0.64);
    }
    .am-dot {
        flex: none;
        width: 20px;
        height: 20px;
        border: 2px solid rgba(255, 255, 255, 0.35);
        border-radius: 50%;
        box-sizing: border-box;
    }
    .am-dot.on {
        border: 0;
        background: radial-gradient(circle, #fff 0 4px, transparent 5px), linear-gradient(135deg, #8629fc, #4156f6);
    }
</style>
