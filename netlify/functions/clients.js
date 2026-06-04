/**
 * /api/clients
 * GET  — list all clients (sorted by last name)
 * POST — create a new client
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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (!(await isAuthed(event))) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // ── GET: list clients ──────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const { search } = event.queryStringParameters || {};

    let query = supabase
      .from('clients')
      .select('*')
      .order('last_name', { ascending: true });

    if (search) {
      query = query.or(
        `first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`
      );
    }

    const { data, error } = await query;
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers, body: JSON.stringify(data) };
  }

  // ── POST: create client ────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body); }
    catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    const { first_name, last_name, phone, email, address, city, state, zip, service_area, notes } = body;

    if (!first_name || !last_name || !phone) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'first_name, last_name, and phone are required' }) };
    }

    const { data, error } = await supabase
      .from('clients')
      .insert([{ first_name, last_name, phone, email, address, city, state: state || 'NC', zip, service_area, notes }])
      .select()
      .single();

    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 201, headers, body: JSON.stringify(data) };
  }

  // ── PUT: update client ─────────────────────────────────────
  if (event.httpMethod === 'PUT') {
    const { id } = event.queryStringParameters || {};
    if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id is required' }) };

    let body;
    try { body = JSON.parse(event.body); }
    catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    const { first_name, last_name, phone, email, address, city, state, zip, service_area, notes } = body;

    const { data, error } = await supabase
      .from('clients')
      .update({ first_name, last_name, phone, email, address, city, state, zip, service_area, notes })
      .eq('id', id)
      .select()
      .single();

    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers, body: JSON.stringify(data) };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
