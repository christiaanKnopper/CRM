const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH ||
  (fs.existsSync('/data') ? '/data/crm.db' : path.join(__dirname, 'crm.db'));

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS contacten (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voornaam TEXT NOT NULL,
  tussenvoegsel TEXT NOT NULL DEFAULT '',
  achternaam TEXT NOT NULL,
  bedrijf TEXT NOT NULL DEFAULT '',
  straat TEXT NOT NULL DEFAULT '',
  postcode TEXT NOT NULL DEFAULT '',
  plaats TEXT NOT NULL DEFAULT '',
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
`);

module.exports = { db, DB_PATH };
