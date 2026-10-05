export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  return res.status(200).json({
    status: 'online',
    app: 'Kharisma Hub HR Management (Cloud)',
    environment: 'vercel-production',
    timestamp: new Date().toISOString(),
    supabase: {
      url: 'https://wirgqezinegebauddmgy.supabase.co',
      projectRef: 'wirgqezinegebauddmgy'
    }
  });
}
