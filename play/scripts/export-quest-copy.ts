import fs from "fs";
import path from "path";

// Writes the player strings of the `quest` namespace as flat JSON, one file per translated locale, for Orbit's
// preview to vendor (Orbit never types a player string itself). Missing translations fall back to en-US, as in game.
// Usage: npm run export-quest-copy [-- <outDir>]   (default: dist-quest-copy/)
const LOCALES = ["en-US", "fr-FR", "ar-SA"] as const;

type Copy = { [key: string]: string | Copy };

async function loadNamespace(locale: string): Promise<Copy> {
    const mod = (await import(path.resolve(__dirname, `../src/i18n/${locale}/quest.ts`))) as { default?: Copy };
    if (!mod.default) throw new Error(`No default export in ${locale}/quest.ts`);
    return mod.default;
}

function mergeCopy(base: Copy, override: Copy): Copy {
    const merged: Copy = {};
    for (const [key, value] of Object.entries(base)) {
        const other = override[key];
        if (typeof value === "string") merged[key] = typeof other === "string" ? other : value;
        else merged[key] = mergeCopy(value, typeof other === "object" && other !== null ? other : {});
    }
    return merged;
}

// "{count:number}" becomes "{count}": the type is for the game's generator, not for readers of the copy.
function plainParameters(text: string): string {
    return text.replace(/\{(\w+):\w+\}/g, "{$1}");
}

function flatten(copy: Copy, prefix = "", out: Record<string, string> = {}): Record<string, string> {
    for (const [key, value] of Object.entries(copy)) {
        const id = prefix ? `${prefix}.${key}` : key;
        if (typeof value === "string") out[id] = plainParameters(value);
        else flatten(value, id, out);
    }
    return out;
}

async function main(): Promise<void> {
    const outDir = path.resolve(process.cwd(), process.argv[2] ?? "dist-quest-copy");
    fs.mkdirSync(outDir, { recursive: true });
    const [base, ...translations] = await Promise.all(LOCALES.map((locale) => loadNamespace(locale)));
    for (const [index, locale] of LOCALES.entries()) {
        const copy = index === 0 ? base : mergeCopy(base, translations[index - 1]);
        const file = path.join(outDir, `quest-copy.${locale}.json`);
        const body = {
            namespace: "quest",
            locale,
            version: 1,
            // typesafe-i18n syntax: {name} is a parameter; {{s}} or {{one|other}} pluralises on the number before it.
            format: "typesafe-i18n",
            strings: flatten(copy),
        };
        fs.writeFileSync(file, JSON.stringify(body, null, 2) + "\n");
        console.log(`Wrote ${file}`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
