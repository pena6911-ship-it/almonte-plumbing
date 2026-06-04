/**
 * /api/calendar
 * GET  ?date=YYYY-MM-DD  — list events for that day from Google Calendar
 * POST                   — create a new appointment (Google Calendar + Supabase)
 * DELETE ?id=eventId     — cancel an appointment
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

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';

// ── Get a fresh access token from the stored refresh token ─────
async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get Google access token — check GOOGLE_REFRESH_TOKEN');
  return data.access_token;
}

// ── Google Calendar API helper ────────────────────────────────
async function gcal(method, path, body) {
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Google Calendar API error');
  return data;
}

// ── Handler ───────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  if (!process.env.GOOGLE_REFRESH_TOKEN) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ error: 'Google Calendar not connected. Visit /api/auth/google to connect.' }),
    };
  }

  // ── GET: list events for a day ───────────────────────────────
  if (event.httpMethod === 'GET') {
    const { date, date_from, date_to } = event.queryStringParameters || {};
    const from = date_from || date;
    const to   = date_to   || date;
    if (!from) return { statusCode: 400, headers, body: JSON.stringify({ error: 'date or date_from is required' }) };

    const timeMin = new Date(`${from}T00:00:00`).toISOString();
    const timeMax = new Date(`${to}T23:59:59`).toISOString();

    try {
      const params = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime' });
      const data = await gcal('GET', `/calendars/${encodeURIComponent(CALENDAR_ID)}/events?${params}`);
      return { statusCode: 200, headers, body: JSON.stringify(data.items || []) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── POST: create appointment ─────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body); }
    catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    const { client_id, service_description, date, start_time, duration_minutes, notes } = body;
    if (!date || !start_time || !duration_minutes) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'date, start_time, and duration_minutes are required' }) };
    }

    // Fetch client name for the calendar event title
    let clientName = 'Unknown Client';
    let clientPhone = '';
    if (client_id) {
      const { data: client } = await supabase.from('clients').select('first_name, last_name, phone').eq('id', client_id).single();
      if (client) {
        clientName = `${client.first_name} ${client.last_name}`;
        clientPhone = client.phone;
      }
    }

    // Calculate end time
    const startDt  = new Date(`${date}T${start_time}:00`);
    const endDt    = new Date(startDt.getTime() + duration_minutes * 60000);
    const endTime  = endDt.toTimeString().slice(0, 5);

    // Build Google Calendar event
    const gcalEvent = {
      summary:     `🔧 ${clientName} — ${service_description || 'Plumbing Service'}`,
      description: [
        clientPhone ? `📞 ${clientPhone}` : '',
        notes ? `Notes: ${notes}` : '',
      ].filter(Boolean).join('\n'),
      start: { dateTime: `${date}T${start_time}:00`, timeZone: 'America/New_York' },
      end:   { dateTime: `${date}T${endTime}:00`,   timeZone: 'America/New_York' },
      colorId: '2', // sage green
    };

    try {
      // Create Google Calendar event
      const gcalResult = await gcal('POST', `/calendars/${encodeURIComponent(CALENDAR_ID)}/events`, gcalEvent);

      // Store in Supabase
      const { data: appt, error } = await supabase
        .from('appointments')
        .insert([{
          client_id,
          service_description,
          scheduled_date:   date,
          start_time,
          end_time:         endTime,
          duration_minutes: parseInt(duration_minutes),
          google_event_id:  gcalResult.id,
          notes,
          status: 'scheduled',
        }])
        .select()
        .single();

      if (error) throw new Error(error.message);
      return { statusCode: 201, headers, body: JSON.stringify({ ...appt, google_event: gcalResult }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── DELETE: cancel appointment ───────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const { id, google_event_id } = event.queryStringParameters || {};
    if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id is required' }) };

    try {
      // Delete from Google Calendar
      if (google_event_id) {
        await gcal('DELETE', `/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${google_event_id}`);
      }
      // Update status in Supabase
      await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', id);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
