# Almonte Plumbing — Going Live Checklist

Everything needed to move the site from local/sandbox to production on Netlify.
Work top to bottom; nothing here should be skipped before taking real payments.

---

## 1. Netlify — deploy the site

- [ ] Create the site on Netlify (`netlify init`, or connect the Git repo in the Netlify UI).
- [ ] Confirm the build serves the static files and the functions in `netlify/functions/`.
- [ ] Point the custom domain `almonteplumbing.com` at Netlify and enable HTTPS.

## 2. Supabase — already migrated

- [x] `square_order_id` column added to `invoices` (migration `migrations/001-add-square-order-id.sql`).
- [ ] Confirm production is using the same Supabase project (`xzoasjamakdnmegiwxlq`) that the
      migration was applied to. If you ever switch projects, re-run the migration there.

## 3. Square — switch from sandbox to production

- [ ] In the Square dashboard, get **production** credentials (not sandbox).
- [ ] Update env vars (see section 5): `SQUARE_ENVIRONMENT=production`, production
      `SQUARE_ACCESS_TOKEN`, production `SQUARE_LOCATION_ID`.
- [ ] Create a **new production webhook subscription**:
  - Notification URL: `https://almonteplumbing.com/.netlify/functions/square-webhook`
  - Event: `payment.updated`
  - Copy its **production** Signature Key → `SQUARE_WEBHOOK_SIGNATURE_KEY`
  - Set `SQUARE_WEBHOOK_URL` to that exact notification URL.
- [ ] The sandbox subscription + ngrok tunnel are for testing only — they are not used in prod.

## 4. Email / SMS delivery (optional but recommended before launch)

- [ ] Resend: set `RESEND_API_KEY`, and verify the `almonteplumbing.com` domain in Resend
      (add the SPF/DKIM DNS records it gives you) so `FROM_EMAIL`
      (`invoices@almonteplumbing.com`) sends and doesn't land in spam.
- [ ] Twilio (if sending SMS): set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
      `TWILIO_PHONE_NUMBER`. Leave blank to skip SMS.

## 5. Environment variables — set ALL of these in Netlify

Netlify UI → Site settings → Environment variables. These replace the local `.env.local`
(which is never deployed). Use **production** values.

| Variable | Notes |
|---|---|
| `SUPABASE_URL` | production project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side only — keep secret |
| `SUPABASE_ANON_KEY` | |
| `SQUARE_ENVIRONMENT` | set to `production` |
| `SQUARE_ACCESS_TOKEN` | production token |
| `SQUARE_LOCATION_ID` | production location |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | production webhook signature key |
| `SQUARE_WEBHOOK_URL` | `https://almonteplumbing.com/.netlify/functions/square-webhook` |
| `RESEND_API_KEY` / `FROM_EMAIL` / `FROM_NAME` | invoice email (Resend) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` | SMS (optional) |
| `MIKE_PHONE` | notification number |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` / `GOOGLE_CALENDAR_ID` | calendar sync |
| `ADMIN_PASSWORD` | **change from the default before launch** |
| `SITE_URL` | `https://almonteplumbing.com` |

## 6. Security

- [ ] Change `ADMIN_PASSWORD` from `change-this-before-launch` to a strong password.
- [ ] Confirm `.env.local` is git-ignored and never committed (it holds live secrets).
- [ ] Rotate any key that was ever pasted into chat/sandbox before reusing it in production.

## 7. Production smoke test (do once, live)

- [ ] Send a real invoice to yourself for a small amount.
- [ ] Pay it with a real card.
- [ ] Confirm the invoice auto-flips to **paid** in the admin dashboard (webhook working).
- [ ] Confirm the Paid count and revenue total update on the overview.
- [ ] Refund that test payment in Square.

## Payment status — how it works (reference)

- Customer pays the Square link → Square sends `payment.updated` (status `COMPLETED`) to
  `/.netlify/functions/square-webhook`.
- The function verifies the signature against `SQUARE_WEBHOOK_URL` + body, finds the invoice by
  `square_order_id`, and sets `status = 'paid'` + `paid_at`.
- **Manual fallback:** the admin dashboard's **✓ Mark Paid** button sets the same status by hand
  (use for cash/check payments, or invoices created before order-id capture existed).
