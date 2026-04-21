const express = require('express');
const nodemailer = require('nodemailer');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'data');

if (!fs.existsSync(DATA)) fs.mkdirSync(DATA);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'cukru-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

// ── Logo base64 ───────────────────────────────────────────────────
const logoBase64 = fs.readFileSync(path.join(__dirname, 'public', 'logo.png')).toString('base64');
const logoSrc = `data:image/png;base64,${logoBase64}`;

// ── Rekrutacje ────────────────────────────────────────────────────
const REC_FILE = path.join(DATA, 'recruitments.json');

function loadRecruitments() {
  try { return JSON.parse(fs.readFileSync(REC_FILE, 'utf8')); }
  catch { return []; }
}
function saveRecruitments(list) {
  fs.writeFileSync(REC_FILE, JSON.stringify(list, null, 2));
}
function getRecruitment(id) {
  return loadRecruitments().find(r => r.id === parseInt(id));
}
function getDefaultRecruitment() {
  const list = loadRecruitments();
  return list.find(r => r.isDefault && r.active) || list.find(r => r.active) || list[0];
}

// ── Kandydaci ─────────────────────────────────────────────────────
function candFile(recruitmentId) {
  return path.join(DATA, `candidates-${recruitmentId}.json`);
}
function loadCandidates(recruitmentId) {
  try { return JSON.parse(fs.readFileSync(candFile(recruitmentId), 'utf8')); }
  catch { return []; }
}
function saveCandidate(recruitmentId, data) {
  const list = loadCandidates(recruitmentId);
  const entry = { id: Date.now(), submittedAt: new Date().toISOString(), recruitmentId, ...data };
  list.unshift(entry);
  fs.writeFileSync(candFile(recruitmentId), JSON.stringify(list, null, 2));
  return entry;
}
function countCandidates(recruitmentId) {
  return loadCandidates(recruitmentId).length;
}

// ── SMTP ──────────────────────────────────────────────────────────
function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  });
}

