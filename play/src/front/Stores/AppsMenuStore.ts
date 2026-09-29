import { derived } from "svelte/store";
import { isActivatedStore as isCalendarActivatedStore } from "./CalendarStore";
import { isActivatedStore as isTodoListActivatedStore } from "./TodoListStore";
import { externalSvelteComponentService } from "./Utils/externalSvelteComponentService";
import { getAdditionalMenuItemStore } from "./AdditionalItemsMenuStore";

/**
 * The built-in Calendar and To-do apps. They are not finished, so they stay hidden until we decide to ship them
 * (or to offer them from a map instead). See docs/developer/apps-menu.md.
 */
export const BUILT_IN_APPS_ENABLED = false;

export const calendarAppVisibleStore = derived(
    isCalendarActivatedStore,
    ($activated) => BUILT_IN_APPS_ENABLED && $activated
);

export const todoListAppVisibleStore = derived(
    isTodoListActivatedStore,
    ($activated) => BUILT_IN_APPS_ENABLED && $activated
);

/**
 * Whether the apps menu has anything in it: a button a map added (WA.ui.actionBar.addButton with location "appsMenu"),
 * a component one of our modules registered in the "actionBarAppsMenu" zone, or a built-in app. The apps button only
 * shows when it does.
 */
export const appsMenuHasItemsStore = derived(
    [
        calendarAppVisibleStore,
        todoListAppVisibleStore,
        externalSvelteComponentService.getComponentsByZone("actionBarAppsMenu"),
        getAdditionalMenuItemStore("appsMenu"),
    ],
    ([$calendar, $todoList, $externalComponents, $additionalItems]) =>
        $calendar || $todoList || $externalComponents.size > 0 || $additionalItems.size > 0
);
