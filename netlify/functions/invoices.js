/**
 * /api/invoices
 * GET  — list all invoices with client info
 * POST — create invoice, generate Square payment link, send via email/SMS
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Require a valid Supabase session (admin login) ─────────────
const supabaseAuth = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
async function isAuthed(event) {
  const h = event.headers || {};
  const token = (h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  const { data, error } = await supabaseAuth.auth.getUser(token);
  return !error && !!(data && data.user);
}

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ── Format phone to E.164 for Square ─────────────────────────
function toE164(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null; // omit if can't format
}

// ── Tax rates by county ───────────────────────────────────────────────────
const COUNTY_TAX_RATES = {
  union:        0.0675,  // 4.75% state + 2.00% Union County
  mecklenburg:  0.0725,  // 4.75% state + 2.50% Mecklenburg County
  other:        0.0475,  // state only — override manually
};

function getEffectiveTaxRate(county, job_type) {
  // Capital improvements: customer is NOT charged sales tax (contractor pays tax on materials)
  if (job_type === 'capital_improvement') return 0;
  return COUNTY_TAX_RATES[county] ?? COUNTY_TAX_RATES.union;
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function generateSquarePaymentLink(invoice, client, items) {
  // Square sandbox/production payment link generation
  const env = process.env.SQUARE_ENVIRONMENT || 'sandbox';
  const baseUrl = env === 'production'
    ? 'https://connect.squareup.com/v2'
    : 'https://connect.squareupsandbox.com/v2';

  const lineItems = items.map(item => ({
    name: item.service_name,
    quantity: String(item.quantity),
    base_price_money: {
      amount: Math.round(item.unit_price * 100), // Square uses cents
      currency: 'USD',
    },
  }));

  const siteUrl = process.env.SITE_URL || '';
  const isLocalhost = siteUrl.includes('localhost') || siteUrl.includes('127.0.0.1');

  const payload = {
    idempotency_key: invoice.id,
    order: {
      location_id: process.env.SQUARE_LOCATION_ID,
      line_items:  lineItems,
    },
    checkout_options: {
      ...(isLocalhost ? {} : { redirect_url: `${siteUrl}/invoice-paid.html` }),
    },
    pre_populated_data: {
      buyer_email:        client.email         || undefined,
      buyer_phone_number: toE164(client.phone) || undefined,
    },
  };

  console.log('[square] Creating payment link, payload:', JSON.stringify(payload));

  const res  = await fetch(`${baseUrl}/online-checkout/payment-links`, {
    method: 'POST',
    headers: {
      'Authorization':  `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
      'Content-Type':   'application/json',
      'Square-Version': '2024-10-17',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  console.log('[square] Response:', JSON.stringify(data));

  if (!res.ok) throw new Error(data.errors?.[0]?.detail || 'Square payment link failed');
  // Return both the customer-facing URL and the order_id so we can match the
  // payment webhook (payment.updated) back to this invoice later.
  return {
    url:      data.payment_link.url,
    orderId:  data.payment_link.order_id || null,
    linkId:   data.payment_link.id || null,
  };
}

async function sendEmail(to, invoice, client, paymentLink) {
  if (!process.env.RESEND_API_KEY) {
    console.log('[email] RESEND_API_KEY not set — skipping email');
    return;
  }

  const fromName  = process.env.FROM_NAME  || 'Almonte Plumbing';
  const fromEmail = process.env.FROM_EMAIL || 'onboarding@resend.dev';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    `${fromName} <${fromEmail}>`,
      to:      [to],
      subject: `Invoice ${invoice.invoice_number} from Almonte Plumbing — $${invoice.total.toFixed(2)} due`,
      html: `
        <p>Hi ${client.first_name},</p>
        <p>Thank you for choosing Almonte Plumbing. Please find your invoice below.</p>
        <table style="border-collapse:collapse;width:100%;max-width:500px;">
          <tr><td><strong>Invoice #:</strong></td><td>${invoice.invoice_number}</td></tr>
          <tr><td><strong>Subtotal:</strong></td><td>$${invoice.subtotal.toFixed(2)}</td></tr>
          <tr><td><strong>Tax:</strong></td><td>$${invoice.tax_total.toFixed(2)}</td></tr>
          <tr><td><strong>Total Due:</strong></td><td><strong>$${invoice.total.toFixed(2)}</strong></td></tr>
        </table>
        ${invoice.notes ? `<p><em>Notes: ${invoice.notes}</em></p>` : ''}
        <p style="margin-top:24px;">
          <a href="${paymentLink}" style="background:#1A4D2E;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;">
            Pay Invoice — $${invoice.total.toFixed(2)}
          </a>
        </p>
        <p style="margin-top:24px;font-size:12px;color:#666;">
          Almonte Plumbing · Charlotte, NC · (980) 416-0341 · Mike@almonteplumbing.com
        </p>
      `,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${err}`);
  }
}

async function sendSMS(to, invoice, paymentLink) {
  if (!process.env.TWILIO_ACCOUNT_SID) {
    console.log('[sms] Twilio not configured — skipping SMS');
    return;
  }

  const body = `Almonte Plumbing — Invoice ${invoice.invoice_number} for $${invoice.total.toFixed(2)} is ready. Pay here: ${paymentLink}`;
  const params = new URLSearchParams({ To: to, From: process.env.TWILIO_PHONE_NUMBER, Body: body });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    }
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Twilio error: ${err.message}`);
  }
}

// ── Handler ────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (!(await isAuthed(event))) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // ── GET: list invoices ─────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const { status } = event.queryStringParameters || {};

    let query = supabase
      .from('invoices')
      .select(`
        *,
        client:clients(id, first_name, last_name, phone, email),
        items:invoice_items(*, service:services(name, category))
      `)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers, body: JSON.stringify(data) };
  }

  // ── POST: create + send invoice ────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body); }
    catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    const { client_id, items, notes, delivery_method, due_date, county, job_type, tax_override, discount_type, discount_value } = body;

    if (!client_id || !items?.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'client_id and items are required' }) };
    }

    // Fetch client
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();
    if (clientErr) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Client not found' }) };

    // Determine effective tax rate — override wins if set
    const effectiveTaxRate = tax_override ? 0 : getEffectiveTaxRate(county || 'union', job_type || 'repair');

    // Calculate totals — all items share the same county/job-type rate
    const invoiceItems = items.map(item => {
      const qty        = item.quantity || 1;
      const unitPrice  = parseFloat(item.unit_price);
      const lineTotal  = qty * unitPrice;
      const taxAmount  = lineTotal * effectiveTaxRate;
      return {
        service_id:   item.service_id,
        service_name: item.service_name,
        quantity:     qty,
        unit_price:   unitPrice,
        tax_rate:     effectiveTaxRate,
        line_total:   lineTotal,
        tax_amount:   taxAmount,
      };
    });

    const subtotal      = invoiceItems.reduce((s, i) => s + i.line_total, 0);
    const discValue     = parseFloat(discount_value) || 0;
    const discountAmt   = discValue > 0
      ? (discount_type === 'percent' ? subtotal * (discValue / 100) : Math.min(discValue, subtotal))
      : 0;
    const taxableAmount = subtotal - discountAmt;
    const tax_total     = taxableAmount * effectiveTaxRate;
    const total         = taxableAmount + tax_total;

    // Update each item's tax_amount to reflect discount proportionally
    if (discountAmt > 0) {
      const discountRatio = taxableAmount / subtotal;
      invoiceItems.forEach(item => {
        item.tax_amount = item.line_total * discountRatio * effectiveTaxRate;
      });
    }

    // Create invoice record
    const { data: invoice, error: invoiceErr } = await supabase
      .from('invoices')
      .insert([{
        client_id,
        subtotal,
        tax_total,
        total,
        notes,
        delivery_method:    delivery_method || 'email',
        due_date,
        county:             county    || 'union',
        job_type:           job_type  || 'repair',
        effective_tax_rate: effectiveTaxRate,
        discount_type:      discount_type  || 'flat',
        discount_value:     discValue,
        discount_amount:    discountAmt,
        status:             'draft',
      }])
      .select()
      .single();
    if (invoiceErr) return { statusCode: 500, headers, body: JSON.stringify({ error: invoiceErr.message }) };

    // Insert line items
    const itemsWithInvoiceId = invoiceItems.map(i => ({ ...i, invoice_id: invoice.id }));
    const { error: itemsErr } = await supabase.from('invoice_items').insert(itemsWithInvoiceId);
    if (itemsErr) return { statusCode: 500, headers, body: JSON.stringify({ error: itemsErr.message }) };

    // Generate Square payment link (if Square is configured)
    let paymentLink = null;   // customer-facing URL
    let squareOrderId = null; // used to match the payment webhook back to this invoice
    if (process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_LOCATION_ID) {
      try {
        const square = await generateSquarePaymentLink(invoice, client, invoiceItems);
        paymentLink   = square.url;
        squareOrderId = square.orderId;
      } catch (err) {
        console.error('[square]', err.message);
        // Don't fail the whole request — just skip the payment link
      }
    }

    // Send via email / SMS
    const method = delivery_method || 'email';
    const displayLink = paymentLink || `${process.env.SITE_URL}/admin/#invoices`;

    try {
      if ((method === 'email' || method === 'both') && client.email) {
        await sendEmail(client.email, invoice, client, displayLink);
      }
      if ((method === 'sms' || method === 'both') && client.phone) {
        await sendSMS(client.phone, invoice, displayLink);
      }
    } catch (err) {
      console.error('[delivery]', err.message);
    }

    // Update invoice with payment link + order id + sent_at
    const { data: final } = await supabase
      .from('invoices')
      .update({
        square_payment_link: paymentLink,
        square_order_id:     squareOrderId,
        sent_at:             new Date().toISOString(),
        status:              'sent',
      })
      .eq('id', invoice.id)
      .select()
      .single();

    return { statusCode: 201, headers, body: JSON.stringify(final || invoice) };
  }

  // ── PATCH: update invoice status (e.g. manual "Mark Paid") ──
  if (event.httpMethod === 'PATCH') {
    const { id } = event.queryStringParameters || {};
    if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id is required' }) };

    let body;
    try { body = JSON.parse(event.body); }
    catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    const allowed = ['draft', 'sent', 'paid', 'cancelled'];
    if (!body.status || !allowed.includes(body.status)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `status must be one of: ${allowed.join(', ')}` }) };
    }

    const update = { status: body.status };
    // Stamp paid_at when marking paid; clear it if moved back off paid
    if (body.status === 'paid') update.paid_at = new Date().toISOString();
    else update.paid_at = null;

    const { data, error } = await supabase
      .from('invoices')
      .update(update)
      .eq('id', id)
      .select(`
        *,
        client:clients(id, first_name, last_name, phone, email),
        items:invoice_items(*, service:services(name, category))
      `)
      .single();
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers, body: JSON.stringify(data) };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
