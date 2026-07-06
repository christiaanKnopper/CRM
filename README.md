# Dialef Mini CRM

Webapp voor relatiebeheer: contacten, relatiekaart met vervolgacties en een logboek per relatie.
Stack: Node.js (Express) + SQLite (better-sqlite3), vanilla frontend in Dialef-huisstijl.

## Lokaal draaien

```bash
npm install
APP_PASSWORD=kieseenwachtwoord npm start
# open http://localhost:3000
```

Zonder `APP_PASSWORD` is het wachtwoord lokaal `dialef` (alleen buiten productie).

## Deploy op Railway

1. **Repo pushen** naar GitHub en in Railway een nieuwe service aanmaken vanaf die repo.
2. **Volume koppelen**: Railway → service → *Volumes* → mount path **`/data`**.
   De app detecteert `/data` automatisch en zet de database op `/data/crm.db`
   (zelfde patroon als bij de trainingapp — zonder volume ben je je data kwijt bij elke deploy).
3. **Environment variables** instellen:
   - `APP_PASSWORD` — jouw inlogwachtwoord
   - `SESSION_SECRET` — lange willekeurige string (bijv. output van `openssl rand -hex 32`)
   - `NODE_ENV` = `production`
4. Deploy. `trust proxy` staat al goed voor de Railway-proxy, cookies zijn `secure` in productie.

Node-versie is gepind op 20–22 in `package.json` (`engines`).

## Contacten importeren uit het Excel-CRM

1. Open het Excel-bestand, tabblad **Contacten**.
2. Selecteer alleen de kolommen Voornaam t/m Notities (dus zónder de kolommen
   "Volledige naam" en de verborgen hulpkolommen) en plak ze in een nieuw werkblad.
3. Sla dat op als **CSV** (scheidingsteken `;` of `,` — beide worden herkend).
4. Draai:

```bash
node scripts/import-csv.js pad/naar/contacten.csv
```

Datums in `dd-mm-jjjj` worden automatisch omgezet. Op Railway kun je dit eenmalig
via `railway run` doen, of lokaal draaien met `DB_PATH` naar een gedownloade kopie.

## API (voor als je later wilt koppelen)

| Methode | Pad | Doel |
|---|---|---|
| POST | /api/login | Inloggen (`{wachtwoord}`) |
| GET | /api/contacten?q= | Zoeken/lijst |
| POST | /api/contacten | Contact aanmaken |
| GET | /api/contacten/:id | Kaart + logboek |
| PUT | /api/contacten/:id | Contact bijwerken (incl. vervolgdatum/actie) |
| DELETE | /api/contacten/:id | Contact verwijderen |
| POST | /api/contacten/:id/logboek | Logregel toevoegen (`{tekst}`) |
| DELETE | /api/logboek/:id | Logregel verwijderen |
| GET | /api/stats | Tellers voor de kopbalk |
"# CRM" 
