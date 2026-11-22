// Vercel Serverless Function — WhatsApp automático vía Callmebot
// Se ejecuta diariamente a las 9:00 AM Chile via cron-job.org

const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { credential } = require('firebase-admin');

function initFirebase() {
  if (getApps().length) return getFirestore();
  initializeApp({ credential: credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  return getFirestore();
}

function todayCL() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}

async function sendWhatsApp(phone, apikey, message) {
  const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(message)}&apikey=${apikey}`;
  const res = await fetch(url);
  return res.ok;
}

export default async function handler(req, res) {
  // Protección con token secreto para que nadie pueda llamar la función sin autorización
  const token = req.headers['x-cron-token'] || req.query.token;
  if (token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    const db = initFirebase();
    const today = todayCL();

    // Leer tareas vencidas (no completadas y con fecha pasada)
    const snap = await db.collection('tasks').get();
    const overdue = snap.docs
      .map(d => d.data())
      .filter(t => t.status !== 'done' && t.due && t.due < today);

    if (overdue.length === 0) {
      return res.json({ sent: 0, message: 'Sin tareas atrasadas hoy' });
    }

    // Leer teléfonos y apikeys de Callmebot
    const phonesDoc = await db.doc('config/phones').get();
    const phones = phonesDoc.exists ? phonesDoc.data() : {};
    const apikeysDoc = await db.doc('config/callmebot').get();
    const apikeys = apikeysDoc.exists ? apikeysDoc.data() : {};

    // Agrupar tareas por responsable
    const byOwner = {};
    overdue.forEach(t => {
      if (!byOwner[t.owner]) byOwner[t.owner] = [];
      byOwner[t.owner].push(t);
    });

    let sent = 0;
    for (const [owner, tasks] of Object.entries(byOwner)) {
      const phone = phones[owner];
      const apikey = apikeys[owner];
      if (!phone || !apikey) continue;

      const lista = tasks.map(t => `• ${t.title} (${t.client}, venció ${t.due})`).join('\n');
      const msg = `🔔 *Genera · Equipo*\nHola, tienes ${tasks.length} tarea${tasks.length > 1 ? 's' : ''} atrasada${tasks.length > 1 ? 's' : ''}:\n\n${lista}\n\n👉 equipo.generagrowth.cl`;

      const ok = await sendWhatsApp(phone, apikey, msg);
      if (ok) sent++;
    }

    return res.json({ sent, overdue: overdue.length });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
