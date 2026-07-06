// ---- Hulpjes ----
const $ = (sel) => document.querySelector(sel);
const views = {
  login: $('#viewLogin'), lijst: $('#viewLijst'), kaart: $('#viewKaart'),
  bedrijven: $('#viewBedrijven'), bedrijfkaart: $('#viewBedrijfKaart')
};
let huidigId = null;         // contactpersoon in de kaart (null = nieuw)
let huidigBedrijfId = null;  // bedrijf in de bedrijfskaart (null = nieuw)
let kaartHerkomst = 'lijst'; // 'lijst' of 'bedrijf' — waar de contactkaart vandaan geopend is
let alleContacten = [];
let filter = 'alle';
let acties = [];

function toon(view) {
  Object.values(views).forEach(v => v.hidden = true);
  views[view].hidden = false;
  const ingelogd = view !== 'login';
  $('#stats').hidden = !ingelogd;
  $('#uitloggen').hidden = !ingelogd;
  $('#backupKnop').hidden = !ingelogd;
}

async function api(pad, opties = {}) {
  const res = await fetch(pad, {
    headers: { 'Content-Type': 'application/json' },
    ...opties,
    body: opties.body ? JSON.stringify(opties.body) : undefined
  });
  if (res.status === 401) { toon('login'); throw new Error('Niet ingelogd'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.fout || 'Er ging iets mis');
  return data;
}

const fmtDatum = (iso) => iso
  ? new Date(iso + 'T00:00:00').toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: '2-digit' })
  : '';
const fmtTijd = (iso) => new Date(iso).toLocaleString('nl-NL',
  { timeZone: 'Europe/Amsterdam', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function vervolgStatus(c) {
  if (!c.vervolgdatum) return null;
  const vandaag = new Date(); vandaag.setHours(0, 0, 0, 0);
  const d = new Date(c.vervolgdatum + 'T00:00:00');
  if (d < vandaag) return 'verlopen';
  if (d <= new Date(vandaag.getTime() + 7 * 86400000)) return 'week';
  return 'later';
}
const volNaam = (c) => [c.voornaam, c.tussenvoegsel, c.achternaam].filter(Boolean).join(' ');

function maakBadge(c) {
  const st = vervolgStatus(c);
  if (!st) return null;
  const b = document.createElement('span');
  b.className = 'badge ' + st;
  b.textContent = (st === 'verlopen' ? 'Verlopen: ' : '') + fmtDatum(c.vervolgdatum);
  return b;
}

// ---- Login ----
$('#loginKnop').addEventListener('click', doeLogin);
$('#wachtwoord').addEventListener('keydown', (e) => { if (e.key === 'Enter') doeLogin(); });
async function doeLogin() {
  try {
    await api('/api/login', { method: 'POST', body: { wachtwoord: $('#wachtwoord').value } });
    $('#loginFout').hidden = true;
    $('#wachtwoord').value = '';
    naarLijst();
  } catch { $('#loginFout').hidden = false; }
}
$('#uitloggen').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  toon('login');
});

// ---- Tabs ----
$('#tabBedrijven').addEventListener('click', naarBedrijven);
$('#tabContacten').addEventListener('click', naarLijst);

// ---- Contactpersonenlijst ----
async function naarLijst() {
  toon('lijst');
  await Promise.all([laadStats(), laadLijst()]);
  $('#zoek').focus();
}

async function laadStats() {
  const s = await api('/api/stats');
  $('#statTotaal').textContent = s.totaal;
  $('#statVerlopen').textContent = s.verlopen;
  $('#statWeek').textContent = s.dezeWeek;
}

async function laadLijst() {
  alleContacten = await api('/api/contacten?q=' + encodeURIComponent($('#zoek').value.trim()));
  tekenLijst();
}

function tekenLijst() {
  const el = $('#lijst');
  el.innerHTML = '';
  const items = alleContacten.filter(c => {
    const st = vervolgStatus(c);
    if (filter === 'verlopen') return st === 'verlopen';
    if (filter === 'week') return st === 'week';
    return true;
  });
  $('#lijstLeeg').hidden = items.length > 0;
  for (const c of items) {
    const st = vervolgStatus(c);
    const rij = document.createElement('div');
    rij.className = 'rij' + (st === 'verlopen' || st === 'week' ? ' ' + st : '');
    rij.innerHTML = `
      <div><div class="naam"></div><div class="sub"></div></div>
      <div class="kolomverberg sub"></div>
      <div class="kolomverberg sub"></div>
      <div></div>`;
    rij.children[0].children[0].textContent = volNaam(c);
    rij.children[0].children[1].textContent = c.bedrijf || '';
    rij.children[1].textContent = [c.plaats, c.telefoon].filter(Boolean).join(' · ');
    rij.children[2].textContent = c.gewenste_actie || '';
    const badge = maakBadge(c);
    if (badge) rij.children[3].appendChild(badge);
    rij.addEventListener('click', () => openKaart(c.id));
    el.appendChild(rij);
  }
}

