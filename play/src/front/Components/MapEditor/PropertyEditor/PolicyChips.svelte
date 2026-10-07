<script lang="ts">
    import { LL } from "../../../../i18n/i18n-svelte";
    import { IconPlus, IconX } from "@wa-icons";

    /**
     * The "iFrame Allow" list of a link: each permission as a chip with its own remove button, and an Add chip that
     * opens a field to search the known permissions or type your own, as the old tag picker did.
     */
    export let value: string[];
    export let options: string[];
    export let onChange: (value: string[]) => void;

    let adding = false;
    let filter = "";
    let field: HTMLInputElement | undefined;

    $: suggestions = options.filter(
        (option) => !value.includes(option) && option.includes(filter.trim().toLowerCase())
    );

    function remove(tag: string) {
        onChange(value.filter((current) => current !== tag));
    }

    function add(tag: string) {
        const clean = tag.trim();
        if (clean !== "" && !value.includes(clean)) onChange([...value, clean]);
        filter = "";
        adding = false;
    }

    function open() {
        adding = true;
        // The field exists once Svelte has drawn it
        setTimeout(() => field?.focus(), 0);
    }

    function onKeyDown(event: KeyboardEvent) {
        if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            add(filter);
        } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            filter = "";
            adding = false;
        }
    }
</script>

<div class="pc" data-testid="policy-chips">
    <div class="pc-chips">
        {#each value as tag (tag)}
            <span class="pc-chip">
                {tag}
                <button
                    type="button"
                    class="pc-x"
                    aria-label={$LL.mapEditor.properties.openWebsite.policyRemove({ tag })}
                    on:click={() => remove(tag)}
                >
                    <IconX font-size="14" />
                </button>
            </span>
        {/each}
        {#if !adding}
            <button type="button" class="pc-chip pc-add" data-testid="policy-add" on:click={open}>
                <IconPlus font-size="14" />
                {$LL.mapEditor.properties.openWebsite.policyAdd()}
            </button>
        {/if}
    </div>
    {#if adding}
        <div class="u-join-field pc-field">
            <input
                type="text"
                bind:this={field}
                bind:value={filter}
                placeholder={$LL.mapEditor.properties.openWebsite.policyPlaceholder()}
                aria-label={$LL.mapEditor.properties.openWebsite.policy()}
                on:keydown={onKeyDown}
            />
        </div>
        {#if suggestions.length > 0}
            <div class="pc-list" role="listbox" aria-label={$LL.mapEditor.properties.openWebsite.policy()}>
                {#each suggestions as option (option)}
                    <button
                        type="button"
                        role="option"
                        aria-selected="false"
                        class="u-menu-row pc-opt"
                        on:click={() => add(option)}
                    >
                        <span class="u-menu-label">{option}</span>
                    </button>
                {/each}
            </div>
        {/if}
    {/if}
</div>

<style>
    .pc {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
    }
    .pc-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    .pc-chip {
        display: inline-flex;
        align-items: center;
        gap: 0;
        height: 44px;
        margin: 0;
        padding: 0 0 0 14px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
        color: #fff;
        font: inherit;
        font-size: 0.8125rem;
    }
    .pc-x {
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: rgba(255, 255, 255, 0.6);
        cursor: pointer;
    }
    .pc-x:hover {
        color: #fff;
    }
    .pc-add {
        gap: 6px;
        padding: 0 16px;
        background: transparent;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
        color: rgba(255, 255, 255, 0.85);
        cursor: pointer;
    }
    .pc-add:hover {
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
    }
    .pc-x:focus-visible,
    .pc-add:focus-visible {
        outline: 2px solid rgba(196, 181, 253, 0.9);
        outline-offset: -2px;
    }
    .pc-field {
        height: 3rem;
    }
    .pc-list {
        display: flex;
        flex-direction: column;
        max-height: 220px;
        overflow-y: auto;
        padding: 6px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.04);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
    }
    .pc-opt {
        min-height: 44px;
        padding: 0 12px;
        font-size: 0.9375rem;
        font-weight: 400;
    }
</style>
