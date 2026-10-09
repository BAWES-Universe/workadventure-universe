import type { ComponentProps, ComponentType, SvelteComponentTyped } from "svelte";
import type { ComputePositionConfig } from "@floating-ui/dom";
import { arrow, autoUpdate, computePosition, flip, limitShift, offset, shift } from "@floating-ui/dom";
import { writable } from "svelte/store";
import { v4 } from "uuid";
import type { ArrowAction, ContentAction } from "./svelte-floatingui";

export const floatingUiComponents = writable(
    new Map<
        string,
        {
            componentType: ComponentType<SvelteComponentTyped>;
            props?: ComponentProps<SvelteComponentTyped>;
            action: ContentAction;
            arrowAction: ArrowAction | undefined;
            /** Kept on the page but not shown (see showHideableFloatingUi). */
            hidden?: boolean;
        }
    >()
);

/**
 * Use this function to display a popup on top/bottom of an element. Unlike the `createFloatingUiActions` function, this function
 * is passed the popup in parameter and will display it at the right position. The element in the DOM will be close to the root element.
 * As a result, you don't have to worry about the popup being clipped by the parent element because of "overflow: hidden".
 */
export function showFloatingUi<Component extends SvelteComponentTyped>(
    referenceNode: Element,
    component: ComponentType<Component>,
    props: ComponentProps<Component>,
    options?: Partial<ComputePositionConfig>,
    offsetMainAxis = 0,
    withArrow = true
): () => void {
    return mountFloatingUi(referenceNode, component, props, options, offsetMainAxis, withArrow).destroy;
}

export interface HideableFloatingUi {
    show(): void;
    hide(): void;
    destroy(): void;
}

/**
 * Like `showFloatingUi`, but closing hides the popup instead of removing it: opening it again shows the same one,
 * as it was. For popups that are slow to build or that must not be built twice in a row (the emoji picker).
 */
export function showHideableFloatingUi<Component extends SvelteComponentTyped>(
    referenceNode: Element,
    component: ComponentType<Component>,
    props: ComponentProps<Component>,
    options?: Partial<ComputePositionConfig>,
    offsetMainAxis = 0,
    withArrow = true
): HideableFloatingUi {
    const { id, destroy } = mountFloatingUi(referenceNode, component, props, options, offsetMainAxis, withArrow);
    const setHidden = (hidden: boolean) => {
        floatingUiComponents.update((components) => {
            const entry = components.get(id);
            if (entry && entry.hidden !== hidden) {
                components.set(id, { ...entry, hidden });
            }
            return components;
        });
    };
    return {
        show: () => setHidden(false),
        hide: () => setHidden(true),
        destroy,
    };
}

function mountFloatingUi<Component extends SvelteComponentTyped>(
    referenceNode: Element,
    component: ComponentType<Component>,
    props: ComponentProps<Component>,
    options: Partial<ComputePositionConfig> | undefined,
    offsetMainAxis: number,
    withArrow: boolean
): { id: string; destroy: () => void } {
    let arrowNode: HTMLElement | undefined;
    let contentNode: HTMLElement | undefined;
    let cleanup: (() => void) | null = null;

    const contentAction: ContentAction = (node) => {
        contentNode = node;
        //options = { ...initOptions, ...contentOptions };
        initFloatingUi();
        return {
            destroy() {
                deinitFloatingUi();
            },
        };
    };

    const arrowAction: ArrowAction = (node) => {
        arrowNode = node;
        initFloatingUi();
        return {
            destroy() {
                deinitFloatingUi();
            },
        };
    };

    const id = v4();
    floatingUiComponents.update((components) => {
        components.set(id, {
            componentType: component,
            props,
            action: contentAction,
            arrowAction: withArrow ? arrowAction : undefined,
        });
        return components;
    });

    const updatePosition = () => {
        if (referenceNode && contentNode) {
            const middlewares = [
                flip(),
                shift({ padding: 5, limiter: limitShift() }),
                offset({ mainAxis: offsetMainAxis }),
            ];
            if (arrowNode) {
                middlewares.push(arrow({ element: arrowNode }));
            }

            computePosition(referenceNode, contentNode, {
                placement: "top",
                ...options,
                middleware: middlewares,
            })
                .then(({ x, y, placement, middlewareData }) => {
                    if (contentNode) {
                        Object.assign(contentNode.style, {
                            left: `${x}px`,
                            top: `${y}px`,
                        });

                        if (arrowNode) {
                            const arrowX = middlewareData.arrow?.x;
                            const arrowY = middlewareData.arrow?.y;
                            const staticSide = {
                                top: "bottom",
                                right: "left",
                                bottom: "top",
                                left: "right",
                            }[placement.split("-")[0]];

                            if (staticSide === undefined) {
                                throw new Error("Invalid placement");
                            }
                            Object.assign(arrowNode.style, {
                                left: arrowX != null ? `${arrowX}px` : "",
                                top: arrowY != null ? `${arrowY}px` : "",
                                right: "",
                                bottom: "",
                                [staticSide]: "-4px",
                            });
                            arrowNode.classList.add("floating-ui-arrow");
                            arrowNode.dataset.arrowPlacement = staticSide;
                        }
                    }
                })
                .catch((e) => {
                    console.error(e);
                });
        }
    };

    const initFloatingUi = () => {
        if (referenceNode !== undefined && contentNode !== undefined) {
            if (cleanup) {
                // Is this normal?
                cleanup();
            }
            cleanup = autoUpdate(referenceNode, contentNode, () => {
                updatePosition();
            });
        }
    };

    const deinitFloatingUi = () => {
        if (cleanup !== null) {
            cleanup();
            cleanup = null;
        }
    };

    return {
        id,
        destroy: () => {
            cleanup?.();
            cleanup = null;
            floatingUiComponents.update((components) => {
                components.delete(id);
                return components;
            });
        },
    };
}
