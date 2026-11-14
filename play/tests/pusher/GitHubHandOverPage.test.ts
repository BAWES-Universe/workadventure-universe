import { describe, expect, it } from "vitest";
import { gitHubHandOverPage } from "../../src/pusher/controllers/GitHubHandOverPage";

/** The page GitHub's sign-in comes back to (#2041): it hands the code to the window of ours that opened it, and to no one else. */
describe("the GitHub sign-in return page", () => {
    it("hands the code to the window that opened it, on this site only, and takes it out of the address", () => {
        const page = gitHubHandOverPage("STATE", "CODE");
        expect(page).toContain(
            'back.postMessage({ type: "oauth-github", state: state, code: code }, window.location.origin)'
        );
        expect(page).toContain('var state = "STATE";');
        expect(page).toContain('var code = "CODE";');
        expect(page).toContain("history.replaceState");
        expect(page).toContain('<meta name="referrer" content="no-referrer" />');
        // A top-level "var opener" is window.opener itself in a browser: setting it would cut the page off from that window
        expect(page).not.toMatch(/var opener\b/);
        expect(page).toContain("(function () {");
    });

    it("cannot be broken out of with what is put in the address", () => {
        const page = gitHubHandOverPage("</script><script>alert(1)</script>", 'a"; alert(2); "');
        expect(page).not.toContain("</script><script>alert(1)");
        expect(page).toContain('var code = "a\\"; alert(2); \\"";');
    });

    it("tells the window that opened it to stop waiting when it came back without a code", () => {
        const page = gitHubHandOverPage("", "");
        expect(page).toContain('back.postMessage({ type: "oauth-failure" }, window.location.origin)');
    });
});
