/**
 * /api/square-webhook  (POST only)
 *
 * Receives Square webhook events and marks the matching invoice as paid.
 *
 * Setup (Square Developer Dashboard → your app → Webhooks):
 *   1. Add a subscription pointing to:
 *        https://YOUR-SITE/.netlify/functions/square-webhook
 *      (for local testing, an ngrok URL that tunnels to `netlify dev`)
 *   2. Subscribe to event:  payment.updated  (and optionally payment.created)
 *   3. Copy the Signature Key into env var SQUARE_WEBHOOK_SIGNATURE_KEY
 *   4. Set SQUARE_WEBHOOK_URL to the EXACT subscription URL above
 *      (the signature is computed over this URL — it must match byte-for-byte)
 *
 * Square signs each request with HMAC-SHA256 over (notificationUrl + rawBody),
 * base64-encoded, sent in the `x-square-hmacsha256-signature` header.
 */

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Verify Square's HMAC-SHA256 signature ────────────────────────────────────
function isValidSignature(rawBody, signatureHeader, notificationUrl, signatureKey) {
  if (!signatureKey || !signatureHeader || !notificationUrl) return false;
  const hmac = crypto.createHmac('sha256', signatureKey);
  hmac.update(notificationUrl + rawBody);
  const expected = hmac.digest('base64');
  // constant-time compare
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Resolve the exact URL Square used to compute the signature.
// Prefer the explicit env var; fall back to reconstructing from headers.
function getNotificationUrl(event) {
  if (process.env.SQUARE_WEBHOOK_URL) return process.env.SQUARE_WEBHOOK_URL;
  const h = event.headers || {};
  const proto = h['x-forwarded-proto'] || 'https';
  const host  = h['x-forwarded-host'] || h.host;
  return `${proto}://${host}${event.path || '/.netlify/functions/square-webhook'}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Square signs the exact bytes it sent. Netlify may base64-encode the body —
  // decode back to the original string before verifying.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');
  const sigHeader =
    (event.headers || {})['x-square-hmacsha256-signature'] ||
    (event.headers || {})['X-Square-HmacSha256-Signature'];

  const notificationUrl = getNotificationUrl(event);
  const signatureKey    = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;

  if (!isValidSignature(rawBody, sigHeader, notificationUrl, signatureKey)) {
    console.warn('[square-webhook] Invalid signature. notificationUrl=', notificationUrl);
    return { statusCode: 401, body: 'Invalid signature' };
  }

  let payload;
  try { payload = JSON.parse(rawBody); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const type = payload.type;
  console.log('[square-webhook] Received event:', type);

  // We only act on completed payments.
  if (type === 'payment.created' || type === 'payment.updated') {
    const payment = payload?.data?.object?.payment;
    const orderId = payment?.order_id;
    const status  = payment?.status; // APPROVED | COMPLETED | CANCELED | FAILED

    if (status !== 'COMPLETED') {
      console.log(`[square-webhook] Payment status is ${status}, not COMPLETED — ignoring.`);
      return { statusCode: 200, body: 'Ignored (not completed)' };
    }
    if (!orderId) {
      console.warn('[square-webhook] No order_id on payment — cannot match invoice.');
      return { statusCode: 200, body: 'No order_id' };
    }

    // Find the invoice that owns this Square order.
    const { data: invoice, error: findErr } = await supabase
      .from('invoices')
      .select('id, status')
      .eq('square_order_id', orderId)
      .maybeSingle();

    if (findErr) {
      console.error('[square-webhook] Lookup error:', findErr.message);
      return { statusCode: 200, body: 'Lookup error logged' };
    }
    if (!invoice) {
      console.warn('[square-webhook] No invoice found for order_id', orderId);
      return { statusCode: 200, body: 'No matching invoice' };
    }
    if (invoice.status === 'paid') {
      return { statusCode: 200, body: 'Already paid' };
    }

    const { error: updErr } = await supabase
      .from('invoices')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', invoice.id);

    if (updErr) {
      console.error('[square-webhook] Update error:', updErr.message);
      return { statusCode: 500, body: 'Update failed' };
    }

    console.log(`[square-webhook] Invoice ${invoice.id} marked paid (order ${orderId}).`);
    return { statusCode: 200, body: 'Invoice marked paid' };
  }

  // Acknowledge any other event types so Square doesn't retry.
  return { statusCode: 200, body: 'Event ignored' };
};
