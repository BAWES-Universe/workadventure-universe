<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import Select from "svelte-select";
    import LL from "../../../i18n/i18n-svelte";
    import type { InputTagOption } from "./InputTagOption";
    import InfoButton from "./InfoButton.svelte";
    const dispatch = createEventDispatcher<{
        change: InputTagOption[] | undefined;
    }>();

    export let optional = false;
    export let label: string | undefined = undefined;
    export let value: InputTagOption[] | undefined;
    export let options: InputTagOption[] = [];
    export let placeholder: string | undefined = undefined;
    export let onFocus = () => {};
    export let onBlur = () => {};
    export let handleChange = () => {};
    export let testId: string | undefined = undefined;
    export let queryOptions: undefined | ((filterText: string) => Promise<{ value: string; label: string }[]>) =
        undefined;

    let filterText = "";
    // One shared empty list: a fresh [] on every render would count as a change and re-run the select's value logic.
    const NO_ITEMS: InputTagOption[] = [];
    const SLOTS = $$slots;

    function handleFilter() {
        if (value?.find((i) => i.label === filterText)) return;
        if (options?.find((i) => i.label === filterText)) return;
        if (filterText.trim().length > 0) {
            const prev = options.filter((i) => !i.created);
            options = [...prev, { value: filterText, label: filterText, created: true }];
        }
    }

    function _handleChange() {
        options = options.map((i) => {
            delete i.created;
            return { ...i };
        });
        dispatch("change", value);
    }
</script>

<div class="flex flex-col text-dark-purple">
    <div class="input-label" class:hidden={!label && !SLOTS.info && !optional}>
        {#if label}
            <label for="selector" class="text-white relative grow">
                {label}
            </label>
        {/if}

        {#if SLOTS.info}
            <InfoButton>
                <slot name="info" />
            </InfoButton>
        {/if}

        {#if optional}
            <div class="text-xs opacity-50">
                {$LL.form.optional()}
            </div>
        {/if}
    </div>
    <Select
        on:filter={handleFilter}
        bind:filterText
        loadOptions={queryOptions}
        on:change={_handleChange}
        on:input={handleChange}
        on:select={handleChange}
        items={filterText.trim().length === 0 ? NO_ITEMS : options}
        bind:value
        multiple={true}
        placeholder={placeholder ?? "Select rights"}
        on:focus={onFocus}
        on:blur={onBlur}
        showChevron={true}
        listAutoWidth={false}
        --background="rgba(255, 255, 255, 0.06)"
        --border="none"
        --border-hover="none"
        --border-focused="none"
        --border-radius="14px"
        --font-size="15px"
        --height="48px"
        --clear-select-color="rgba(255, 255, 255, 0.7)"
        --input-color="white"
        --placeholder-color="rgba(255, 255, 255, 0.5)"
        --chevron-color="rgba(255, 255, 255, 0.7)"
        --value-container-padding="6px 0"
        --multi-item-color="#fff"
        --multi-item-bg="rgba(134, 41, 252, 0.16)"
        --multi-item-outline="1px solid rgba(167, 139, 250, 0.45)"
        --multi-item-border-radius="999px"
        --multi-item-height="30px"
        --multi-item-padding="0 4px 0 12px"
        --multi-item-gap="6px"
        --multi-item-clear-icon-color="rgba(255, 255, 255, 0.7)"
        --multi-select-padding="0 8px 0 14px"
        --padding="0 8px 0 14px"
        --list-background="linear-gradient(160deg, rgb(31 28 47), rgb(20 18 30))"
        --list-border="none"
        --list-border-radius="14px"
        --list-shadow="0 0 0 1px rgba(167, 139, 250, 0.18), 0 12px 32px rgba(0, 0, 0, 0.45)"
        --list-empty-color="rgba(255, 255, 255, 0.6)"
        --list-empty-padding="12px"
        --item-color="rgba(255, 255, 255, 0.88)"
        --item-height="44px"
        --item-is-active-bg="rgba(134, 41, 252, 0.16)"
        --item-is-active-color="#fff"
        --item-hover-bg="rgba(255, 255, 255, 0.06)"
        --item-hover-color="#fff"
        inputStyles="box-shadow:none !important; margin:0"
        inputAttributes={{ "data-testid": testId }}
        class="u-tag-field !outline-none !w-full"
    >
        <div slot="item" let:item>
            {item.created ? $LL.notification.addNewTag({ tag: filterText }) : item.label}
        </div>
    </Select>
</div>

<style>
    /* The game's field (u-join-field) and dropdown (UI/USelect): a white/6 field with a faint ring, lavender when
       typing; picked tags are tinted pills; the list is the ink panel with rounded rows. */
    :global(.svelte-select.u-tag-field) {
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    }
    :global(.svelte-select.u-tag-field.focused) {
        box-shadow: inset 0 0 0 2px rgba(196, 181, 253, 0.85);
    }
    /* As wide as the field, never wider: a wider list would push the panel sideways. */
    :global(.svelte-select.u-tag-field .svelte-select-list) {
        left: 0 !important;
        width: 100% !important;
        padding: 6px;
    }
    :global(.svelte-select.u-tag-field .svelte-select-list .item) {
        border-radius: 12px;
        line-height: 44px;
    }
    :global(.svelte-select.u-tag-field .multi-item) {
        font-size: 13px;
        font-weight: 600;
    }
</style>
