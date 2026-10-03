/**
 * A gold hand with the person's number in line, next to their name on the map, while their hand is raised.
 * The picture is drawn once per number on a canvas (at 4 times the size, for a sharp result when zoomed in).
 */

const HAND_PATHS = [
    "M8 13V5.5a1.5 1.5 0 0 1 3 0V12",
    "M11 5.5v-2a1.5 1.5 0 1 1 3 0V12",
    "M14 5.5a1.5 1.5 0 0 1 3 0V12",
    "M17 7.5a1.5 1.5 0 0 1 3 0V16a6 6 0 0 1 -6 6h-2h.208a6 6 0 0 1 -5.012 -2.7L7 19c-.312 -.479 -1.407 -2.388 -3.286 -5.728a1.5 1.5 0 0 1 .536 -2.022a1.867 1.867 0 0 1 2.28 .28L8 13",
];

const GOLD = "#F5C451";
const INK = "#1D1606";
const RESOLUTION = 4;
const HEIGHT = 11;

function textureKey(position: number): string {
    return `raised-hand-badge-${position}`;
}

function ensureTexture(scene: Phaser.Scene, position: number): string {
    const key = textureKey(position);
    if (scene.textures.exists(key)) {
        return key;
    }
    const label = position > 0 ? String(position) : "";
    const iconSize = 8;
    const padding = 2;
    const textWidth = label ? label.length * 4.6 + 1 : 0;
    const width = Math.max(HEIGHT, padding + iconSize + textWidth + padding);

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * RESOLUTION);
    canvas.height = HEIGHT * RESOLUTION;
    const context = canvas.getContext("2d");
    if (!context) {
        return key;
    }
    context.scale(RESOLUTION, RESOLUTION);

    // Gold pill
    const radius = HEIGHT / 2;
    context.fillStyle = GOLD;
    context.beginPath();
    context.moveTo(radius, 0);
    context.lineTo(width - radius, 0);
    context.arc(width - radius, radius, radius, -Math.PI / 2, Math.PI / 2);
    context.lineTo(radius, HEIGHT);
    context.arc(radius, radius, radius, Math.PI / 2, (3 * Math.PI) / 2);
    context.fill();

    // Hand
    context.save();
    const iconX = label ? padding : (width - iconSize) / 2;
    context.translate(iconX, (HEIGHT - iconSize) / 2);
    context.scale(iconSize / 24, iconSize / 24);
    context.strokeStyle = INK;
    context.lineWidth = 2.4;
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const path of HAND_PATHS) {
        context.stroke(new Path2D(path));
    }
    context.restore();

    // Number in line
    if (label) {
        context.fillStyle = INK;
        context.font = "bold 7.5px Roboto, Arial, sans-serif";
        context.textBaseline = "middle";
        context.fillText(label, padding + iconSize + 0.5, HEIGHT / 2 + 0.4);
    }

    scene.textures.addCanvas(key, canvas);
    return key;
}

export class RaisedHandBadge extends Phaser.GameObjects.Image {
    private position = 0;

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y, ensureTexture(scene, 0));
        this.setOrigin(0, 0.5);
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
