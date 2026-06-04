/**
 * /api/leads
 * GET   — list leads (filterable by status)
 * PATCH — update lead status, or convert to client + book appointment
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
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  if (!(await isAuthed(event))) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // ── GET: list leads ──────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const { status } = event.queryStringParameters || {};

    let query = supabase
      .from('leads')
      .select('*, client:clients(id, first_name, last_name), appointment:appointments(id, scheduled_date, start_time)')
      .order('created_at', { ascending: false });

    if (status && status !== 'all') query = query.eq('status', status);

    const { data, error } = await query;
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers, body: JSON.stringify(data) };
  }

  // ── PATCH: update status or convert to client/appointment ────
  if (event.httpMethod === 'PATCH') {
    const { id } = event.queryStringParameters || {};
    if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id is required' }) };

    let body;
    try { body = JSON.parse(event.body); }
    catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    // Simple status update
    if (body.status && !body.convert) {
      const { data, error } = await supabase
        .from('leads')
        .update({ status: body.status, notes: body.notes })
        .eq('id', id)
        .select()
        .single();
      if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    // Convert: create client + link to lead
    if (body.convert === 'client') {
      const { client_data } = body;

      // Check if client with this phone already exists
      let client;
      const { data: existing } = await supabase
        .from('clients')
        .select('*')
        .eq('phone', client_data.phone)
        .maybeSingle();

      if (existing) {
        client = existing;
      } else {
        const { data: newClient, error: clientErr } = await supabase
          .from('clients')
          .insert([client_data])
          .select()
          .single();
        if (clientErr) return { statusCode: 500, headers, body: JSON.stringify({ error: clientErr.message }) };
        client = newClient;
      }

      // Update lead with client_id and status
      await supabase
        .from('leads')
        .update({ client_id: client.id, status: body.status || 'booked' })
        .eq('id', id);

      return { statusCode: 200, headers, body: JSON.stringify({ client, existed: !!existing }) };
    }

    // Send follow-up SMS to customer
    if (body.action === 'followup') {
      const { message, phone } = body;
      if (!message || !phone) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'message and phone are required' }) };
      }

      if (!process.env.TWILIO_ACCOUNT_SID) {
        return { statusCode: 503, headers, body: JSON.stringify({ error: 'Twilio not configured — add TWILIO_ACCOUNT_SID to env vars' }) };
      }

      const params = new URLSearchParams({
        To:   phone,
        From: process.env.TWILIO_PHONE_NUMBER,
        Body: message,
      });

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
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
      }

      // Update lead: mark contacted, save note
      const { data } = await supabase
        .from('leads')
        .update({
          status: 'contacted',
          notes:  `Follow-up sent: "${message.slice(0, 120)}${message.length > 120 ? '…' : ''}"`,
        })
        .eq('id', id)
        .select()
        .single();

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, lead: data }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid patch operation' }) };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
