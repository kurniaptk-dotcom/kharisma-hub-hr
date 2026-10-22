import { setCors, SUPABASE_URL, SUPABASE_KEY } from './_supabase.js';
const serviceKeyConfigured = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

export default function handler(req, res) {
  setCors(res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
  return res.status(200).json({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_KEY,
    authRequired: true,
    configured: Boolean(SUPABASE_KEY),
    backendConfigured: Boolean(SUPABASE_KEY) && serviceKeyConfigured,
    missingConfiguration: [!SUPABASE_KEY && 'SUPABASE_ANON_KEY', !serviceKeyConfigured && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean)
  });
}
