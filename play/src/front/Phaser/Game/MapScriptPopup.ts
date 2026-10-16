export interface MapScriptPopupButton {
    label: string;
    className?: string;
}

export interface MapScriptPopupElements {
    /** Outer node handed to Phaser (Phaser overwrites its class, so the styled box is its child). */
    element: HTMLDivElement;
    /** The styled box. Created hidden, the caller reveals it. */
    container: HTMLDivElement;
    /** One button per descriptor, in the order given. */
    buttons: HTMLButtonElement[];
}

/**
 * Maps the className a map script gave a button to the Universe button class.
 * At runtime it can be any string, so anything unknown falls back to the neutral button.
 */
function variantClass(className: string | undefined): string {
    switch (className) {
        case "primary":
        case "success":
            return "u-cta";
        case "warning":
        case "error":
            return "u-cta-coral";
        default:
            return "u-cta-secondary";
    }
}

/**
 * Builds the popup opened by WA.ui.openPopup() with DOM calls only: the script's text always goes through
 * textContent and never into markup or an attribute, so it cannot inject anything.
 */
export function buildMapScriptPopup(
    popupId: number,
    message: string,
    buttons: MapScriptPopupButton[]
): MapScriptPopupElements {
    const element = document.createElement("div");

    const container = document.createElement("div");
    container.id = "container";
    container.className = "u-map-popup u-surface";
    container.hidden = true;
    element.appendChild(container);

    if (message) {
        const messageDiv = document.createElement("div");
        messageDiv.className = "u-map-popup-msg";
        messageDiv.textContent = message;
        container.appendChild(messageDiv);
    }

    const buttonElements: HTMLButtonElement[] = [];
    if (buttons.length > 0) {
        const actions = document.createElement("div");
        actions.className = "u-map-popup-actions";
        // Two buttons share a row when their labels fit, see style.scss.
        if (buttons.length === 2) {
            actions.classList.add("is-pair");
        }
        buttons.forEach((descriptor, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.id = `popup-${popupId}-${index}`;
            button.className = `u-map-popup-btn ${variantClass(descriptor.className)}`;
            button.textContent = descriptor.label;
            if (descriptor.className === "disabled") {
                button.disabled = true;
            }
            actions.appendChild(button);
            buttonElements.push(button);
        });
        container.appendChild(actions);
    }

    return { element, container, buttons: buttonElements };
}
