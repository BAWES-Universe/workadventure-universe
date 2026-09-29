<script lang="ts">
    import { setContext } from "svelte";
    import { openedMenuStore } from "../../../Stores/MenuStore";
    import ActionBarButton from "../ActionBarButton.svelte";
    import ExternalComponents from "../../ExternalModules/ExternalComponents.svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import { isCalendarVisibleStore } from "../../../Stores/CalendarStore";
    import { isTodoListVisibleStore } from "../../../Stores/TodoListStore";
    import { calendarAppVisibleStore, todoListAppVisibleStore } from "../../../Stores/AppsMenuStore";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import { mapEditorModeStore } from "../../../Stores/MapEditorStore";
    import AdditionalMenuItems from "./AdditionalMenuItems.svelte";
    import { IconCalendar, IconCheckList } from "@wa-icons";

    // The ActionBarButton component is displayed differently in the menu.
    // We use the context to decide how to render it.
    setContext("inMenu", true);

    function openExternalModuleCalendar() {
        analyticsClient.openExternalModuleCalendar();
        isCalendarVisibleStore.set(!$isCalendarVisibleStore);
        isTodoListVisibleStore.set(false);
        mapEditorModeStore.switchMode(false);
        openedMenuStore.closeAll();
    }

    function openExternalModuleTodoList() {
        analyticsClient.openExternalModuleTodoList();
        isTodoListVisibleStore.set(!$isTodoListVisibleStore);
        isCalendarVisibleStore.set(false);
        mapEditorModeStore.switchMode(false);
        openedMenuStore.closeAll();
    }
</script>

<!-- Built-in apps, hidden until they are finished (BUILT_IN_APPS_ENABLED, see docs/developer/apps-menu.md) -->
{#if $calendarAppVisibleStore}
    <ActionBarButton on:click={openExternalModuleCalendar} label={$LL.actionbar.calendar()}>
        <IconCalendar width="20" height="20" />
    </ActionBarButton>
{/if}

{#if $todoListAppVisibleStore}
    <ActionBarButton on:click={openExternalModuleTodoList} label={$LL.actionbar.todoList()}>
        <IconCheckList width="20" height="20" />
    </ActionBarButton>
{/if}

<!-- External module action bar -->
<ExternalComponents zone="actionBarAppsMenu" />

<AdditionalMenuItems menu="appsMenu" />
