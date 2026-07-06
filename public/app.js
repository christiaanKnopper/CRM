// ---- Hulpjes ----
const $ = (sel) => document.querySelector(sel);
const views = { login: $('#viewLogin'), lijst: $('#viewLijst'), kaart: $('#viewKaart') };
let huidigId = null;      // null = nieuw contact
let alleContacten = [];
let filter = 'alle';

function toon(view) {
  Object.values(views).forEach(v => v.hidden = true);
  views[view].hidden = false;
  const ingelogd = view !== 'login';
  $('#stats').hidden = !ingelogd;
  $('#uitloggen').hidden = !ingelogd;
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
  ? new Date(iso + 'T00:00:00').toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
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

// ---- Lijst ----
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
    if (st) {
      const b = document.createElement('span');
      b.className = 'badge ' + st;
      b.textContent = (st === 'verlopen' ? 'Verlopen: ' : '') + fmtDatum(c.vervolgdatum);
      rij.children[3].appendChild(b);
    }
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
  btn.addEventListener('click', () => { filter = btn.dataset.filter; tekenLijst(); }));

// ---- Relatiekaart ----
$('#nieuwContact').addEventListener('click', () => openKaart(null));
$('#terug').addEventListener('click', naarLijst);

async function openKaart(id) {
  huidigId = id;
  const form = $('#kaartForm');
  form.reset();
  $('#opslaanMelding').hidden = true;
  toon('kaart');

  if (id === null) {
    $('#kaartTitel').textContent = 'Nieuw contact';
    $('#verwijderen').hidden = true;
    $('#logPaneel').hidden = true;
    $('#vervolgBadge').hidden = true;
    form.voornaam.focus();
    return;
  }
  const { contact, logs } = await api('/api/contacten/' + id);
  $('#kaartTitel').textContent = volNaam(contact) + (contact.bedrijf ? ' — ' + contact.bedrijf : '');
  $('#verwijderen').hidden = false;
  for (const [k, v] of Object.entries(contact)) {
    if (form.elements[k]) form.elements[k].value = v;
  }
  toonVervolgBadge(contact);
  tekenLogs(logs);
  $('#logPaneel').hidden = false;
}

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
  if (!confirm('Dit contact en alle bijbehorende contactmomenten verwijderen?')) return;
  await api('/api/contacten/' + huidigId, { method: 'DELETE' });
  naarLijst();
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