let zoekTimer;
$('#zoek').addEventListener('input', () => {
  clearTimeout(zoekTimer);
  zoekTimer = setTimeout(laadLijst, 200);
});
document.querySelectorAll('.stat').forEach(btn =>
  btn.addEventListener('click', () => {
    filter = btn.dataset.filter;
    if (views.lijst.hidden) naarLijst(); else tekenLijst();
  }));

// ---- Bedrijvenlijst ----
async function naarBedrijven() {
  toon('bedrijven');
  await laadBedrijven();
  $('#zoekBedrijf').focus();
}

async function laadBedrijven() {
  const rows = await api('/api/bedrijven?q=' + encodeURIComponent($('#zoekBedrijf').value.trim()));
  const el = $('#bedrijfLijst');
  el.innerHTML = '';
  $('#bedrijfLeeg').hidden = rows.length > 0;
  for (const b of rows) {
    const rij = document.createElement('div');
    rij.className = 'rij';
    rij.innerHTML = `
      <div><div class="naam"></div><div class="sub"></div></div>
      <div class="kolomverberg sub"></div>
      <div class="kolomverberg sub"></div>
      <div class="sub"></div>`;
    rij.children[0].children[0].textContent = b.naam;
    rij.children[0].children[1].textContent = b.plaats || '';
    rij.children[1].textContent = [b.straat, b.postcode].filter(Boolean).join(', ');
    rij.children[3].textContent = b.aantal + (b.aantal === 1 ? ' contactpersoon' : ' contactpersonen');
    rij.addEventListener('click', () => openBedrijfKaart(b.id));
    el.appendChild(rij);
  }
}

let zoekBedrijfTimer;
$('#zoekBedrijf').addEventListener('input', () => {
  clearTimeout(zoekBedrijfTimer);
  zoekBedrijfTimer = setTimeout(laadBedrijven, 200);
});
$('#nieuwBedrijf').addEventListener('click', () => openBedrijfKaart(null));

// ---- Acties (onderhoudbare keuzelijst) ----
async function laadActies() {
  acties = await api('/api/acties');
}

function vulActieSelect(huidigeWaarde) {
  const sel = $('#actieSelect');
  sel.innerHTML = '';
  sel.appendChild(new Option('', ''));
  for (const a of acties) sel.appendChild(new Option(a.naam, a.naam));
  if (huidigeWaarde && !acties.some(a => a.naam === huidigeWaarde)) {
    sel.appendChild(new Option(huidigeWaarde, huidigeWaarde));
  }
  sel.value = huidigeWaarde || '';
}

function tekenActieDialog() {
  const ul = $('#actieLijst');
  ul.innerHTML = '';
  for (const a of acties) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = a.naam;
    const knop = document.createElement('button');
    knop.className = 'wis';
    knop.type = 'button';
    knop.textContent = 'wis';
    knop.addEventListener('click', async () => {
      if (!confirm(`Actie "${a.naam}" verwijderen? Contacten met deze actie behouden hun huidige waarde.`)) return;
      await api('/api/acties/' + a.id, { method: 'DELETE' });
      await laadActies();
      tekenActieDialog();
    });
    li.append(span, knop);
    ul.appendChild(li);
  }
}

$('#actiesBeheren').addEventListener('click', async () => {
  await laadActies();
  tekenActieDialog();
  $('#actiesDialog').showModal();
});
async function voegActieToe() {
  const naam = $('#actieNieuw').value.trim();
  if (!naam) return;
  try {
    await api('/api/acties', { method: 'POST', body: { naam } });
    $('#actieNieuw').value = '';
    await laadActies();
    tekenActieDialog();
  } catch (err) { alert(err.message); }
}
$('#actieToevoegen').addEventListener('click', voegActieToe);
$('#actieNieuw').addEventListener('keydown', (e) => { if (e.key === 'Enter') voegActieToe(); });
$('#actiesSluiten').addEventListener('click', () => $('#actiesDialog').close());

// ---- Backup & herstel ----
$('#backupKnop').addEventListener('click', () => $('#backupDialog').showModal());
$('#backupSluiten').addEventListener('click', () => $('#backupDialog').close());
$('#backupDownload').addEventListener('click', () => { window.location.href = '/api/backup'; });

$('#restoreKnop').addEventListener('click', async () => {
  const bestand = $('#restoreBestand').files[0];
  if (!bestand) { alert('Kies eerst een backupbestand.'); return; }
  if (!confirm('Dit vervangt ALLE huidige gegevens door de inhoud van de backup. Doorgaan?')) return;
  try {
    let data;
    try { data = JSON.parse(await bestand.text()); }
    catch { throw new Error('Dit is geen geldig backupbestand.'); }
    const r = await api('/api/restore', { method: 'POST', body: data });
    alert(`Hersteld: ${r.bedrijven} bedrijven, ${r.contacten} contactpersonen, ` +
      `${r.logregels} contactmomenten en ${r.acties} acties.`);
    $('#restoreBestand').value = '';
    $('#backupDialog').close();
    naarLijst();
  } catch (err) { alert(err.message); }
});

