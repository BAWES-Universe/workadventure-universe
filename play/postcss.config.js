/* eslint-disable @typescript-eslint/no-require-imports */
// Every "full height" in the CSS (100dvh, 100vh: Tailwind's h-dvh and h-screen, the windows and the chat sheet) means
// the height of the page. In the installed computer app, which draws its own title bar over the top of the window
// (#1019), the page starts below that bar and is shorter by its height. The bar sets --u-dvh to the page's height
// (TitleBar.svelte); everywhere else the variable is unset and the value is the browser's, as before.
const underTitleBar = () => ({
    postcssPlugin: "under-title-bar",
    Declaration(decl) {
        if (decl.prop === "--u-dvh" || decl.value.includes("--u-dvh")) return;
        const value = decl.value.replace(/(?<![\w.-])100(d?vh)(?![\w-])/g, (full) => `var(--u-dvh, ${full})`);
        if (value !== decl.value) decl.value = value;
    },
});
underTitleBar.postcss = true;

module.exports = {
    plugins: [require("tailwindcss"), require("autoprefixer"), underTitleBar],
};
