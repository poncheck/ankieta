const express = require('express');
const nodemailer = require('nodemailer');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'data');

// Zaufaj proxy (nginx) – niezbędne gdy SSL terminowany jest przez nginx
app.set('trust proxy', 1);

if (!fs.existsSync(DATA)) fs.mkdirSync(DATA);

// ── SECURITY HEADERS (helmet) ─────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],  // pozwala na onclick="" w HTML
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ── RATE LIMITING ─────────────────────────────────────────────────
// Formularz: max 10 zgłoszeń / 15 min z jednego IP
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Zbyt wiele zgłoszeń. Spróbuj ponownie za kilka minut.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Panel admina: max 20 prób / 15 min (ochrona przed brute-force)
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Zbyt wiele prób. Spróbuj ponownie za kilkanaście minut.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Login: max 5 prób / 15 min
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Zbyt wiele prób logowania. Zablokowane na 15 minut.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── BODY PARSING ──────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true, limit: '512kb' }));
app.use(express.json({ limit: '512kb' }));

// ── STATIC FILES ──────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── SESSION ───────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || (() => { throw new Error('SESSION_SECRET wymagany w .env'); })(),
  resave: false,
  saveUninitialized: false,
  name: 'sid',
  cookie: {
    maxAge: 8 * 60 * 60 * 1000,
    httpOnly: true,
    secure: false,   // nginx obsługuje HTTPS – tutaj niepotrzebne
    sameSite: 'lax'
  }
}));

// ── LOGO BASE64 ───────────────────────────────────────────────────
const logoBase64 = fs.readFileSync(path.join(__dirname, 'public', 'logo.png')).toString('base64');
const logoSrc = `data:image/png;base64,${logoBase64}`;

// ── HTML SANITIZER ────────────────────────────────────────────────
// Escape znaków HTML aby uniknąć XSS w emailach i panelu
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ── WALIDACJA POLA ────────────────────────────────────────────────
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email));
}
function isValidAge(age) {
  const n = parseInt(age); return n >= 15 && n <= 80;
}

// ── REKRUTACJE ────────────────────────────────────────────────────
const REC_FILE = path.join(DATA, 'recruitments.json');

function loadRecruitments() {
  try { return JSON.parse(fs.readFileSync(REC_FILE, 'utf8')); }
  catch { return []; }
}
function saveRecruitments(list) {
  fs.writeFileSync(REC_FILE, JSON.stringify(list, null, 2));
}
function getRecruitment(id) {
  const parsed = parseInt(id);
  if (isNaN(parsed)) return null;
  return loadRecruitments().find(r => r.id === parsed);
}
function getDefaultRecruitment() {
  const list = loadRecruitments();
  return list.find(r => r.isDefault && r.active) || list.find(r => r.active) || list[0];
}