// ---- Contactpersoonkaart ----
$('#nieuwContact').addEventListener('click', () => openKaart(null));
$('#terug').addEventListener('click', () => {
  if (kaartHerkomst === 'bedrijf' && huidigBedrijfId !== null) openBedrijfKaart(huidigBedrijfId);
  else naarLijst();
});

async function laadBedrijfSelect(geselecteerd) {
  const bedrijven = await api('/api/bedrijven');
  const sel = $('#bedrijfSelect');
  sel.innerHTML = '';
  sel.appendChild(new Option('— Geen bedrijf —', ''));
  for (const b of bedrijven) sel.appendChild(new Option(b.naam, b.id));
  sel.value = geselecteerd ? String(geselecteerd) : '';
}

async function openKaart(id, opties = {}) {
  huidigId = id;
  kaartHerkomst = opties.herkomst || 'lijst';
  const form = $('#kaartForm');
  form.reset();
  $('#opslaanMelding').hidden = true;
  toon('kaart');

  if (id === null) {
    $('#kaartTitel').textContent = 'Nieuw contactpersoon';
    $('#verwijderen').hidden = true;
    $('#logPaneel').hidden = true;
    $('#vervolgBadge').hidden = true;
    await Promise.all([laadBedrijfSelect(opties.bedrijfId || null), laadActies()]);
    vulActieSelect('');
    form.voornaam.focus();
    return;
  }
  const { contact, logs } = await api('/api/contacten/' + id);
  $('#kaartTitel').textContent = volNaam(contact) + (contact.bedrijf ? ' — ' + contact.bedrijf : '');
  $('#verwijderen').hidden = false;
  await Promise.all([laadBedrijfSelect(contact.bedrijf_id), laadActies()]);
  for (const [k, v] of Object.entries(contact)) {
    if (form.elements[k] && k !== 'bedrijf_id' && k !== 'gewenste_actie') form.elements[k].value = v ?? '';
  }
  vulActieSelect(contact.gewenste_actie);
  toonVervolgBadge(contact);
  tekenLogs(logs);
  $('#logPaneel').hidden = false;
}

$('#nieuwBedrijfSnel').addEventListener('click', async () => {
  const naam = prompt('Naam van het nieuwe bedrijf:');
  if (!naam || !naam.trim()) return;
  try {
    const b = await api('/api/bedrijven', { method: 'POST', body: { naam: naam.trim() } });
    await laadBedrijfSelect(b.id);
  } catch (err) { alert(err.message); }
});

$('#openBedrijf').addEventListener('click', () => {
  const id = $('#bedrijfSelect').value;
  if (!id) { alert('Kies eerst een bedrijf.'); return; }
  openBedrijfKaart(Number(id));
});

function toonVervolgBadge(c) {
  const badge = $('#vervolgBadge');
  const st = vervolgStatus(c);
  if (!st || st === 'later') { badge.hidden = true; return; }
  badge.className = 'badge ' + st;
  badge.textContent = st === 'verlopen' ? 'Actie verlopen' : 'Actie deze week';
  badge.hidden = false;
}

$('#kaartForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = {};
  for (const el of form.elements) if (el.name) body[el.name] = el.value;
  try {
    let contact;
    if (huidigId === null) {
      contact = await api('/api/contacten', { method: 'POST', body });
      huidigId = contact.id;
      $('#verwijderen').hidden = false;
      $('#logPaneel').hidden = false;
      tekenLogs([]);
    } else {
      contact = await api('/api/contacten/' + huidigId, { method: 'PUT', body });
    }
    $('#kaartTitel').textContent = volNaam(contact) + (contact.bedrijf ? ' — ' + contact.bedrijf : '');
    toonVervolgBadge(contact);
    const m = $('#opslaanMelding');
    m.hidden = false;
    setTimeout(() => { m.hidden = true; }, 2500);
    laadStats();
  } catch (err) { alert(err.message); }
});

$('#verwijderen').addEventListener('click', async () => {
  if (!confirm('Dit contactpersoon en alle bijbehorende contactmomenten verwijderen?')) return;
  await api('/api/contacten/' + huidigId, { method: 'DELETE' });
  if (kaartHerkomst === 'bedrijf' && huidigBedrijfId !== null) openBedrijfKaart(huidigBedrijfId);
  else naarLijst();
});

