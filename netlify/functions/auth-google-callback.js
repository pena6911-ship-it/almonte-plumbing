/**
 * /api/auth/google/callback
 * Exchanges the OAuth code for tokens and displays the refresh token
 * so you can save it to .env.local as GOOGLE_REFRESH_TOKEN.
 */

exports.handler = async (event) => {
  const { code, error } = event.queryStringParameters || {};

  if (error) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html' },
      body: `<h2>❌ OAuth Error</h2><p>${error}</p><a href="/admin/">← Back to Admin</a>`,
    };
  }

  if (!code) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html' },
      body: `<h2>❌ No code received</h2><a href="/admin/">← Back to Admin</a>`,
    };
  }

  // Exchange authorization code for tokens
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  `${process.env.SITE_URL}/api/auth/google/callback`,
      grant_type:    'authorization_code',
      code,
    }),
  });

  const tokens = await res.json();

  if (!res.ok || !tokens.refresh_token) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: `
        <h2>❌ Token exchange failed</h2>
        <pre>${JSON.stringify(tokens, null, 2)}</pre>
        <p>Make sure the redirect URI in Google Cloud Console exactly matches:<br>
        <code>${process.env.SITE_URL}/api/auth/google/callback</code></p>
        <a href="/admin/">← Back to Admin</a>
      `,
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Google Calendar Connected</title>
        <style>
          body { font-family: -apple-system, sans-serif; max-width: 600px; margin: 3rem auto; padding: 1rem; }
          h2 { color: #1A4D2E; }
          .token-box { background: #f4f6f4; border: 1px solid #d1d9d4; border-radius: 8px; padding: 1rem; word-break: break-all; font-family: monospace; font-size: .85rem; margin: 1rem 0; }
          .step { background: #fff; border: 1px solid #e4e4e0; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
          .step h3 { margin: 0 0 .5rem; font-size: 1rem; }
          button { background: #1A4D2E; color: #fff; border: none; padding: .6rem 1.2rem; border-radius: 6px; cursor: pointer; font-size: .9rem; }
          button.copied { background: #166534; }
          a { color: #1A4D2E; }
        </style>
      </head>
      <body>
        <h2>✅ Google Calendar Connected!</h2>
        <p>Copy your refresh token and add it to <code>.env.local</code>, then restart <code>netlify dev</code>.</p>

        <div class="step">
          <h3>1. Your Refresh Token</h3>
          <div class="token-box" id="token">${tokens.refresh_token}</div>
          <button onclick="copyToken()">Copy Token</button>
          <span id="copy-msg" style="margin-left:.75rem;color:#166534;display:none;">Copied!</span>
        </div>

        <div class="step">
          <h3>2. Add to .env.local</h3>
          <p>Open <code>.env.local</code> and set:</p>
          <div class="token-box">GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}</div>
        </div>

        <div class="step">
          <h3>3. Restart netlify dev</h3>
          <p>Stop the server (Ctrl+C) and run <code>npx netlify dev</code> again to pick up the new env var.</p>
        </div>

        <a href="/admin/">← Back to Admin</a>

        <script>
          function copyToken() {
            navigator.clipboard.writeText('${tokens.refresh_token}');
            document.getElementById('copy-msg').style.display = 'inline';
            setTimeout(() => document.getElementById('copy-msg').style.display = 'none', 2000);
          }
        </script>
      </body>
      </html>
    `,
  };
};
