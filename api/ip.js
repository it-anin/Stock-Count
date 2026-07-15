// คืนค่า IP ของผู้เรียก request — ใช้สำหรับ Login Log (ดู index.html: logLoginEvent)
// zero-dependency ตั้งใจ ไม่มี package.json/npm install — Vercel auto-detect เป็น serverless function เอง
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const fwd = req.headers['x-forwarded-for'] || '';
  const ip = String(fwd).split(',')[0].trim() || req.socket?.remoteAddress || '';
  res.status(200).json({ ip });
};
