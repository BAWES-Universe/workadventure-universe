<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import InputTags from "./InputTags.svelte";
    import type { InputTagOption } from "./InputTagOption";

    const dispatch = createEventDispatcher<{
        change: InputTagOption[] | undefined;
    }>();

    export let value: InputTagOption[] | undefined;
    // Passed on one by one, never as a spread: a spread hands every prop down again on each change, which, with
    // bind:value coming back up, sends the select's value round and round until the page stops responding.
    export let label: string | undefined = undefined;
    export let options: InputTagOption[] = [];
    export let placeholder: string | undefined = undefined;
    export let optional = false;
    export let handleChange: () => void = () => {};
    export let testId: string | undefined = undefined;

    function _handleChange() {
        dispatch("change", value);
    }

    async function searchRoomTags(filterText: string): Promise<{ value: string; label: string }[]> {
        const customTag = {
            value: filterText,
            label: filterText,
        };
        if (filterText.length === 0) return [];
        const connection = gameManager.getCurrentGameScene().connection;
        if (connection) {
            try {
                const tags = await connection.queryTags(filterText);
                const result = tags.map((tag) => {
                    return {
                        value: tag,
                        label: tag,
                    };
                });
                result.push(customTag);
                return result;
            } catch (error) {
                console.error(error);
                return [customTag];
            }
        }
        return [customTag];
    }
</script>

<div class="flex flex-col w-full">
    <div>
        <InputTags
            bind:value
            queryOptions={searchRoomTags}
            on:change={_handleChange}
            {label}
            {options}
            {placeholder}
            {optional}
            {handleChange}
            {testId}
        >
            <span slot="info"> <slot name="info" /> </span>
        </InputTags>
    </div>
</div>
