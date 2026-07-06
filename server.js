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
const VELDEN = ['voornaam', 'tussenvoegsel', 'achternaam', 'email', 'telefoon',
  'bron', 'vervolgdatum', 'gewenste_actie', 'notities'];
const BEDRIJF_VELDEN = ['naam', 'straat', 'postcode', 'plaats', 'notities'];

function leesContact(body) {
  const c = {};
  for (const v of VELDEN) c[v] = String(body[v] ?? '').trim();
  c.bedrijf_id = body.bedrijf_id ? Number(body.bedrijf_id) : null;
  if (c.bedrijf_id !== null && (!Number.isInteger(c.bedrijf_id) ||
      !db.prepare('SELECT id FROM bedrijven WHERE id=?').get(c.bedrijf_id))) {
    c.bedrijf_id = null;
  }
  return c;
}

function leesBedrijf(body) {
  const b = {};
  for (const v of BEDRIJF_VELDEN) b[v] = String(body[v] ?? '').trim();
  return b;
}

// --- Contacten API ---
const CONTACT_SELECT = `
  SELECT c.*, b.naam AS bedrijf, b.plaats AS plaats
  FROM contacten c LEFT JOIN bedrijven b ON b.id = c.bedrijf_id`;
const CONTACT_ORDER = `
  ORDER BY c.vervolgdatum='', c.vervolgdatum,
    c.achternaam COLLATE NOCASE, c.voornaam COLLATE NOCASE`;
const haalContact = (id) => db.prepare(`${CONTACT_SELECT} WHERE c.id=?`).get(id);

app.get('/api/contacten', eisLogin, (req, res) => {
  const q = String(req.query.q || '').trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(`${CONTACT_SELECT}
      WHERE (c.voornaam || ' ' || c.tussenvoegsel || ' ' || c.achternaam) LIKE ?
         OR b.naam LIKE ? OR b.plaats LIKE ? OR c.email LIKE ?
      ${CONTACT_ORDER}`).all(like, like, like, like);
  } else {
    rows = db.prepare(`${CONTACT_SELECT} ${CONTACT_ORDER}`).all();
  }
  res.json(rows);
});

app.post('/api/contacten', eisLogin, (req, res) => {
  const c = leesContact(req.body);
  if (!c.voornaam || !c.achternaam) {
    return res.status(400).json({ fout: 'Voornaam en achternaam zijn verplicht' });
  }
  const info = db.prepare(`INSERT INTO contacten
    (${VELDEN.join(',')}, bedrijf_id) VALUES (${VELDEN.map(() => '?').join(',')}, ?)`)
    .run(...VELDEN.map(v => c[v]), c.bedrijf_id);
  res.status(201).json(haalContact(info.lastInsertRowid));
});

app.get('/api/contacten/:id', eisLogin, (req, res) => {
  const contact = haalContact(req.params.id);
  if (!contact) return res.status(404).json({ fout: 'Contact niet gevonden' });
  const logs = db.prepare(
    'SELECT * FROM logboek WHERE contact_id=? ORDER BY tijdstip DESC, id DESC').all(contact.id);
  res.json({ contact, logs });
});

