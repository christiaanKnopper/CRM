const express = require('express');
const cookieSession = require('cookie-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const APP_PASSWORD = process.env.APP_PASSWORD || (IS_PROD ? null : 'dialef');
const SESSION_SECRET = process.env.SESSION_SECRET || (IS_PROD ? null : 'dev-secret');

if (IS_PROD && (!APP_PASSWORD || !SESSION_SECRET)) {
  console.error('FOUT: zet de env vars APP_PASSWORD en SESSION_SECRET in Railway.');
  process.exit(1);
}

const { db, DB_PATH } = require('./db');

// --- Middleware ---
app.set('trust proxy', 1); // Railway zit achter een proxy
app.use(express.json());
app.use(cookieSession({
  name: 'dialefcrm',
  secret: SESSION_SECRET,
  httpOnly: true,
  sameSite: 'lax',
  secure: IS_PROD,
  maxAge: 30 * 24 * 60 * 60 * 1000 // 30 dagen
}));
app.use(express.static(path.join(__dirname, 'public')));

function eisLogin(req, res, next) {
  if (req.session && req.session.ingelogd) return next();
  res.status(401).json({ fout: 'Niet ingelogd' });
}

// --- Auth ---
app.post('/api/login', (req, res) => {
  if ((req.body.wachtwoord || '') === APP_PASSWORD) {
    req.session.ingelogd = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ fout: 'Onjuist wachtwoord' });
});
app.post('/api/logout', (req, res) => { req.session = null; res.json({ ok: true }); });
app.get('/api/me', (req, res) => res.json({ ingelogd: !!(req.session && req.session.ingelogd) }));

// --- Contactvelden ---
const VELDEN = ['voornaam', 'tussenvoegsel', 'achternaam', 'bedrijf', 'straat', 'postcode',
  'plaats', 'email', 'telefoon', 'bron', 'vervolgdatum', 'gewenste_actie', 'notities'];

function leesVelden(body) {
  const c = {};
  for (const v of VELDEN) c[v] = String(body[v] ?? '').trim();
  return c;
}

// --- Contacten API ---
app.get('/api/contacten', eisLogin, (req, res) => {
  const q = String(req.query.q || '').trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(`
      SELECT * FROM contacten
      WHERE (voornaam || ' ' || tussenvoegsel || ' ' || achternaam) LIKE ?
         OR bedrijf LIKE ? OR plaats LIKE ? OR email LIKE ?
      ORDER BY vervolgdatum='', vervolgdatum,
        achternaam COLLATE NOCASE, voornaam COLLATE NOCASE`).all(like, like, like, like);
  } else {
    rows = db.prepare(`SELECT * FROM contacten
      ORDER BY vervolgdatum='', vervolgdatum,
        achternaam COLLATE NOCASE, voornaam COLLATE NOCASE`).all();
  }
  res.json(rows);
});

app.post('/api/contacten', eisLogin, (req, res) => {
  const c = leesVelden(req.body);
  if (!c.voornaam || !c.achternaam) {
    return res.status(400).json({ fout: 'Voornaam en achternaam zijn verplicht' });
  }
  const info = db.prepare(`INSERT INTO contacten
    (${VELDEN.join(',')}) VALUES (${VELDEN.map(() => '?').join(',')})`)
    .run(...VELDEN.map(v => c[v]));
  res.status(201).json(db.prepare('SELECT * FROM contacten WHERE id=?').get(info.lastInsertRowid));
});

app.get('/api/contacten/:id', eisLogin, (req, res) => {
  const contact = db.prepare('SELECT * FROM contacten WHERE id=?').get(req.params.id);
  if (!contact) return res.status(404).json({ fout: 'Contact niet gevonden' });
  const logs = db.prepare(
    'SELECT * FROM logboek WHERE contact_id=? ORDER BY tijdstip DESC, id DESC').all(contact.id);
  res.json({ contact, logs });
});

app.put('/api/contacten/:id', eisLogin, (req, res) => {
  const bestaand = db.prepare('SELECT id FROM contacten WHERE id=?').get(req.params.id);
  if (!bestaand) return res.status(404).json({ fout: 'Contact niet gevonden' });
  const c = leesVelden(req.body);
  if (!c.voornaam || !c.achternaam) {
    return res.status(400).json({ fout: 'Voornaam en achternaam zijn verplicht' });
  }
  db.prepare(`UPDATE contacten SET ${VELDEN.map(v => v + '=?').join(',')},
    gewijzigd=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
    .run(...VELDEN.map(v => c[v]), req.params.id);
  res.json(db.prepare('SELECT * FROM contacten WHERE id=?').get(req.params.id));
});

app.delete('/api/contacten/:id', eisLogin, (req, res) => {
  const info = db.prepare('DELETE FROM contacten WHERE id=?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ fout: 'Contact niet gevonden' });
  res.json({ ok: true });
});

// --- Logboek API ---
app.post('/api/contacten/:id/logboek', eisLogin, (req, res) => {
  const contact = db.prepare('SELECT id FROM contacten WHERE id=?').get(req.params.id);
  if (!contact) return res.status(404).json({ fout: 'Contact niet gevonden' });
  const tekst = String(req.body.tekst || '').trim();
  if (!tekst) return res.status(400).json({ fout: 'Logtekst mag niet leeg zijn' });
  const info = db.prepare('INSERT INTO logboek (contact_id, tekst) VALUES (?,?)')
    .run(contact.id, tekst);
  res.status(201).json(db.prepare('SELECT * FROM logboek WHERE id=?').get(info.lastInsertRowid));
});

app.delete('/api/logboek/:id', eisLogin, (req, res) => {
  const info = db.prepare('DELETE FROM logboek WHERE id=?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ fout: 'Logregel niet gevonden' });
  res.json({ ok: true });
});

// --- Statistieken voor de kopbalk ---
app.get('/api/stats', eisLogin, (req, res) => {
  const vandaag = new Date().toISOString().slice(0, 10);
  const week = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  res.json({
    totaal: db.prepare('SELECT COUNT(*) n FROM contacten').get().n,
    verlopen: db.prepare(
      "SELECT COUNT(*) n FROM contacten WHERE vervolgdatum<>'' AND vervolgdatum<?").get(vandaag).n,
    dezeWeek: db.prepare(
      "SELECT COUNT(*) n FROM contacten WHERE vervolgdatum>=? AND vervolgdatum<=?").get(vandaag, week).n,
    logregels: db.prepare('SELECT COUNT(*) n FROM logboek').get().n
  });
});

app.listen(PORT, () => console.log(`Dialef CRM draait op poort ${PORT} — database: ${DB_PATH}`));