// ── KANDYDACI ─────────────────────────────────────────────────────
function candFile(recruitmentId) {
  // Zabezpieczenie przed path traversal: tylko liczby
  const safe = parseInt(recruitmentId);
  if (isNaN(safe)) throw new Error('Nieprawidłowe ID rekrutacji');
  return path.join(DATA, `candidates-${safe}.json`);
}
function loadCandidates(recruitmentId) {
  try { return JSON.parse(fs.readFileSync(candFile(recruitmentId), 'utf8')); }
  catch { return []; }
}
function saveCandidate(recruitmentId, data) {
  const list = loadCandidates(recruitmentId);
  // Zapisujemy TYLKO znane pola — nie cały req.body
  const entry = {
    id: Date.now(),
    submittedAt: new Date().toISOString(),
    recruitmentId,
    imie_nazwisko: String(data.imie_nazwisko || '').slice(0, 120),
    telefon:       String(data.telefon || '').slice(0, 30),
    email:         String(data.email || '').slice(0, 120),
    wiek:          String(data.wiek || '').slice(0, 3),
    student:       data.student === 'Tak' ? 'Tak' : 'Nie',
    szkola:        String(data.szkola || '').slice(0, 200),
    o_sobie:       String(data.o_sobie || '').slice(0, 3000),
    praca_z_ludzmi:String(data.praca_z_ludzmi || '').slice(0, 3000),
    doswiadczenie: String(data.doswiadczenie || '').slice(0, 3000),
    umiejetnosci_lista: Array.isArray(data.umiejetnosci_lista)
      ? data.umiejetnosci_lista.slice(0, 20).map(v => String(v).slice(0, 100))
      : [],
    okres:         String(data.okres || '').slice(0, 100),
    ograniczenia:  String(data.ograniczenia || '').slice(0, 1000),
    dyspozycyjnosc: Array.isArray(data.dyspozycyjnosc)
      ? data.dyspozycyjnosc.slice(0, 10).map(v => String(v).slice(0, 100))
      : [],
    preferowane_godziny: Array.isArray(data.preferowane_godziny)
      ? data.preferowane_godziny.slice(0, 5).map(v => String(v).slice(0, 50))
      : [],
    angielski:     ['1','2','3','4'].includes(String(data.angielski)) ? data.angielski : '1',
    niemiecki:     ['1','2','3','4'].includes(String(data.niemiecki)) ? data.niemiecki : '1',
    czeski:        ['1','2','3','4'].includes(String(data.czeski))    ? data.czeski    : '1',
    napoj:         String(data.napoj || '').slice(0, 3000),
    sytuacja_kawa: String(data.sytuacja_kawa || '').slice(0, 3000),
    sytuacja_sniadanie: String(data.sytuacja_sniadanie || '').slice(0, 3000),
    dodatkowe:     String(data.dodatkowe || '').slice(0, 2000),
    zrodlo:        String(data.zrodlo || '').slice(0, 50),
  };
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

// ── EMAIL REKRUTER ────────────────────────────────────────────────
function buildRecruiterEmail(data, rec) {
  const poz = v => ({'1':'Nie znam','2':'Podstawowy','3':'Komunikatywny','4':'Biegły'}[v]||esc(v));
  const lst = v => !v ? '—' : Array.isArray(v) ? v.map(esc).join(', ') : esc(v);
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
<h1>${esc(data.imie_nazwisko)}</h1>
<p>Rekrutacja: ${esc(rec.name)} &mdash; ${new Date().toLocaleString('pl-PL')}</p></div></div>
<div class="body">
<div class="sec"><div class="st">Dane kontaktowe</div>
<div class="row"><span class="lbl">Telefon</span><span class="val">${esc(data.telefon)}</span></div>
<div class="row"><span class="lbl">E-mail</span><span class="val">${esc(data.email)}</span></div>
<div class="row"><span class="lbl">Wiek</span><span class="val">${esc(data.wiek)} lat</span></div>
<div class="row"><span class="lbl">Uczeń / student</span><span class="val">${esc(data.student)}</span></div>
${data.szkola ? `<div class="row"><span class="lbl">Szkoła</span><span class="val">${esc(data.szkola)}</span></div>` : ''}
</div>
<div class="sec"><div class="st">Motywacja</div>
<div class="q">O sobie i dlaczego cukru.cafe</div><div class="ans">${esc(data.o_sobie)}</div>
<div class="q">Co lubi w pracy z ludźmi</div><div class="ans">${esc(data.praca_z_ludzmi)}</div></div>
<div class="sec"><div class="st">Doświadczenie</div>
<div class="ans">${esc(data.doswiadczenie)||'—'}</div>
<div>${data.umiejetnosci_lista?.length ? data.umiejetnosci_lista.map(u=>`<span class="b">${esc(u)}</span>`).join('') : '—'}</div></div>
<div class="sec"><div class="st">Dostępność</div>
<div class="row"><span class="lbl">Okres</span><span class="val">${esc(data.okres)}</span></div>
${data.ograniczenia ? `<div class="ans">${esc(data.ograniczenia)}</div>` : ''}
</div>
<div class="sec"><div class="st">Dyspozycyjność</div>
<div>${data.dyspozycyjnosc?.length ? data.dyspozycyjnosc.map(u=>`<span class="b">${esc(u)}</span>`).join('') : '—'}</div></div>
<div class="sec"><div class="st">Języki</div>
<div class="row"><span class="lbl">Angielski</span><span class="val">${poz(data.angielski)}</span></div>
<div class="row"><span class="lbl">Niemiecki</span><span class="val">${poz(data.niemiecki)}</span></div>
<div class="row"><span class="lbl">Czeski</span><span class="val">${poz(data.czeski)}</span></div></div>
<div class="sec"><div class="st">Zadania kreatywne</div>
<div class="q">Propozycja napoju</div><div class="ans">${esc(data.napoj)}</div>
<div class="q">Klient niezadowolony z kawy</div><div class="ans">${esc(data.sytuacja_kawa)}</div>
<div class="q">Klient czekający na śniadanie</div><div class="ans">${esc(data.sytuacja_sniadanie)}</div></div>
${data.dodatkowe ? `<div class="sec"><div class="st">Dodatkowe</div><div class="ans">${esc(data.dodatkowe)}</div></div>` : ''}
<div class="sec"><div class="row"><span class="lbl">Źródło</span><span class="val">${esc(data.zrodlo)||'—'}</span></div></div>
</div><div class="meta">cukru.cafe &mdash; ${esc(rec.name)}</div></div></body></html>`;
}

// ── EMAIL KANDYDAT ────────────────────────────────────────────────
function buildConfirmationEmail(data) {
  const imie = esc(data.imie_nazwisko.split(' ')[0]);
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

// ── APPS SCRIPT GENERATOR ─────────────────────────────────────────
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

// ── PUBLIC ROUTES ─────────────────────────────────────────────────
// Zwracamy tylko pola potrzebne do wyświetlenia formularza (NIE customScript)
function publicRecruitmentView(rec) {
  return {
    id: rec.id, slug: rec.slug, name: rec.name,
    jobTitle: rec.jobTitle, workType: rec.workType,
    description: rec.description, duties: rec.duties, rates: rec.rates,
    questions: rec.questions || null,
  };
}

app.get('/api/recruitment/default', (req, res) => {
  const rec = getDefaultRecruitment();
  if (!rec || !rec.active) return res.status(404).json({ error: 'Brak aktywnej rekrutacji' });
  res.json(publicRecruitmentView(rec));
});

app.get('/api/recruitment/:slug', (req, res) => {
  // Walidacja slug: tylko litery, cyfry, myślniki
  if (!/^[a-z0-9-]+$/i.test(req.params.slug)) return res.status(400).json({ error: 'Nieprawidłowy slug' });
  const rec = loadRecruitments().find(r => r.slug === req.params.slug && r.active);
  if (!rec) return res.status(404).json({ error: 'Nie znaleziono rekrutacji' });
  res.json(publicRecruitmentView(rec));
});

app.get('/r/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── SUBMIT ────────────────────────────────────────────────────────
app.post('/submit/:recruitmentId', submitLimiter, async (req, res) => {
  const rec = getRecruitment(req.params.recruitmentId);
  if (!rec || !rec.active) return res.status(404).json({ error: 'Nie znaleziono rekrutacji' });

  const data = req.body;

  // Walidacja pól wymaganych
  const required = ['imie_nazwisko','telefon','email','wiek','student',
    'o_sobie','praca_z_ludzmi','okres',
    'angielski','niemiecki','czeski',
    'napoj','sytuacja_kawa','sytuacja_sniadanie','rodo'];
  const missing = required.filter(f => !data[f] || data[f].toString().trim() === '');
  if (missing.length) return res.status(400).json({ error: 'Wypełnij wszystkie wymagane pola.', missing });

  // Walidacja formatu
  if (!isValidEmail(data.email)) return res.status(400).json({ error: 'Nieprawidłowy adres e-mail.' });
  if (!isValidAge(data.wiek)) return res.status(400).json({ error: 'Nieprawidłowy wiek.' });

  const entry = saveCandidate(rec.id, data);

  try {
    const t = createTransporter();
    await t.sendMail({
      from: `"cukru.cafe Rekrutacja" <${process.env.SMTP_USER}>`,
      to: process.env.MAIL_TO,
      subject: `Nowe zgłoszenie [${rec.name}]: ${entry.imie_nazwisko}`,
      html: buildRecruiterEmail(entry, rec),
    });
    await t.sendMail({
      from: `"cukru.cafe" <${process.env.SMTP_USER}>`,
      to: entry.email,
      subject: 'Potwierdzenie zgłoszenia – cukru.cafe',
      html: buildConfirmationEmail(entry),
    });
    res.json({ success: true });
  } catch (err) {
    console.error('SMTP error:', err.message);
    // Kandydat zapisany — nie informujemy o szczegółach błędu
    res.json({ success: true });
  }
});

// ── AUTH MIDDLEWARE ───────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session?.admin) return next();
  res.status(401).json({ error: 'Brak dostępu' });
}

app.post('/admin/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Podaj login i hasło' });
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.admin = true;
    res.json({ success: true });
  } else {
    setTimeout(() => res.status(401).json({ error: 'Nieprawidłowy login lub hasło' }), 300);
  }
});

app.post('/admin/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/admin/check', (req, res) => {
  res.json({ loggedIn: !!(req.session?.admin) });
});

// ── ADMIN: REKRUTACJE ─────────────────────────────────────────────
app.get('/admin/recruitments', requireAuth, adminLimiter, (req, res) => {
  const list = loadRecruitments().map(r => ({ ...r, candidateCount: countCandidates(r.id) }));
  res.json(list);
});

app.post('/admin/recruitments', requireAuth, adminLimiter, (req, res) => {
  const list = loadRecruitments();
  const maxId = list.reduce((m, r) => Math.max(m, r.id), 0);
  // Walidacja slug
  const slug = String(req.body.slug || `rekrutacja-${maxId + 1}`).replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const rec = {
    id: maxId + 1,
    slug,
    name: String(req.body.name || `Rekrutacja #${maxId + 1}`).slice(0, 200),
    isDefault: false,
    active: true,
    createdAt: new Date().toISOString(),
    jobTitle: String(req.body.jobTitle || 'barista / obsługa klienta').slice(0, 200),
    workType: String(req.body.workType || 'Pełen etat').slice(0, 100),
    description: String(req.body.description || '').slice(0, 5000),
    duties: Array.isArray(req.body.duties) ? req.body.duties.slice(0, 20).map(d => String(d).slice(0, 200)) : [],
    rates: {
      trial:      parseFloat(req.body.rates?.trial)      || 25,
      onboarding: parseFloat(req.body.rates?.onboarding) || 27,
      after:      parseFloat(req.body.rates?.after)      || 30,
    }
  };
  list.push(rec);
  saveRecruitments(list);
  fs.writeFileSync(candFile(rec.id), '[]');
  res.json(rec);
});

