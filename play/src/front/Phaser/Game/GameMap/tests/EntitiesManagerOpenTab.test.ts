import { describe, expect, it, vi } from "vitest";
import { EntitiesManager } from "../EntitiesManager";

vi.hoisted(() => {
    // The manager only needs Phaser's emitter and the event names it listens to, and the browser environment settings.
    (globalThis as unknown as { Phaser: unknown }).Phaser = {
        Events: { EventEmitter: class {} },
        Input: { Events: new Proxy({}, { get: (_target, name) => String(name) }) },
    };
    (window as unknown as { env: Record<string, unknown> }).env = {};
});
vi.mock("../../../ECS/Entity", () => ({
    Entity: class {},
    EntityEvent: {
        Delete: "EntityEvent:Delete",
        Updated: "EntityEvent:Updated",
        PropertyActivated: "EntityEvent:PropertyActivated",
    },
}));
vi.mock("../../../Helpers/TexturesHelper", () => ({ TexturesHelper: class {} }));
vi.mock("../../MapEditor/MapEditorModeManager", () => ({ EditorToolName: {} }));
vi.mock("../../../../Stores/MapEditorStore", () => {
    const store = { subscribe: () => () => undefined, set: () => undefined };
    return {
        mapEditorEntityModeStore: store,
        mapEditorModeStore: store,
        mapEditorSelectedEntityDraggedStore: store,
        mapEditorSelectedEntityPrefabStore: store,
        mapEditorSelectedEntityStore: store,
        mapEditorSelectedToolStore: store,
    };
});

/** Like GameMapFrontWrapper.triggerAllProperties: a property fires only when its value changes. */
function propertyWatcher(manager: EntitiesManager) {
    let last = new Map<string, string | number | boolean>();
    const fired: (string | number | boolean | undefined)[] = [];
    return {
        fired,
        wrapper: {
            handleEntityActionTrigger: () => {
                const now = new Map(manager.getProperties());
                if (now.get("openTab") !== last.get("openTab")) fired.push(now.get("openTab"));
                last = now;
            },
        },
    };
}

function managerWithEntity() {
    const manager = Object.create(EntitiesManager.prototype) as EntitiesManager;
    const watcher = propertyWatcher(manager);
    Object.assign(manager, { properties: new Map(), gameMapFrontWrapper: watcher.wrapper });
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const entity = { on: (event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler) };
    (manager as unknown as { bindEntityEventHandlers(entity: unknown): void }).bindEntityEventHandlers(entity);
    const click = (link: string) =>
        handlers.get("EntityEvent:PropertyActivated")?.({ propertyName: "openTab", propertyValue: link });
    return { manager, click, fired: watcher.fired };
}

describe("an object that opens its link in a new tab (#1738)", () => {
    it("opens it on every click, not only the first", () => {
        const { click, fired } = managerWithEntity();

        click("https://example.com/a");
        click("https://example.com/a");
        click("https://example.com/a");

        expect(fired.filter((value) => value === "https://example.com/a")).toHaveLength(3);
    });

    it("opens another object's link once per click", () => {
        const { click, fired } = managerWithEntity();

        click("https://example.com/a");
        click("https://example.com/b");

        expect(fired).toEqual(["https://example.com/a", "https://example.com/b"]);
    });
});
