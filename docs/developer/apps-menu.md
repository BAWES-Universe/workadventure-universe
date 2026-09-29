# The Apps menu

The Apps menu is the dropdown behind the grid button in the action bar, next to **Explore**. It holds apps that sit on
top of the game: third-party integrations, tools a map brings with it, or apps we build ourselves.

It is kept for customisation, but it only shows when it has something in it. Today nothing puts anything there, so
players don't see the button until a map or a module adds an app.

The room list used to live in this menu. It now has its own button, **Explore {Universe}**, which lists the rooms of
every world in the universe (see `play/src/front/Components/ActionBar/MenuIcons/ExploreMenuItem.svelte`).

## When the button shows

`appsMenuHasItemsStore` in `play/src/front/Stores/AppsMenuStore.ts` decides. The button shows when any of these is
true:

- a map script added a button with `location: "appsMenu"`
- one of our external modules registered a component in the `actionBarAppsMenu` zone
- a built-in app (Calendar, To-do) is both switched on and activated

On narrow screens the menu moves into the hamburger (profile) menu under its own heading, like the other contextual
items (`ContextualMenuItems.svelte`).

## Adding an app from a map

A map's script can add a button to the menu with the scripting API. Nothing needs to change in the game:

```ts
WA.ui.actionBar.addButton({
  id: "whiteboard",
  label: "Whiteboard",
  location: "appsMenu",
  callback: () => {
    WA.nav.openCoWebSite("https://whiteboard.example.com");
  },
});

// And to take it away again:
WA.ui.actionBar.removeButton("whiteboard");
```

See [`WA.ui.actionBar.addButton`](map-scripting/references/api-ui.md) for every option. This is the right choice for
an app that belongs to one map or one world: it ships with the map and its builders own it.

## Adding an app from our own code

An app every room should have belongs in the game. External modules (`play/src/front/external-modules/`) add a Svelte
component to the menu through the `externalSvelteComponent` service in the options their `init` receives:

```ts
options.externalSvelteComponent.addComponentToZone(
  "actionBarAppsMenu",
  "my-app",
  MyAppMenuItem,
  {
    /* props */
  }
);

// And to take it away again:
options.externalSvelteComponent.removeComponentFromZone(
  "actionBarAppsMenu",
  "my-app"
);
```

Inside the menu, render the entry with `ActionBarButton` (it reads the `inMenu` context and draws itself as a menu
row). Close the menu when the app opens with `openedMenuStore.closeAll()`.

## The built-in Calendar and To-do

Calendar and To-do come from upstream WorkAdventure. They show events and tasks that an external module (a Microsoft
Teams or Google integration, for example) pushes into `CalendarStore` and `TodoListStore`, and they only work once such
a module sets their `isActivatedStore`. We don't ship one, so they are hidden:

- `BUILT_IN_APPS_ENABLED` in `play/src/front/Stores/AppsMenuStore.ts` is `false`.
- Their code (`Components/Calendar`, `Components/TodoList`, their stores and their panels in `GameOverlay.svelte`) is
  unchanged, so turning them back on is a one-line change.

To bring them back, set `BUILT_IN_APPS_ENABLED` to `true` and add a module that fills their stores and sets
`isActivatedStore` to `true`. Admins no longer see them greyed out while they are off.

## Choosing between a map and our code

- **One map or one world needs it** (a game, a whiteboard for a classroom): add it from the map's script.
- **Every room should have it** (calendar, tasks, a Universe-wide tool): build it as an external module, or finish
  the built-in apps above.
