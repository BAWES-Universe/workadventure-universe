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

    public getEntityPrefabsPositions(color: string): EntityPrefab[] {
        const entityPrefabsPositions = this.variants.get(color);
        if (!entityPrefabsPositions) {
            Sentry.captureException("Could not find color for variant");
            throw new Error("Could not find color for variant");
        }
        return [...entityPrefabsPositions.values()];
    }

    /** Whether one of this object's colours or sides is the prefab with this id. */
    public hasPrefab(id: string): boolean {
        for (const sides of this.variants.values()) {
            for (const prefab of sides.values()) {
                if (prefab.id === id) return true;
            }
        }
        return false;
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
