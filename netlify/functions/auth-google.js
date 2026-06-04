/**
 * /api/auth/google
 * Redirects the admin to Google's OAuth consent screen.
 * After consent, Google redirects to /api/auth/google/callback.
 */

exports.handler = async () => {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  `${process.env.SITE_URL}/api/auth/google/callback`,
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/calendar',
    access_type:   'offline',
    prompt:        'consent', // forces Google to return a refresh token every time
  });

  return {
    statusCode: 302,
    headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` },
    body: '',
  };
};
