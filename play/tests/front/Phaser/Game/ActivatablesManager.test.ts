import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/front/Phaser/Entity/RemotePlayer", () => ({ RemotePlayer: class {} }));
vi.mock("../../../../src/front/Phaser/ECS/Entity", () => ({ Entity: class {} }));
vi.mock("../../../../src/front/Utils/TriggerHint", () => ({ getTriggerHint: () => "" }));

import { ActivatablesManager } from "../../../../src/front/Phaser/Game/ActivatablesManager";
import type { ActivatableInterface } from "../../../../src/front/Phaser/Game/ActivatableInterface";
import type { Player } from "../../../../src/front/Phaser/Player/Player";

function makeActivatable(x: number): ActivatableInterface {
    return {
        activationRadius: 100,
        isActivatable: () => true,
        activate: vi.fn(),
        deactivate: vi.fn(),
        getPosition: () => ({ x, y: 0 }),
        destroyText: vi.fn(),
        playText: vi.fn(),
    } as unknown as ActivatableInterface;
}

function makeManager(): ActivatablesManager {
    const player = {
        getDirectionalActivationPosition: () => ({ x: 0, y: 0 }),
    } as unknown as Player;
    return new ActivatablesManager(player);
}

describe("ActivatablesManager.removeActivatableObject", () => {
    it("clears the selection by distance when the selected object is removed", () => {
        const manager = makeManager();
        const object = makeActivatable(10);
        manager.updateActivatableObjectsDistances([object]);
        manager.deduceSelectedActivatableObjectByDistance();
        expect(manager.getSelectedActivatableObject()).toBe(object);

        manager.removeActivatableObject(object);

        expect(manager.getSelectedActivatableObject()).toBeUndefined();
    });

    it("clears the selection by pointer when the hovered object is removed", () => {
        const manager = makeManager();
        const object = makeActivatable(500);
        manager.handlePointerOverActivatableObject(object);
        expect(manager.getSelectedActivatableObject()).toBe(object);

        manager.removeActivatableObject(object);

        expect(manager.getSelectedActivatableObject()).toBeUndefined();
    });

    it("selects the next nearest object once the selected one is removed", () => {
        const manager = makeManager();
        const near = makeActivatable(10);
        const farther = makeActivatable(50);
        manager.updateActivatableObjectsDistances([near, farther]);
        manager.deduceSelectedActivatableObjectByDistance();
        expect(manager.getSelectedActivatableObject()).toBe(near);

        manager.removeActivatableObject(near);

        expect(manager.getSelectedActivatableObject()).toBe(farther);
    });
});