// ── Email rekruter ────────────────────────────────────────────────
function buildRecruiterEmail(data, rec) {
  const poz = v => ({'1':'Nie znam','2':'Podstawowy','3':'Komunikatywny','4':'Biegły'}[v]||v);
  const lst = v => !v?'—':Array.isArray(v)?v.join(', '):v;
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8">
<style>body{font-family:Arial,sans-serif;color:#1a1a1a;background:#f2ede8;margin:0;padding:24px 16px}
.card{background:#fff;border-radius:12px;max-width:700px;margin:0 auto;overflow:hidden;border:1px solid #e8e4df}
.hdr{background:#1a1a1a;padding:24px 28px;display:flex;align-items:center;gap:16px}
.hdr img{width:52px;height:52px;border-radius:50%}
.hdr h1{color:#f2ede8;font-size:17px;margin:0;font-weight:600}
.hdr p{color:rgba(242,237,232,0.45);font-size:12px;margin:4px 0 0}
.body{padding:24px 28px}
.sec{margin-bottom:18px;border-top:1px solid #ececec;padding-top:14px}
.sec:first-child{border-top:none;padding-top:0}
.st{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#aaa;margin:0 0 8px;font-weight:600}
.row{display:flex;gap:8px;margin-bottom:6px}
.lbl{font-size:13px;color:#888;min-width:190px}
.val{font-size:13px;color:#1a1a1a;font-weight:500}
.ans{background:#f7f4f0;border-left:3px solid #1a1a1a;padding:10px 14px;border-radius:0 6px 6px 0;margin-bottom:8px;font-size:13px;line-height:1.6}
.q{font-size:11px;color:#aaa;margin-bottom:4px}
.b{display:inline-block;background:#f0f0f0;border-radius:4px;padding:2px 8px;font-size:12px;margin:2px}
.meta{padding:14px 28px;border-top:1px solid #f0ede9;background:#faf9f7;font-size:12px;color:#aaa}
</style></head><body><div class="card">
<div class="hdr"><img src="${logoSrc}" alt="cukru"><div>
<h1>${data.imie_nazwisko}</h1>
<p>Rekrutacja: ${rec.name} &mdash; ${new Date().toLocaleString('pl-PL')}</p></div></div>
<div class="body">
<div class="sec"><div class="st">Dane kontaktowe</div>
<div class="row"><span class="lbl">Telefon</span><span class="val">${data.telefon}</span></div>
<div class="row"><span class="lbl">E-mail</span><span class="val">${data.email}</span></div>
<div class="row"><span class="lbl">Wiek</span><span class="val">${data.wiek} lat</span></div>
<div class="row"><span class="lbl">Uczeń / student</span><span class="val">${data.student}</span></div>
${data.szkola?`<div class="row"><span class="lbl">Szkoła</span><span class="val">${data.szkola}</span></div>`:''}
</div>
<div class="sec"><div class="st">Motywacja</div>
<div class="q">O sobie i dlaczego cukru.cafe</div><div class="ans">${data.o_sobie}</div>
<div class="q">Co lubi w pracy z ludźmi</div><div class="ans">${data.praca_z_ludzmi}</div></div>
<div class="sec"><div class="st">Doświadczenie</div>
<div class="ans">${data.doswiadczenie||'—'}</div>
<div>${lst(data.umiejetnosci_lista)!=='—'?lst(data.umiejetnosci_lista).split(',').map(u=>`<span class="b">${u.trim()}</span>`).join(''):'—'}</div></div>
<div class="sec"><div class="st">Dostępność</div>
<div class="row"><span class="lbl">Okres</span><span class="val">${data.okres}</span></div>
<div class="row"><span class="lbl">Godziny tygodniowo</span><span class="val">${data.godziny}</span></div>
<div class="row"><span class="lbl">Preferowane godziny</span><span class="val">${lst(data.preferowane_godziny)}</span></div>
${data.ograniczenia?`<div class="ans">${data.ograniczenia}</div>`:''}</div>
<div class="sec"><div class="st">Dyspozycyjność</div>
<div>${lst(data.dyspozycyjnosc)!=='—'?lst(data.dyspozycyjnosc).split(',').map(u=>`<span class="b">${u.trim()}</span>`).join(''):'—'}</div></div>
<div class="sec"><div class="st">Języki</div>
<div class="row"><span class="lbl">Angielski</span><span class="val">${poz(data.angielski)}</span></div>
<div class="row"><span class="lbl">Niemiecki</span><span class="val">${poz(data.niemiecki)}</span></div>
<div class="row"><span class="lbl">Czeski</span><span class="val">${poz(data.czeski)}</span></div></div>
<div class="sec"><div class="st">Zadania kreatywne</div>
<div class="q">Propozycja napoju</div><div class="ans">${data.napoj}</div>
<div class="q">Klient niezadowolony z kawy</div><div class="ans">${data.sytuacja_kawa}</div>
<div class="q">Klient czekający na śniadanie</div><div class="ans">${data.sytuacja_sniadanie}</div></div>
${data.dodatkowe?`<div class="sec"><div class="st">Dodatkowe</div><div class="ans">${data.dodatkowe}</div></div>`:''}
<div class="sec"><div class="row"><span class="lbl">Źródło</span><span class="val">${data.zrodlo||'—'}</span></div></div>
</div><div class="meta">cukru.cafe &mdash; ${rec.name}</div></div></body></html>`;
}

// ── Email kandydat ────────────────────────────────────────────────
function buildConfirmationEmail(data) {
  const imie = data.imie_nazwisko.split(' ')[0];
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8">
<style>body{font-family:Arial,sans-serif;color:#1a1a1a;background:#f2ede8;margin:0;padding:24px 16px}
.card{background:#fff;border-radius:12px;max-width:560px;margin:0 auto;overflow:hidden;border:1px solid #e8e4df}
.hdr{background:#1a1a1a;padding:36px 32px;text-align:center}
.hdr img{width:80px;height:80px;border-radius:50%;display:block;margin:0 auto 16px}
.hdr h1{color:#f2ede8;font-size:20px;margin:0;font-weight:600}
.hdr p{color:rgba(242,237,232,0.45);font-size:12px;margin:6px 0 0;text-transform:uppercase;letter-spacing:.1em}
.body{padding:36px 32px}
.body p{font-size:15px;line-height:1.85;color:#333;margin:0 0 16px}
.box{background:#f7f4f0;border-left:3px solid #1a1a1a;padding:16px 20px;border-radius:0 8px 8px 0;margin:24px 0;font-size:14px;color:#555;line-height:1.75}
.sig{margin-top:28px;padding-top:20px;border-top:1px solid #f0ede9}
.ftr{padding:18px 32px;border-top:1px solid #f0ede9;text-align:center}
.ftr p{font-size:11px;color:#ccc;margin:0;line-height:1.7}
</style></head><body><div class="card">
<div class="hdr"><img src="${logoSrc}" alt="cukru.cafe"><h1>cukru.cafe</h1><p>Jelenia Góra</p></div>
<div class="body">
<p>Szanowna Pani / Szanowny Panie <strong>${imie}</strong>,</p>
<p>dziękujemy za poświęcony czas i wypełnienie formularza rekrutacyjnego w cukru.cafe.</p>
<p>Zgłoszenie zostało odebrane i zostanie starannie przeanalizowane przez nasz zespół.</p>
<div class="box">Skontaktujemy się z wybranymi kandydatami po zakończeniu procesu rekrutacyjnego. Jeśli Pani&nbsp;/&nbsp;Pana profil spełni nasze oczekiwania, odezwiemy się telefonicznie lub mailowo.</div>
<div class="sig"><p style="margin:0">Z poważaniem,<br><strong>Zespół cukru.cafe</strong></p></div>
</div>
<div class="ftr"><p>cukru.cafe &middot; Jelenia Góra<br>Wiadomość wysłana automatycznie &mdash; prosimy na nią nie odpowiadać.</p></div>
</div></body></html>`;
}

// ── Apps Script generator ─────────────────────────────────────────
function generateAppsScript(rec) {
  const duties = rec.duties.map(d => `    '• ${d}\\n' +`).join('\n');
  return `function createRecruitmentForm() {
  var form = FormApp.create('${rec.name} – cukru.cafe');
  form.setDescription(
    'Rekrutujemy na stanowisko: ${rec.jobTitle}\\n' +
    'Wymiar pracy: ${rec.workType}\\n\\n' +
    '${rec.description.replace(/\n/g,'\\n').replace(/'/g,"\\'")}\\n\\n' +
    'Zakres obowiązków:\\n' +
${duties}
    '\\nWarunki wynagrodzenia (stawki netto):\\n' +
    '• ${rec.rates.trial} zł/h – dzień próbny\\n' +
    '• ${rec.rates.onboarding} zł/h – okres wdrożenia\\n' +
    '• ${rec.rates.after} zł/h – po wdrożeniu\\n\\n' +
    'Skontaktujemy się z wybranymi kandydatami po zakończeniu rekrutacji.'
  );
  form.setCollectEmail(false);

  form.addSectionHeaderItem().setTitle('Dane podstawowe');
  form.addTextItem().setTitle('Imię i nazwisko').setRequired(true);
  form.addTextItem().setTitle('Numer telefonu').setRequired(true);
  form.addTextItem().setTitle('Adres e-mail').setRequired(true);
  form.addTextItem().setTitle('Wiek').setRequired(true);
  form.addMultipleChoiceItem().setTitle('Czy jesteś uczniem lub studentem?').setChoiceValues(['Tak','Nie']).setRequired(true);
  form.addTextItem().setTitle('Jeśli tak – podaj nazwę szkoły / uczelni i kierunek');

  form.addSectionHeaderItem().setTitle('Motywacja i osobowość');
  form.addParagraphTextItem().setTitle('Napisz kilka zdań o sobie i dlaczego zainteresowała Cię nasza oferta').setRequired(true);
  form.addParagraphTextItem().setTitle('Co lubisz najbardziej w pracy z ludźmi? Co Cię w niej nakręca?').setRequired(true);

  form.addSectionHeaderItem().setTitle('Doświadczenie');
  form.addParagraphTextItem().setTitle('Opisz swoje dotychczasowe doświadczenie zawodowe').setRequired(false);
  form.addCheckboxItem().setTitle('Z czym masz już doświadczenie?').setChoiceValues([
    'Obsługa ekspresu ciśnieniowego','Kawy metodami alternatywnymi',
    'Obsługa kasy / terminala','Praca pod presją czasu',
    'Bezpośrednia obsługa klientów','Cold brew / koktajle / matcha',
    'Kelnerowanie','Znajomość piw kraftowych'
  ]);

  form.addSectionHeaderItem().setTitle('Dostępność');
  form.addMultipleChoiceItem().setTitle('Na jaki okres szukasz pracy?').setChoiceValues(['Sezonowo','Minimum rok','Dłużej','Nie wiem jeszcze']).setRequired(true);
  form.addMultipleChoiceItem().setTitle('Ile godzin tygodniowo?').setChoiceValues(['Do 20h','20–30h','Powyżej 30h','Elastycznie']).setRequired(true);
  form.addCheckboxItem().setTitle('Preferowane godziny').setChoiceValues(['Rano (6:00–7:00)','Południe i popołudnie','Elastycznie']).setRequired(true);
  form.addParagraphTextItem().setTitle('Ograniczenia dostępności');

  form.addSectionHeaderItem().setTitle('Umiejętności');
  form.addCheckboxItem().setTitle('Zaznacz, co dotyczy Ciebie').setChoiceValues([
    'Dostępność w weekendy','Dostępność w święta','Umiejętność pracy z tacą',
    'Posiadam książeczkę sanepidu','Gotowość do pracy pod presją'
  ]);

  form.addSectionHeaderItem().setTitle('Języki obce');
  form.addScaleItem().setTitle('Angielski').setBounds(1,4).setLabels('Nie znam','Biegły').setRequired(true);
  form.addScaleItem().setTitle('Niemiecki').setBounds(1,4).setLabels('Nie znam','Biegły').setRequired(true);
  form.addScaleItem().setTitle('Czeski').setBounds(1,4).setLabels('Nie znam','Biegły').setRequired(true);

  form.addSectionHeaderItem().setTitle('Zadania kreatywne');
  form.addParagraphTextItem().setTitle('Zaproponuj jeden sezonowy letni napój').setRequired(true);
  form.addParagraphTextItem().setTitle('Klient wraca z kawą twierdząc, że jest zła. Co robisz?').setRequired(true);
  form.addParagraphTextItem().setTitle('Klient uważa, że za długo czeka na śniadanie. Jak reagujesz?').setRequired(true);

  form.addSectionHeaderItem().setTitle('Na koniec');
  form.addParagraphTextItem().setTitle('Dodatkowe informacje');
  form.addMultipleChoiceItem().setTitle('Skąd dowiedziałeś/aś się o ofercie?').setChoiceValues(['Instagram','Znajomy','Ogłoszenie online','Inne']);
  form.addCheckboxItem().setTitle('Zgoda RODO').setChoiceValues(['Wyrażam zgodę na przetwarzanie moich danych osobowych przez cukru.cafe w celu rekrutacji, zgodnie z RODO.']).setRequired(true);

  var url = form.getPublishedUrl();
  Logger.log('Formularz: ' + url);
  console.log('Link: ' + url);
}`;
}

// ── Public routes ─────────────────────────────────────────────────
app.get('/api/recruitment/default', (req, res) => {
  const rec = getDefaultRecruitment();
  if (!rec) return res.status(404).json({ error: 'Brak aktywnej rekrutacji' });
  res.json(rec);
});

app.get('/api/recruitment/:slug', (req, res) => {
  const rec = loadRecruitments().find(r => r.slug === req.params.slug && r.active);
  if (!rec) return res.status(404).json({ error: 'Nie znaleziono rekrutacji' });
  res.json(rec);
});

app.get('/r/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Submit ────────────────────────────────────────────────────────
app.post('/submit/:recruitmentId', async (req, res) => {
  const rec = getRecruitment(req.params.recruitmentId);
  if (!rec) return res.status(404).json({ error: 'Nie znaleziono rekrutacji' });

  const data = req.body;
  const required = ['imie_nazwisko','telefon','email','wiek','student',
    'o_sobie','praca_z_ludzmi','okres','godziny',
    'angielski','niemiecki','czeski',
    'napoj','sytuacja_kawa','sytuacja_sniadanie','rodo'];
  const missing = required.filter(f => !data[f] || data[f].toString().trim() === '');
  if (missing.length) return res.status(400).json({ error: 'Wypełnij wszystkie wymagane pola.', missing });

  saveCandidate(rec.id, data);

  try {
    const t = createTransporter();
    await t.sendMail({ from: `"cukru.cafe Rekrutacja" <${process.env.SMTP_USER}>`, to: process.env.MAIL_TO, subject: `Nowe zgłoszenie [${rec.name}]: ${data.imie_nazwisko}`, html: buildRecruiterEmail(data, rec) });
    await t.sendMail({ from: `"cukru.cafe" <${process.env.SMTP_USER}>`, to: data.email, subject: 'Potwierdzenie zgłoszenia – cukru.cafe', html: buildConfirmationEmail(data) });
    res.json({ success: true });
  } catch (err) {
    console.error('SMTP error:', err.message);
    res.json({ success: true, warning: 'Zgłoszenie zapisane, błąd wysyłki maila.' });
  }
});

// ── Auth middleware ───────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session?.admin) return next();
  res.status(401).json({ error: 'Brak dostępu' });
}

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.admin = true; res.json({ success: true });
  } else res.status(401).json({ error: 'Nieprawidłowy login lub hasło' });
});
app.post('/admin/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
app.get('/admin/check', (req, res) => res.json({ loggedIn: !!(req.session?.admin) }));

// ── Admin: rekrutacje ─────────────────────────────────────────────
app.get('/admin/recruitments', requireAuth, (req, res) => {
  const list = loadRecruitments().map(r => ({ ...r, candidateCount: countCandidates(r.id) }));
  res.json(list);
});

app.post('/admin/recruitments', requireAuth, (req, res) => {
  const list = loadRecruitments();
  const maxId = list.reduce((m, r) => Math.max(m, r.id), 0);
  const rec = {
    id: maxId + 1,
    slug: req.body.slug || `rekrutacja-${maxId + 1}`,
    name: req.body.name || `Rekrutacja #${maxId + 1}`,
    isDefault: false,
    active: true,
    createdAt: new Date().toISOString(),
    jobTitle: req.body.jobTitle || 'barista / obsługa klienta',
    workType: req.body.workType || 'Pełen etat',
    description: req.body.description || '',
    duties: req.body.duties || [],
    rates: req.body.rates || { trial: 25, onboarding: 27, after: 30 }
  };
  list.push(rec);
  saveRecruitments(list);
  fs.writeFileSync(candFile(rec.id), '[]');
  res.json(rec);
});

app.put('/admin/recruitments/:id', requireAuth, (req, res) => {
  const list = loadRecruitments();
  const idx = list.findIndex(r => r.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Nie znaleziono' });
  list[idx] = { ...list[idx], ...req.body, id: list[idx].id, createdAt: list[idx].createdAt };
  saveRecruitments(list);
  res.json(list[idx]);
});

app.post('/admin/recruitments/:id/default', requireAuth, (req, res) => {
  const list = loadRecruitments();
  list.forEach(r => r.isDefault = r.id === parseInt(req.params.id));
  saveRecruitments(list);
  res.json({ success: true });
});

app.delete('/admin/recruitments/:id', requireAuth, (req, res) => {
  let list = loadRecruitments();
  list = list.filter(r => r.id !== parseInt(req.params.id));
  saveRecruitments(list);
  res.json({ success: true });
});

app.get('/admin/recruitments/:id/script', requireAuth, (req, res) => {
  const rec = getRecruitment(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Nie znaleziono' });
  res.json({ generated: generateAppsScript(rec), custom: rec.customScript || null });
});

app.put('/admin/recruitments/:id/script', requireAuth, (req, res) => {
  const list = loadRecruitments();
  const idx = list.findIndex(r => r.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Nie znaleziono' });
  list[idx].customScript = req.body.script || null;
  saveRecruitments(list);
  res.json({ success: true });
});

// ── Admin: kandydaci ──────────────────────────────────────────────
app.get('/admin/candidates', requireAuth, (req, res) => {
  const { recruitmentId } = req.query;
  if (recruitmentId) return res.json(loadCandidates(recruitmentId));
  const all = loadRecruitments().flatMap(r => loadCandidates(r.id));
  all.sort((a,b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  res.json(all);
});

app.delete('/admin/candidates/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  loadRecruitments().forEach(r => {
    const list = loadCandidates(r.id).filter(c => c.id !== id);
    fs.writeFileSync(candFile(r.id), JSON.stringify(list, null, 2));
  });
  res.json({ success: true });
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.listen(PORT, () => {
  console.log(`cukru.cafe rekrutacja: http://localhost:${PORT}`);
  console.log(`Panel admina:          http://localhost:${PORT}/admin`);
});