app.put('/api/contacten/:id', eisLogin, (req, res) => {
  const bestaand = db.prepare('SELECT id FROM contacten WHERE id=?').get(req.params.id);
  if (!bestaand) return res.status(404).json({ fout: 'Contact niet gevonden' });
  const c = leesContact(req.body);
  if (!c.voornaam || !c.achternaam) {
    return res.status(400).json({ fout: 'Voornaam en achternaam zijn verplicht' });
  }
  db.prepare(`UPDATE contacten SET ${VELDEN.map(v => v + '=?').join(',')}, bedrijf_id=?,
    gewijzigd=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
    .run(...VELDEN.map(v => c[v]), c.bedrijf_id, req.params.id);
  res.json(haalContact(req.params.id));
});

app.delete('/api/contacten/:id', eisLogin, (req, res) => {
  const info = db.prepare('DELETE FROM contacten WHERE id=?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ fout: 'Contact niet gevonden' });
  res.json({ ok: true });
});

// --- Bedrijven API ---
app.get('/api/bedrijven', eisLogin, (req, res) => {
  const q = String(req.query.q || '').trim();
  const basis = `SELECT b.*,
      (SELECT COUNT(*) FROM contacten c WHERE c.bedrijf_id=b.id) AS aantal
    FROM bedrijven b`;
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(`${basis} WHERE b.naam LIKE ? OR b.plaats LIKE ?
      ORDER BY b.naam COLLATE NOCASE`).all(like, like);
  } else {
    rows = db.prepare(`${basis} ORDER BY b.naam COLLATE NOCASE`).all();
  }
  res.json(rows);
});

app.post('/api/bedrijven', eisLogin, (req, res) => {
  const b = leesBedrijf(req.body);
  if (!b.naam) return res.status(400).json({ fout: 'Bedrijfsnaam is verplicht' });
  const info = db.prepare(`INSERT INTO bedrijven
    (${BEDRIJF_VELDEN.join(',')}) VALUES (${BEDRIJF_VELDEN.map(() => '?').join(',')})`)
    .run(...BEDRIJF_VELDEN.map(v => b[v]));
  res.status(201).json(db.prepare('SELECT * FROM bedrijven WHERE id=?').get(info.lastInsertRowid));
});

app.get('/api/bedrijven/:id', eisLogin, (req, res) => {
  const bedrijf = db.prepare('SELECT * FROM bedrijven WHERE id=?').get(req.params.id);
  if (!bedrijf) return res.status(404).json({ fout: 'Bedrijf niet gevonden' });
  const contactpersonen = db.prepare(`SELECT * FROM contacten WHERE bedrijf_id=?
    ORDER BY vervolgdatum='', vervolgdatum,
      achternaam COLLATE NOCASE, voornaam COLLATE NOCASE`).all(bedrijf.id);
  res.json({ bedrijf, contactpersonen });
});

app.put('/api/bedrijven/:id', eisLogin, (req, res) => {
  const bestaand = db.prepare('SELECT id FROM bedrijven WHERE id=?').get(req.params.id);
  if (!bestaand) return res.status(404).json({ fout: 'Bedrijf niet gevonden' });
  const b = leesBedrijf(req.body);
  if (!b.naam) return res.status(400).json({ fout: 'Bedrijfsnaam is verplicht' });
  db.prepare(`UPDATE bedrijven SET ${BEDRIJF_VELDEN.map(v => v + '=?').join(',')},
    gewijzigd=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
    .run(...BEDRIJF_VELDEN.map(v => b[v]), req.params.id);
  res.json(db.prepare('SELECT * FROM bedrijven WHERE id=?').get(req.params.id));
});

app.delete('/api/bedrijven/:id', eisLogin, (req, res) => {
  const info = db.prepare('DELETE FROM bedrijven WHERE id=?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ fout: 'Bedrijf niet gevonden' });
  res.json({ ok: true }); // contactpersonen blijven bestaan; bedrijf_id wordt NULL via FK
});

// --- Acties API (onderhoudbare lijst gewenste acties) ---
app.get('/api/acties', eisLogin, (req, res) => {
  res.json(db.prepare('SELECT * FROM acties ORDER BY naam COLLATE NOCASE').all());
});

app.post('/api/acties', eisLogin, (req, res) => {
  const naam = String(req.body.naam || '').trim();
  if (!naam) return res.status(400).json({ fout: 'Actienaam mag niet leeg zijn' });
  try {
    const info = db.prepare('INSERT INTO acties (naam) VALUES (?)').run(naam);
    res.status(201).json(db.prepare('SELECT * FROM acties WHERE id=?').get(info.lastInsertRowid));
  } catch {
    res.status(409).json({ fout: 'Deze actie bestaat al' });
  }
});

app.delete('/api/acties/:id', eisLogin, (req, res) => {
  const info = db.prepare('DELETE FROM acties WHERE id=?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ fout: 'Actie niet gevonden' });
  res.json({ ok: true }); // contacten behouden hun huidige waarde (opgeslagen als tekst)
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
