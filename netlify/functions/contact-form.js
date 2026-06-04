/**
 * /api/contact-form
 * Handles website contact form submissions.
 * 1. Saves lead to Supabase
 * 2. Texts Mike immediately via Twilio
 * 3. Emails customer confirmation via SendGrid
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── Parse name into first/last ─────────────────────────────────
function parseName(fullName = '') {
  const parts = fullName.trim().split(/\s+/);
  return {
    first_name: parts[0] || '',
    last_name:  parts.slice(1).join(' ') || '',
  };
}

// ── Send SMS to Mike ───────────────────────────────────────────
async function notifyMikeBySMS(lead) {
  if (!process.env.TWILIO_ACCOUNT_SID) {
    console.log('[contact-form] Twilio not configured — skipping SMS');
    return;
  }

  const urgencyEmoji = {
    'Emergency — Need help now': '🚨',
    'Urgent — Within 24 hours':  '⚠️',
    'Soon — Within a few days':  '📋',
    'Flexible — Schedule at your convenience': '📆',
  }[lead.urgency] || '📋';

  const msg = [
    `${urgencyEmoji} NEW LEAD — Almonte Plumbing`,
    `Name: ${lead.first_name} ${lead.last_name}`.trim(),
    `Service: ${lead.service_type || 'Not specified'}`,
    `Urgency: ${lead.urgency || 'Not specified'}`,
    `📞 ${lead.phone}`,
    lead.email ? `✉️ ${lead.email}` : '',
    lead.description ? `"${lead.description.slice(0, 100)}${lead.description.length > 100 ? '…' : ''}"` : '',
    lead.preferred_date ? `Preferred: ${lead.preferred_date}` : '',
  ].filter(Boolean).join('\n');

  const params = new URLSearchParams({
    To:   process.env.TWILIO_PHONE_NUMBER, // Mike's number — update this in env vars
    From: process.env.TWILIO_PHONE_NUMBER,
    Body: msg,
  });

  // Send to Mike's personal number (add MIKE_PHONE to env vars)
  const mikePhone = process.env.MIKE_PHONE || process.env.TWILIO_PHONE_NUMBER;
  params.set('To', mikePhone);

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(
          `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
        ).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    }
  );

  if (!res.ok) {
    const err = await res.json();
    console.error('[contact-form] Twilio error:', err.message);
  }
}

// ── Send confirmation email to customer ────────────────────────
async function confirmToCustomer(lead) {
  if (!lead.email || !process.env.SENDGRID_API_KEY) {
    console.log('[contact-form] Skipping customer email — no email or SendGrid not configured');
    return;
  }

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: lead.email, name: `${lead.first_name} ${lead.last_name}`.trim() }] }],
      from: { email: process.env.FROM_EMAIL || 'invoices@almonteplumbing.com', name: 'Almonte Plumbing' },
      subject: 'We received your service request — Almonte Plumbing',
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;color:#1A2318;">
          <div style="background:#1A4D2E;padding:1.5rem 2rem;border-radius:8px 8px 0 0;">
            <div style="color:#fff;font-size:1.2rem;font-weight:800;">🔧 Almonte Plumbing</div>
            <div style="color:#A8D5B5;font-size:.85rem;margin-top:.2rem;">Charlotte, NC · Licensed · Insured · Bonded</div>
          </div>
          <div style="background:#fff;padding:2rem;border:1px solid #DDD8CC;border-top:none;border-radius:0 0 8px 8px;">
            <p style="font-size:1.05rem;font-weight:600;margin-bottom:.5rem;">Hi ${lead.first_name || 'there'},</p>
            <p style="color:#5A6355;line-height:1.7;margin-bottom:1.5rem;">
              Thanks for reaching out! We've received your request for
              <strong>${lead.service_type || 'plumbing service'}</strong>
              and Mike will be in touch with you shortly.
            </p>

            <div style="background:#F5F1E8;border-radius:8px;padding:1.25rem;margin-bottom:1.5rem;">
              <div style="font-size:.8rem;font-weight:700;color:#B87333;text-transform:uppercase;letter-spacing:.06em;margin-bottom:.75rem;">Your Request</div>
              <div style="font-size:.9rem;line-height:1.8;">
                <div><strong>Service:</strong> ${lead.service_type || '—'}</div>
                <div><strong>Urgency:</strong> ${lead.urgency || '—'}</div>
                ${lead.preferred_date ? `<div><strong>Preferred date:</strong> ${lead.preferred_date}</div>` : ''}
                ${lead.description ? `<div style="margin-top:.5rem;font-style:italic;color:#5A6355;">"${lead.description}"</div>` : ''}
              </div>
            </div>

            <p style="color:#5A6355;font-size:.9rem;line-height:1.7;margin-bottom:1.5rem;">
              For <strong>emergencies or urgent issues</strong>, don't wait — call Mike directly:
            </p>

            <a href="tel:+19804160341"
               style="display:inline-block;background:#B87333;color:#fff;font-size:1.1rem;font-weight:800;
                      padding:.875rem 1.75rem;border-radius:8px;text-decoration:none;letter-spacing:.02em;">
              📞 (980) 416-0341
            </a>

            <p style="color:#9CA3AF;font-size:.78rem;margin-top:2rem;line-height:1.6;">
              Almonte Plumbing · Charlotte, NC · Available 24/7<br />
              Mike@almonteplumbing.com · (980) 416-0341
            </p>
          </div>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[contact-form] SendGrid error:', err);
  }
}

// ── Main handler ───────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let fields;
  try {
    // Handle both JSON and URL-encoded form bodies
    const ct = event.headers['content-type'] || '';
    if (ct.includes('application/json')) {
      fields = JSON.parse(event.body);
    } else {
      fields = Object.fromEntries(new URLSearchParams(event.body));
    }
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { first_name, last_name } = parseName(fields.name || '');

  const lead = {
    first_name,
    last_name,
    phone:          fields.phone        || '',
    email:          fields.email        || '',
    service_type:   fields.service      || '',
    urgency:        fields.urgency      || '',
    description:    fields.description  || '',
    address:        fields.address      || '',
    preferred_date: fields['preferred-date'] || null,
    preferred_time: fields['preferred-time'] || '',
    status:         'new',
  };

  if (!lead.phone) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Phone number is required' }) };
  }

  // 1. Save to Supabase
  const { data: savedLead, error } = await supabase
    .from('leads')
    .insert([lead])
    .select()
    .single();

  if (error) {
    console.error('[contact-form] Supabase error:', error.message);
    // Don't fail the request — still notify Mike
  }

  // 2. Text Mike + email customer (in parallel, non-blocking)
  await Promise.allSettled([
    notifyMikeBySMS(lead),
    confirmToCustomer(lead),
  ]);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, lead_id: savedLead?.id }),
  };
};
