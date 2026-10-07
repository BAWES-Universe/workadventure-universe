<script lang="ts">
    import Select from "svelte-select";
    import { createEventDispatcher } from "svelte";
    import { Color } from "@workadventure/shared-utils";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { IconSearch } from "@wa-icons";

    export let placeholder: string;
    export let value: string | undefined | null = undefined;

    let selectedValue: { index: number; label: string; value: string } | undefined = value
        ? {
              index: 1,
              label: value,
              value,
          }
        : undefined;

    const dispatch = createEventDispatcher<{
        onSelect: { index: number; label: string; value: string };
    }>();

    async function searchMembers(filterText: string) {
        const connection = gameManager.getCurrentGameScene().connection;
        if (connection) {
            try {
                return (await connection.queryMembers(filterText)).map((member, index) => ({
                    index,
                    value: member.id,
                    label: member.name
                        ? `${member.name} ${member.email ? `(${member.email})` : ""}`
                        : member.email
                        ? member.email
                        : member.id,
                }));
            } catch (error) {
                console.error(error);
            }
        }
        return [];
    }

    // The label is "Name (email)", "email" or an id, as before.
    function nameOf(label: string): string {
        const match = /^(.*) \((.*)\)\s*$/.exec(label);
        return (match ? match[1] : label).trim();
    }
    function emailOf(label: string): string {
        const match = /^(.*) \((.*)\)\s*$/.exec(label);
        return match ? match[2] : "";
    }

    function handleSelectOption() {
        if (selectedValue) {
            dispatch("onSelect", selectedValue);
        }
    }
</script>

<div class="ma">
    <Select
        bind:value={selectedValue}
        on:change={handleSelectOption}
        itemId="id"
        loadOptions={searchMembers}
        inputAttributes={{ "data-testid": "memberAutoCompleteInput" }}
        {placeholder}
        showChevron={false}
        listAutoWidth={false}
        --background="rgba(255, 255, 255, 0.06)"
        --border="none"
        --border-hover="none"
        --border-focused="none"
        --border-radius="14px"
        --height="48px"
        --font-size="15px"
        --padding="0 8px 0 42px"
        --input-color="white"
        --placeholder-color="rgba(255, 255, 255, 0.5)"
        --clear-select-color="rgba(255, 255, 255, 0.7)"
        --list-background="linear-gradient(160deg, rgb(31 28 47), rgb(20 18 30))"
        --list-border="none"
        --list-border-radius="14px"
        --list-shadow="0 0 0 1px rgba(167, 139, 250, 0.18), 0 12px 32px rgba(0, 0, 0, 0.45)"
        --list-empty-color="rgba(255, 255, 255, 0.6)"
        --item-color="rgba(255, 255, 255, 0.88)"
        --item-height="56px"
        --item-line-height="1.3"
        --item-padding="0 12px"
        --item-hover-bg="rgba(255, 255, 255, 0.06)"
        --item-hover-color="#fff"
        --item-is-active-bg="rgba(134, 41, 252, 0.16)"
        --item-is-active-color="#fff"
        class="u-member-field !outline-none !w-full"
    >
        <div slot="item" let:item class="ma-row">
            <span
                class="ma-face"
                style="background: {Color.getColorByString(
                    nameOf(item.label)
                )}; color: {Color.getTextColorByBackgroundColor(Color.getColorByString(nameOf(item.label)))}"
                >{nameOf(item.label).charAt(0).toUpperCase()}</span
            >
            <span class="ma-tx">
                <span class="ma-t">{nameOf(item.label)}</span>
                {#if emailOf(item.label)}<span class="ma-m">{emailOf(item.label)}</span>{/if}
            </span>
        </div>
    </Select>
    <IconSearch class="ma-icon" font-size="18" />
</div>

<style>
    /* The game's field (u-join-field) with a search icon; each result shows the person's face colour, name and
       email, in the game's dropdown (UI/USelect). */
    .ma {
        position: relative;
    }
    .ma :global(.ma-icon) {
        position: absolute;
        left: 14px;
        top: 15px;
        color: rgba(255, 255, 255, 0.7);
        pointer-events: none;
    }
    :global(.svelte-select.u-member-field) {
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    }
    :global(.svelte-select.u-member-field.focused) {
        box-shadow: inset 0 0 0 2px rgba(196, 181, 253, 0.85);
    }
    /* As wide as the field, never wider: a wider list would push the panel sideways. */
    :global(.svelte-select.u-member-field .svelte-select-list) {
        left: 0 !important;
        width: 100% !important;
        padding: 6px;
    }
    :global(.svelte-select.u-member-field .svelte-select-list .item) {
        border-radius: 12px;
        line-height: normal;
        display: flex;
        align-items: center;
    }
    .ma-row {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
    }
    .ma-face {
        flex: none;
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        font-size: 14px;
        font-weight: 700;
        color: #fff;
    }
    .ma-tx {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }
    .ma-t {
        font-size: 14px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .ma-m {
        font-size: 12.5px;
        color: rgba(244, 242, 250, 0.64);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
</style>
