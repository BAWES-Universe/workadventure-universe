/** A value safe to put inside a <script> block (quotes, new lines and a closing script tag cannot break out). */
const scriptValue = (value: string) => JSON.stringify(value).replace(/</g, "\\u003c");

/**
 * The page GitHub's sign-in comes back to (game #2041): it hands the code to the window that opened the sign-in (same site only),
 * takes it out of the address, and waits for that window to finish, which then closes it or sends it on to pick where the app
 * works. Opened any other way (no window of ours behind it), it says to start again from Universe.
 */
export function gitHubHandOverPage(state: string, code: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="referrer" content="no-referrer" />
  <title>GitHub</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0e0e10; color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; text-align: center; padding: 2rem;
    }
    p { font-size: 1rem; color: #9ca3af; max-width: 420px; }
  </style>
</head>
<body>
  <p id="github-message">Finishing your GitHub sign-in…</p>
  <script>
    var state = ${scriptValue(state)};
    var code = ${scriptValue(code)};
    try { history.replaceState(null, "", location.pathname); } catch (e) { /* nothing to tidy */ }
    var opener = null;
    try { opener = window.opener; } catch (e) { /* the window that opened this is gone */ }
    if (opener && state && code) {
      opener.postMessage({ type: "oauth-github", state: state, code: code }, window.location.origin);
    } else if (opener) {
      // Came back without what it needs: the window that opened it stops waiting
      opener.postMessage({ type: "oauth-failure" }, window.location.origin);
      document.getElementById("github-message").textContent = "The GitHub sign-in did not finish. Go back to Universe and try again.";
      setTimeout(function () { window.close(); }, 5000);
    } else {
      document.getElementById("github-message").textContent = "This sign-in was not started here. Go back to Universe and press Connect GitHub again.";
    }
  </script>
</body></html>`;
}
