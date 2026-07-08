import type { Express, Request, Response } from "express";

export class OAuthPopupCallbackController {
    constructor(private app: Express) {
        this.app.get("/oauth-popup-callback.html", this.callback.bind(this));
    }

    private callback(req: Request, res: Response): void {
        const params = new URLSearchParams(req.url.split("?")[1] || "");
        const isSuccess = params.get("oauth") === "success";
        const errorMessage = params.get("message") || "";

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>OAuth ${isSuccess ? "Connected" : "Failed"}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0e0e10;
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      text-align: center;
      padding: 2rem;
    }
    .container { max-width: 480px; }
    .icon {
      width: 80px; height: 80px;
      margin: 0 auto 1.5rem;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.5rem;
      color: #fff;
      line-height: 1;
    }
    .icon.success { background: #10b981; }
    .icon.error { background: #ef4444; }
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; color: #f0f0f0; }
    p { font-size: 1rem; color: #9ca3af; margin-bottom: 0.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon ${isSuccess ? "success" : "error"}">${isSuccess ? "&#10003;" : "&#10005;"}</div>
    <h1>OAuth ${isSuccess ? "Connected" : "Failed"}</h1>
    <p>${isSuccess ? "Successfully authenticated." : escapeHtml(errorMessage)}</p>
  </div>
  <script>
    var success = ${isSuccess};
    try {
      if (window.opener) {
        window.opener.postMessage(
          { type: success ? 'oauth-success' : 'oauth-failure' },
          '*'
        );
      }
    } catch {
      // Cross-origin — opener may be null
    }
    window.close();
  </script>
</body>
</html>`;

        res.status(200).send(html);
    }
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
