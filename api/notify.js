// Vercel Serverless Function — Notificaciones push diarias
// Se ejecuta a las 9:00 AM Chile via cron-job.org

const admin = require('firebase-admin');
const webpush = require('web-push');

function initFirebase() {
  if (admin.apps.length) return admin.firestore();
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  return admin.firestore();
}

function todayCL() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}

module.exports = async function handler(req, res) {
  const token = req.headers['x-cron-token'] || req.query.token;
  if (token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    const db = initFirebase();

    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );

    const today = todayCL();
    const snap = await db.collection('tasks').get();
    const overdue = snap.docs
      .map(d => d.data())
      .filter(t => t.status !== 'done' && t.due && t.due < today);

    if (overdue.length === 0) {
      return res.json({ sent: 0, message: 'Sin tareas atrasadas hoy' });
    }

    const subsSnap = await db.collection('push_subscriptions').get();
    const subs = {};
    subsSnap.docs.forEach(d => { subs[d.id] = d.data().subscription; });

    const byOwner = {};
    overdue.forEach(t => {
      if (!byOwner[t.owner]) byOwner[t.owner] = [];
      byOwner[t.owner].push(t);
    });

    let sent = 0;
    for (const [owner, tasks] of Object.entries(byOwner)) {
      const sub = subs[owner];
      if (!sub) continue;

      const payload = JSON.stringify({
        title: `🔔 ${tasks.length} tarea${tasks.length > 1 ? 's' : ''} atrasada${tasks.length > 1 ? 's' : ''}`,
        body: tasks.map(t => `• ${t.title} (${t.client})`).join('\n')
      });

      try {
        await webpush.sendNotification(sub, payload);
        sent++;
      } catch (e) {
        if (e.statusCode === 410) {
          await db.collection('push_subscriptions').doc(owner).delete();
        }
      }
    }

    return res.json({ sent, overdue: overdue.length });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};
