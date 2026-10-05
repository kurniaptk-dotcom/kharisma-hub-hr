export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  return res.status(200).json({
    totalEmployees: 12,
    attendanceRate: '92%',
    onLeaveToday: 1,
    activeKpis: 10,
    timestamp: new Date().toISOString()
  });
}
