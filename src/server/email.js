/**
 * Volo Index — Email adapter (GIV-708)
 *
 * sendMagicLink(to, url): delivers a magic-link sign-in email via Resend's
 * HTTP API (one fetch call, no SDK dependency).
 *
 * Env:
 *   RESEND_API_KEY  — required for live delivery; absent → no-op (dev/tests)
 *   EMAIL_FROM      — sending address (default: login@voloindex.org)
 *
 * No tracking pixels, no external resources in HTML.
 */

import { config } from './config.js';

const RESEND_URL = 'https://api.resend.com/emails';

/**
 * Send a magic-link sign-in email to the given address.
 *
 * @param {string} to  — recipient email
 * @param {string} url — full GET /auth/verify?token=… URL
 * @returns {Promise<void>}
 */
export async function sendMagicLink(to, url) {
  if (!config.email.resendApiKey) {
    // No key configured — caller logs in non-prod; silent in prod (operator misconfiguration).
    return;
  }

  const ttlMinutes = config.auth.magicLinkTtlMinutes;
  const from = `Volo Index <${config.email.from}>`;

  const textBody = [
    'You requested a sign-in link for Volo Index.',
    '',
    `Sign in to your account (link expires in ${ttlMinutes} minutes):`,
    url,
    '',
    "If you didn't request this sign-in link you can safely ignore this email.",
    'No changes will be made to your account.',
  ].join('\n');

  const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#faf9f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
  <tr><td align="center" style="padding:40px 16px">
    <table width="560" cellpadding="0" cellspacing="0" role="presentation" style="background:#fff;border-radius:12px;padding:32px 28px;box-shadow:0 2px 16px rgba(44,29,19,.09)">
      <tr><td>
        <h1 style="margin:0 0 12px;font-size:20px;color:#2c1d13">Sign in to Volo Index</h1>
        <p style="margin:0 0 24px;font-size:15px;color:#4a3728;line-height:1.5">
          Click the button below to sign in to your account.
          This link expires in ${ttlMinutes} minutes.
        </p>
        <table cellpadding="0" cellspacing="0" role="presentation">
          <tr><td style="border-radius:6px;background:#2c1d13">
            <a href="${url}" style="display:inline-block;padding:12px 28px;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:6px">Sign in to Volo Index</a>
          </td></tr>
        </table>
        <p style="margin:24px 0 0;font-size:13px;color:#7a6252;line-height:1.5">
          If the button doesn't work, copy and paste this link into your browser:<br>
          <span style="color:#2c1d13;word-break:break-all">${url}</span>
        </p>
        <hr style="margin:24px 0;border:none;border-top:1px solid #ede8e0">
        <p style="margin:0;font-size:12px;color:#9e8a79">
          If you didn't request this sign-in link, you can safely ignore this email.
          No changes will be made to your account.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.email.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Sign in to Volo Index',
      text: textBody,
      html: htmlBody,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(
      new Error(`Email delivery failed (${res.status}): ${text}`),
      { statusCode: 502, code: 'EMAIL_SEND_FAILED' },
    );
  }
}