app.put('/admin/recruitments/:id', requireAuth, adminLimiter, (req, res) => {
  const list = loadRecruitments();
  const idx = list.findIndex(r => r.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Nie znaleziono' });
  const slug = String(req.body.slug || list[idx].slug).replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  list[idx] = {
    ...list[idx],
    slug,
    name:        String(req.body.name        || list[idx].name).slice(0, 200),
    jobTitle:    String(req.body.jobTitle    || list[idx].jobTitle).slice(0, 200),
    workType:    String(req.body.workType    || list[idx].workType).slice(0, 100),
    description: String(req.body.description || list[idx].description).slice(0, 5000),
    duties: Array.isArray(req.body.duties) ? req.body.duties.slice(0, 20).map(d => String(d).slice(0, 200)) : list[idx].duties,
    active: typeof req.body.active === 'boolean' ? req.body.active : list[idx].active,
    rates: {
      trial:      parseFloat(req.body.rates?.trial)      || list[idx].rates.trial,
      onboarding: parseFloat(req.body.rates?.onboarding) || list[idx].rates.onboarding,
      after:      parseFloat(req.body.rates?.after)      || list[idx].rates.after,
    }
  };
  saveRecruitments(list);
  res.json(list[idx]);
});

app.post('/admin/recruitments/:id/default', requireAuth, adminLimiter, (req, res) => {
  const list = loadRecruitments();
  if (!list.find(r => r.id === parseInt(req.params.id))) return res.status(404).json({ error: 'Nie znaleziono' });
  list.forEach(r => r.isDefault = r.id === parseInt(req.params.id));
  saveRecruitments(list);
  res.json({ success: true });
});

app.delete('/admin/recruitments/:id', requireAuth, adminLimiter, (req, res) => {
  let list = loadRecruitments();
  const rec = list.find(r => r.id === parseInt(req.params.id));
  if (!rec) return res.status(404).json({ error: 'Nie znaleziono' });
  if (rec.isDefault) return res.status(400).json({ error: 'Nie można usunąć domyślnej rekrutacji' });
  list = list.filter(r => r.id !== parseInt(req.params.id));
  saveRecruitments(list);
  res.json({ success: true });
});


// ── PARSER APPS SCRIPT → PYTANIA ─────────────────────────────────
function parseAppsScript(script) {
  const questions = [];
  const lines = script.split('\n');
  let i = 0;

  // Zbieramy bloki: kolejne linie do średnika / zamknięcia
  const fullScript = script.replace(/\/\/[^\n]*/g, ''); // usuń komentarze

  // Wyciągamy wszystkie wywołania setTitle
  const sectionRe = /addSectionHeaderItem\s*\(\s*\)[^;]*\.setTitle\s*\(\s*(['"`])(.*?)\1\s*\)/gs;
  const textRe     = /addTextItem\s*\(\s*\)([^;]*)/gs;
  const paraRe     = /addParagraphTextItem\s*\(\s*\)([^;]*)/gs;
  const scaleRe    = /addScaleItem\s*\(\s*\)([^;]*)/gs;

  // Helper: wyciągnij wartość setTitle/setHelpText/setRequired z łańcucha metod
  function getChainValue(chain, method) {
    const re = new RegExp(`\.${method}\\s*\\(\\s*(['"\`])(.*?)\\1\\s*\\)`, 's');
    const m = chain.match(re);
    return m ? m[2] : null;
  }
  function getRequired(chain) {
    return /\.setRequired\s*\(\s*true\s*\)/.test(chain);
  }
  function getBounds(chain) {
    const m = chain.match(/\.setBounds\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/);
    return m ? { min: parseInt(m[1]), max: parseInt(m[2]) } : { min: 1, max: 4 };
  }
  function getLabels(chain) {
    const m = chain.match(/\.setLabels\s*\(\s*['"`](.*?)['"`]\s*,\s*['"`](.*?)['"`]\s*\)/);
    return m ? { min: m[1], max: m[2] } : { min: 'Min', max: 'Max' };
  }

  // Parsuj sekcje i pytania w kolejności wystąpienia
  // Zamiast oddzielnych regex-ów, idź przez token-by-token
  const tokenRe = /form\.add(SectionHeader|Text|ParagraphText|Scale|MultipleChoice|Checkbox)Item\s*\(\s*\)/g;
  let match;

  while ((match = tokenRe.exec(fullScript)) !== null) {
    const type = match[1];
    const start = match.index;
    // Wyciągnij blok od tego miejsca do następnego `form.add` lub końca
    const rest = fullScript.slice(start + match[0].length);

    // Znajdź koniec bloku (następne `form.add` lub koniec)
    const nextAdd = rest.search(/form\.add\w+Item/);
    const block = (nextAdd === -1 ? rest : rest.slice(0, nextAdd));
    const chain = match[0] + block;

    // Znajdź zmienną (var x = form.add...)
    const varBefore = fullScript.slice(Math.max(0, start - 60), start);
    const varMatch = varBefore.match(/var\s+(\w+)\s*=\s*$/);
    const varName = varMatch ? varMatch[1] : null;

    const title = getChainValue(chain, 'setTitle') ||
      (varName && getChainValue(fullScript.slice(start), 'setTitle')) || '';
    const helpText = getChainValue(chain, 'setHelpText') ||
      (varName ? getChainValue(fullScript, `${varName}\s*\.\s*setHelpText`) : null) || '';
    const required = getRequired(chain) ||
      (varName ? /\.setRequired\s*\(\s*true\s*\)/.test(fullScript.slice(start, start + 500)) : false);

    if (!title && type !== 'SectionHeader') continue;

    if (type === 'SectionHeader') {
      questions.push({ type: 'section', title });

    } else if (type === 'Text') {
      questions.push({ type: 'text', title, helpText, required });

    } else if (type === 'ParagraphText') {
      questions.push({ type: 'paragraph', title, helpText, required });

    } else if (type === 'Scale') {
      const bounds = getBounds(chain);
      const labels = getLabels(chain);
      questions.push({ type: 'scale', title, helpText, required, bounds, labels });

    } else if (type === 'MultipleChoice' || type === 'Checkbox') {
      // Wyciągnij choices z bloku lub przez nazwę zmiennej
      let choicesBlock = chain;
      if (varName) {
        // Znajdź wszystkie .createChoice wywołania dla tej zmiennej
        const vRe = new RegExp(`${varName}\.createChoice\s*\(\s*(['"\`])(.*?)\\1\s*\)`, 'g');
        const fullBlock = fullScript.slice(start, start + 1500);
        choicesBlock = fullBlock;
      }
      const choiceRe = /createChoice\s*\(\s*(['"`])(.*?)\1\s*\)/g;
      const choices = [];
      let cm;
      const searchIn = varName ? fullScript.slice(start, start + 1500) : chain;
      while ((cm = choiceRe.exec(searchIn)) !== null) {
        choices.push(cm[2]);
      }
      questions.push({
        type: type === 'MultipleChoice' ? 'radio' : 'checkbox',
        title, helpText, required, choices
      });
    }
  }

  return questions;
}

app.get('/admin/recruitments/:id/script', requireAuth, adminLimiter, (req, res) => {
  const rec = getRecruitment(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Nie znaleziono' });
  res.json({ generated: generateAppsScript(rec), custom: rec.customScript || null });
});

app.put('/admin/recruitments/:id/script', requireAuth, adminLimiter, (req, res) => {
  const list = loadRecruitments();
  const idx = list.findIndex(r => r.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Nie znaleziono' });
  // Limit rozmiaru skryptu: 100kb
  const script = req.body.script ? String(req.body.script).slice(0, 100000) : null;
  list[idx].customScript = script;
  saveRecruitments(list);
  res.json({ success: true });
});

app.post('/admin/recruitments/:id/apply-script', requireAuth, adminLimiter, (req, res) => {
  const list = loadRecruitments();
  const idx = list.findIndex(r => r.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Nie znaleziono' });
  const script = req.body.script ? String(req.body.script).slice(0, 100000) : list[idx].customScript;
  if (!script) return res.status(400).json({ error: 'Brak skryptu' });
  try {
    const questions = parseAppsScript(script);
    if (!questions.length) return res.status(400).json({ error: 'Nie udało się sparsować pytań ze skryptu' });
    list[idx].customScript = script;
    list[idx].questions = questions;
    saveRecruitments(list);
    res.json({ success: true, count: questions.length, questions });
  } catch(err) {
    res.status(500).json({ error: 'Błąd parsowania: ' + err.message });
  }
});

// ── ADMIN: KANDYDACI ──────────────────────────────────────────────
app.get('/admin/candidates', requireAuth, adminLimiter, (req, res) => {
  const { recruitmentId } = req.query;
  if (recruitmentId) {
    if (isNaN(parseInt(recruitmentId))) return res.status(400).json({ error: 'Nieprawidłowe ID' });
    return res.json(loadCandidates(recruitmentId));
  }
  const all = loadRecruitments().flatMap(r => loadCandidates(r.id));
  all.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  res.json(all);
});

app.delete('/admin/candidates/:id', requireAuth, adminLimiter, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Nieprawidłowe ID' });
  loadRecruitments().forEach(r => {
    const list = loadCandidates(r.id).filter(c => c.id !== id);
    fs.writeFileSync(candFile(r.id), JSON.stringify(list, null, 2));
  });
  res.json({ success: true });
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ── 404 ───────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Nie znaleziono' }));

app.listen(PORT, () => {
  console.log(`cukru.cafe rekrutacja: http://localhost:${PORT}`);
  console.log(`Panel admina:          http://localhost:${PORT}/admin`);
});
