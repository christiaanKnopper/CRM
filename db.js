const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH ||
  (fs.existsSync('/data') ? '/data/crm.db' : path.join(__dirname, 'crm.db'));

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS bedrijven (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  naam TEXT NOT NULL,
  straat TEXT NOT NULL DEFAULT '',
  postcode TEXT NOT NULL DEFAULT '',
  plaats TEXT NOT NULL DEFAULT '',
  notities TEXT NOT NULL DEFAULT '',
  aangemaakt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  gewijzigd TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS contacten (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voornaam TEXT NOT NULL,
  tussenvoegsel TEXT NOT NULL DEFAULT '',
  achternaam TEXT NOT NULL,
  bedrijf_id INTEGER REFERENCES bedrijven(id) ON DELETE SET NULL,
  email TEXT NOT NULL DEFAULT '',
  telefoon TEXT NOT NULL DEFAULT '',
  bron TEXT NOT NULL DEFAULT '',
  vervolgdatum TEXT NOT NULL DEFAULT '',
  gewenste_actie TEXT NOT NULL DEFAULT '',
  notities TEXT NOT NULL DEFAULT '',
  aangemaakt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  gewijzigd TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS logboek (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacten(id) ON DELETE CASCADE,
  tijdstip TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  tekst TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_contact ON logboek(contact_id, tijdstip DESC);
CREATE TABLE IF NOT EXISTS acties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  naam TEXT NOT NULL UNIQUE COLLATE NOCASE
);
`);

// --- Migratie: oude databases hadden bedrijf + adres als kolommen op contacten ---
const kolommen = db.prepare('PRAGMA table_info(contacten)').all().map(k => k.name);
if (kolommen.includes('bedrijf')) {
  db.transaction(() => {
    db.exec(`INSERT INTO bedrijven (naam, straat, postcode, plaats)
      SELECT bedrijf, MAX(straat), MAX(postcode), MAX(plaats)
      FROM contacten WHERE bedrijf <> '' GROUP BY bedrijf`);
    if (!kolommen.includes('bedrijf_id')) {
      db.exec(`ALTER TABLE contacten
        ADD COLUMN bedrijf_id INTEGER REFERENCES bedrijven(id) ON DELETE SET NULL`);
    }
    db.exec(`UPDATE contacten SET bedrijf_id =
      (SELECT id FROM bedrijven b WHERE b.naam = contacten.bedrijf) WHERE bedrijf <> ''`);
    for (const kolom of ['bedrijf', 'straat', 'postcode', 'plaats']) {
      db.exec(`ALTER TABLE contacten DROP COLUMN ${kolom}`);
    }
  })();
  console.log('Migratie uitgevoerd: bedrijven afgesplitst van contacten.');
}

db.exec('CREATE INDEX IF NOT EXISTS idx_contact_bedrijf ON contacten(bedrijf_id)');

// --- Standaardacties bij een lege acties-tabel ---
if (db.prepare('SELECT COUNT(*) n FROM acties').get().n === 0) {
  const ins = db.prepare('INSERT INTO acties (naam) VALUES (?)');
  for (const naam of ['Bellen', 'Mailen', 'Afspraak plannen', 'Offerte sturen',
    'Demo geven', 'Opvolgen na demo', 'LinkedIn-bericht', 'Geen actie']) ins.run(naam);
}

module.exports = { db, DB_PATH };
