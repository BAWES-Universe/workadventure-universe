import type { EntityPrefab } from "@workadventure/map-editor";
import * as Sentry from "@sentry/svelte";

export class EntityVariant {
    private readonly _id: string;
    private readonly _defaultPrefab: EntityPrefab;
    private variants: Map<string, Map<string, EntityPrefab>>;
    constructor(defaultPrefab: EntityPrefab) {
        this._id = defaultPrefab.id;
        this._defaultPrefab = defaultPrefab;
        this.variants = new Map();
        this.addPrefab(defaultPrefab);
    }

    public get id(): string {
        return this._id;
    }

    public get defaultPrefab(): EntityPrefab {
        return this._defaultPrefab;
    }

    public get colors(): string[] {
        return [...this.variants.keys()];
    }

    /** Every picture of this object, in the order they were added. */
    public get prefabs(): EntityPrefab[] {
        return [...this.variants.values()].flatMap((sides) => [...sides.values()]);
    }

    /** The picture of one side in one colour, if the object has it. */
    public getPrefab(color: string, direction: EntityPrefab["direction"]): EntityPrefab | undefined {
        return this.variants.get(color)?.get(direction);
    }

    public getEntityPrefabsPositions(color: string): EntityPrefab[] {
        const entityPrefabsPositions = this.variants.get(color);
        if (!entityPrefabsPositions) {
            Sentry.captureException("Could not find color for variant");
            throw new Error("Could not find color for variant");
        }
        return [...entityPrefabsPositions.values()];
    }

    public addPrefab(prefab: EntityPrefab) {
        let colorMap = this.variants.get(prefab.color);
        if (colorMap === undefined) {
            colorMap = new Map<string, EntityPrefab>();
            this.variants.set(prefab.color, colorMap);
        }
        colorMap.set(prefab.direction, prefab);
    }
}
