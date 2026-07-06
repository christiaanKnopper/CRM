// Importeert contacten uit een CSV (export van het Contacten-tabblad in Excel).
// Gebruik:  node scripts/import-csv.js pad/naar/contacten.csv
// Verwachte kolomvolgorde (zoals in het Excel-bestand):
// voornaam;tussenvoegsel;achternaam;bedrijf;straat;postcode;plaats;email;telefoon;bron;vervolgdatum;gewenste_actie;notities
// Bedrijven worden automatisch aangemaakt (op naam) en het adres komt bij het bedrijf terecht.
const fs = require('fs');
const path = require('path');

const bestand = process.argv[2];
if (!bestand || !fs.existsSync(bestand)) {
  console.error('Gebruik: node scripts/import-csv.js pad/naar/contacten.csv');
  process.exit(1);
}

const { db, DB_PATH } = require('../db');

const inhoud = fs.readFileSync(bestand, 'utf8').replace(/^\uFEFF/, '');
const scheider = (inhoud.split('\n')[0].match(/;/g) || []).length >=
                 (inhoud.split('\n')[0].match(/,/g) || []).length ? ';' : ',';

// Simpele CSV-parser met ondersteuning voor quotes
function parseCsv(tekst, sep) {
  const rijen = [];
  let rij = [], veld = '', inQuote = false;
  for (let i = 0; i < tekst.length; i++) {
    const ch = tekst[i];
    if (inQuote) {
      if (ch === '"' && tekst[i + 1] === '"') { veld += '"'; i++; }
      else if (ch === '"') inQuote = false;
      else veld += ch;
    } else if (ch === '"') inQuote = true;
    else if (ch === sep) { rij.push(veld); veld = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && tekst[i + 1] === '\n') i++;
      rij.push(veld); veld = '';
      if (rij.some(v => v.trim() !== '')) rijen.push(rij);
      rij = [];
    } else veld += ch;
  }
  if (veld !== '' || rij.length) { rij.push(veld); if (rij.some(v => v.trim() !== '')) rijen.push(rij); }
  return rijen;
}

// dd-mm-jjjj of dd/mm/jjjj -> jjjj-mm-dd (leeg blijft leeg)
function naarIsoDatum(s) {
  s = (s || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  console.warn(`  Datum niet herkend, overgeslagen: "${s}"`);
  return '';
}

const rijen = parseCsv(inhoud, scheider);
const kopregel = /voornaam/i.test(rijen[0].join(''));
const data = kopregel ? rijen.slice(1) : rijen;

const vindBedrijf = db.prepare('SELECT id FROM bedrijven WHERE naam=? COLLATE NOCASE');
const maakBedrijf = db.prepare('INSERT INTO bedrijven (naam,straat,postcode,plaats) VALUES (?,?,?,?)');
const maakActie = db.prepare('INSERT OR IGNORE INTO acties (naam) VALUES (?)');
const insert = db.prepare(`INSERT INTO contacten
  (voornaam,tussenvoegsel,achternaam,bedrijf_id,email,telefoon,bron,vervolgdatum,gewenste_actie,notities)
  VALUES (?,?,?,?,?,?,?,?,?,?)`);

let ok = 0, over = 0, nieuweBedrijven = 0;
for (const r of data) {
  const v = (i) => (r[i] || '').trim();
  if (!v(0) || !v(2)) { over++; continue; } // voornaam + achternaam verplicht
  let bedrijfId = null;
  if (v(3)) {
    const bestaand = vindBedrijf.get(v(3));
    if (bestaand) bedrijfId = bestaand.id;
    else { bedrijfId = maakBedrijf.run(v(3), v(4), v(5), v(6)).lastInsertRowid; nieuweBedrijven++; }
  }
  if (v(11)) maakActie.run(v(11)); // onbekende gewenste actie meteen in de keuzelijst
  insert.run(v(0), v(1), v(2), bedrijfId, v(7), v(8), v(9), naarIsoDatum(v(10)), v(11), v(12));
  ok++;
}
console.log(`Klaar: ${ok} contacten geïmporteerd (${nieuweBedrijven} nieuwe bedrijven), ${over} rijen overgeslagen (geen voor- of achternaam).`);
console.log(`Database: ${DB_PATH}`);
