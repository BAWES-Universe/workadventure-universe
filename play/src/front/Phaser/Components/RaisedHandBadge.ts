/**
 * The ✋ with the person's number in line, above their name on the map, while their hand is raised. It matches the
 * raise hand button while the hand is up: an ink pill with a gold edge and a gold number.
 * The picture is drawn once per number on a canvas (at 4 times the size, for a sharp result when zoomed in).
 */

const GOLD = "#F5C451";
const INK = "#14121E";
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const RESOLUTION = 4;
const HEIGHT = 13;

function textureKey(position: number): string {
    return `raised-hand-badge-${position}`;
}

function ensureTexture(scene: Phaser.Scene, position: number): string {
    const key = textureKey(position);
    if (scene.textures.exists(key)) {
        return key;
    }
    const label = position > 0 ? String(position) : "";
    const iconSize = 9;
    const padding = 2.5;
    const textWidth = label ? label.length * 5.2 + 1 : 0;
    const width = Math.max(HEIGHT, padding + iconSize + textWidth + padding);

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * RESOLUTION);
    canvas.height = HEIGHT * RESOLUTION;
    const context = canvas.getContext("2d");
    if (!context) {
        return key;
    }
    context.scale(RESOLUTION, RESOLUTION);

    // Ink pill with a gold edge
    const radius = HEIGHT / 2;
    const pill = new Path2D();
    pill.moveTo(radius, 0.5);
    pill.lineTo(width - radius, 0.5);
    pill.arc(width - radius, radius, radius - 0.5, -Math.PI / 2, Math.PI / 2);
    pill.lineTo(radius, HEIGHT - 0.5);
    pill.arc(radius, radius, radius - 0.5, Math.PI / 2, (3 * Math.PI) / 2);
    context.fillStyle = INK;
    context.fill(pill);
    context.strokeStyle = GOLD;
    context.lineWidth = 0.8;
    context.stroke(pill);

    // ✋
    const iconX = label ? padding : (width - iconSize) / 2;
    context.font = `${iconSize - 0.5}px ${EMOJI_FONT}`;
    context.textBaseline = "middle";
    context.fillText("✋", iconX, HEIGHT / 2 + 0.4);

    // Number in line
    if (label) {
        context.fillStyle = GOLD;
        context.font = "bold 8.5px Roboto, Arial, sans-serif";
        context.textBaseline = "middle";
        context.fillText(label, padding + iconSize + 0.5, HEIGHT / 2 + 0.4);
    }

    // Smooth scaling: the map's pixel-art filter would make the emoji and number unreadable at this size.
    scene.textures.addCanvas(key, canvas)?.setFilter(Phaser.Textures.FilterMode.LINEAR);
    return key;
}

export class RaisedHandBadge extends Phaser.GameObjects.Image {
    private position = 0;

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y, ensureTexture(scene, 0));
        this.setOrigin(0.5, 0.5);
        this.setScale(1 / RESOLUTION);
        this.setVisible(false);
        this.scene.add.existing(this);
    }

    /** Shows the badge with this number in line (0 while the number isn't known yet), or hides it (undefined). */
    public showPlace(position: number | undefined): void {
        if (position === undefined) {
            this.setVisible(false);
            return;
        }
        if (position !== this.position || !this.visible) {
            this.position = position;
            this.setTexture(ensureTexture(this.scene, position));
        }
        this.setVisible(true);
    }
}
