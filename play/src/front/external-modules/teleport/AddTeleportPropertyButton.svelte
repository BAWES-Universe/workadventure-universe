<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { IconRoute } from "../../Components/Icons";
    import AddPropertyButton from "../../Components/MapEditor/PropertyEditor/AddPropertyButton.svelte";

    const dispatch = createEventDispatcher<{
        click: CustomEvent;
    }>();
</script>

<AddPropertyButton
    headerText="Portal to any room"
    descriptionText="Hop to a friend’s room in any universe"
    img={IconRoute}
    style="z-index: 200;"
    testId="teleport"
    on:click={(event) => {
        dispatch("click", event);
    }}
/>