// ---- Bedrijfskaart ----
$('#terugBedrijf').addEventListener('click', naarBedrijven);
$('#cpNieuw').addEventListener('click', () =>
  openKaart(null, { herkomst: 'bedrijf', bedrijfId: huidigBedrijfId }));

async function openBedrijfKaart(id) {
  huidigBedrijfId = id;
  const form = $('#bedrijfForm');
  form.reset();
  $('#bedrijfMelding').hidden = true;
  toon('bedrijfkaart');

  if (id === null) {
    $('#bedrijfTitel').textContent = 'Nieuw bedrijf';
    $('#bedrijfVerwijderen').hidden = true;
    $('#bedrijfContactenPaneel').hidden = true;
    form.naam.focus();
    return;
  }
  const { bedrijf, contactpersonen } = await api('/api/bedrijven/' + id);
  $('#bedrijfTitel').textContent = bedrijf.naam;
  $('#bedrijfVerwijderen').hidden = false;
  for (const [k, v] of Object.entries(bedrijf)) {
    if (form.elements[k]) form.elements[k].value = v;
  }
  tekenContactpersonen(contactpersonen);
  $('#bedrijfContactenPaneel').hidden = false;
}

function tekenContactpersonen(cps) {
  $('#cpTeller').textContent = '(' + cps.length + ')';
  const el = $('#cpLijst');
  el.innerHTML = '';
  $('#cpLeeg').hidden = cps.length > 0;
  for (const c of cps) {
    const st = vervolgStatus(c);
    const rij = document.createElement('div');
    rij.className = 'rij' + (st === 'verlopen' || st === 'week' ? ' ' + st : '');
    rij.innerHTML = `
      <div><div class="naam"></div><div class="sub"></div></div>
      <div class="kolomverberg sub"></div>
      <div class="kolomverberg sub"></div>
      <div></div>`;
    rij.children[0].children[0].textContent = volNaam(c);
    rij.children[0].children[1].textContent = [c.email, c.telefoon].filter(Boolean).join(' · ');
    rij.children[2].textContent = c.gewenste_actie || '';
    const badge = maakBadge(c);
    if (badge) rij.children[3].appendChild(badge);
    rij.addEventListener('click', () => openKaart(c.id, { herkomst: 'bedrijf' }));
    el.appendChild(rij);
  }
}

$('#bedrijfForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {};
  for (const el of e.target.elements) if (el.name) body[el.name] = el.value;
  try {
    let bedrijf;
    if (huidigBedrijfId === null) {
      bedrijf = await api('/api/bedrijven', { method: 'POST', body });
      huidigBedrijfId = bedrijf.id;
      $('#bedrijfVerwijderen').hidden = false;
      tekenContactpersonen([]);
      $('#bedrijfContactenPaneel').hidden = false;
    } else {
      bedrijf = await api('/api/bedrijven/' + huidigBedrijfId, { method: 'PUT', body });
    }
    $('#bedrijfTitel').textContent = bedrijf.naam;
    const m = $('#bedrijfMelding');
    m.hidden = false;
    setTimeout(() => { m.hidden = true; }, 2500);
  } catch (err) { alert(err.message); }
});

$('#bedrijfVerwijderen').addEventListener('click', async () => {
  if (!confirm('Dit bedrijf verwijderen? De contactpersonen blijven bestaan, maar zonder bedrijf.')) return;
  await api('/api/bedrijven/' + huidigBedrijfId, { method: 'DELETE' });
  naarBedrijven();
});

// ---- Logboek ----
function tekenLogs(logs) {
  $('#logTeller').textContent = '(' + logs.length + ')';
  const ul = $('#logLijst');
  ul.innerHTML = '';
  for (const log of logs) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="tijd"></span><span class="tekst"></span>
      <button class="wis" title="Verwijder deze regel">wis</button>`;
    li.children[0].textContent = fmtTijd(log.tijdstip);
    li.children[1].textContent = log.tekst;
    li.children[2].addEventListener('click', async () => {
      if (!confirm('Deze logregel verwijderen?')) return;
      await api('/api/logboek/' + log.id, { method: 'DELETE' });
      herlaadLogs();
    });
    ul.appendChild(li);
  }
}

async function herlaadLogs() {
  const { logs } = await api('/api/contacten/' + huidigId);
  tekenLogs(logs);
}

$('#logToevoegen').addEventListener('click', async () => {
  const tekst = $('#logTekst').value.trim();
  if (!tekst || huidigId === null) return;
  await api('/api/contacten/' + huidigId + '/logboek', { method: 'POST', body: { tekst } });
  $('#logTekst').value = '';
  herlaadLogs();
  laadStats();
});
$('#logTekst').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#logToevoegen').click();
});

// ---- Start ----
(async () => {
  const me = await fetch('/api/me').then(r => r.json()).catch(() => ({ ingelogd: false }));
  if (me.ingelogd) naarLijst(); else toon('login');
})();
