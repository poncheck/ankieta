const express = require('express');
const nodemailer = require('nodemailer');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'candidates.json');

// Ensure data dir exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, '[]');
}

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

// ── Kandydaci ─────────────────────────────────────────────────────
function loadCandidates() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}

function saveCandidate(data) {
  const candidates = loadCandidates();
  const entry = { id: Date.now(), submittedAt: new Date().toISOString(), ...data };
  candidates.unshift(entry);
  fs.writeFileSync(DATA_FILE, JSON.stringify(candidates, null, 2));
  return entry;
}

// ── SMTP ──────────────────────────────────────────────────────────
function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

// ── Email do rekrutera ────────────────────────────────────────────
function buildRecruiterEmail(data) {
  const poziomJezyka = v => ({ '1':'Nie znam','2':'Podstawowy','3':'Komunikatywny','4':'Biegły' }[v] || v);
  const listuj = v => !v ? '—' : Array.isArray(v) ? v.join(', ') : v;

  return `<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8">
<style>
  body{font-family:Arial,sans-serif;color:#1a1a1a;background:#f2ede8;margin:0;padding:24px 16px}
  .card{background:#fff;border-radius:12px;max-width:700px;margin:0 auto;overflow:hidden;border:1px solid #e8e4df}
  .hdr{background:#1a1a1a;padding:28px 32px;display:flex;align-items:center;gap:20px}
  .hdr img{width:60px;height:60px;border-radius:50%}
  .hdr h1{color:#f2ede8;font-size:18px;margin:0;font-weight:600}
  .hdr p{color:rgba(242,237,232,0.5);font-size:12px;margin:4px 0 0}
  .body{padding:28px 32px}
  .sec{margin-bottom:20px;border-top:1px solid #ececec;padding-top:16px}
  .sec:first-child{border-top:none;padding-top:0}
  .sec-title{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#aaa;margin:0 0 10px;font-weight:600}
  .row{display:flex;gap:8px;margin-bottom:8px}
  .lbl{font-size:13px;color:#888;min-width:200px}
  .val{font-size:13px;color:#1a1a1a;font-weight:500}
  .ans{background:#f7f4f0;border-left:3px solid #1a1a1a;padding:10px 14px;border-radius:0 6px 6px 0;margin-bottom:10px;font-size:13px;line-height:1.6}
  .q{font-size:11px;color:#aaa;margin-bottom:4px}
  .badge{display:inline-block;background:#f0f0f0;border-radius:4px;padding:2px 8px;font-size:12px;margin:2px}
  .meta{padding:16px 32px;border-top:1px solid #f0ede9;background:#faf9f7;font-size:12px;color:#aaa}
</style></head><body>
<div class="card">
  <div class="hdr">
    <img src="${logoSrc}" alt="cukru">
    <div><h1>${data.imie_nazwisko}</h1><p>Nowe zgłoszenie &mdash; ${new Date().toLocaleString('pl-PL')}</p></div>
  </div>
  <div class="body">
    <div class="sec">
      <div class="sec-title">Dane kontaktowe</div>
      <div class="row"><span class="lbl">Telefon</span><span class="val">${data.telefon}</span></div>
      <div class="row"><span class="lbl">E-mail</span><span class="val">${data.email}</span></div>
      <div class="row"><span class="lbl">Wiek</span><span class="val">${data.wiek} lat</span></div>
      <div class="row"><span class="lbl">Uczeń / student</span><span class="val">${data.student}</span></div>
      ${data.szkola ? `<div class="row"><span class="lbl">Szkoła / uczelnia</span><span class="val">${data.szkola}</span></div>` : ''}
    </div>
    <div class="sec">
      <div class="sec-title">Motywacja</div>
      <div class="q">O sobie i dlaczego cukru.cafe</div><div class="ans">${data.o_sobie}</div>
      <div class="q">Co lubi w pracy z ludźmi</div><div class="ans">${data.praca_z_ludzmi}</div>
    </div>
    <div class="sec">
      <div class="sec-title">Doświadczenie</div>
      <div class="q">Opis</div><div class="ans">${data.doswiadczenie || '—'}</div>
      <div class="q">Umiejętności</div>
      <div>${listuj(data.umiejetnosci_lista) !== '—' ? listuj(data.umiejetnosci_lista).split(',').map(u=>`<span class="badge">${u.trim()}</span>`).join('') : '—'}</div>
    </div>
    <div class="sec">
      <div class="sec-title">Dostępność</div>
      <div class="row"><span class="lbl">Okres</span><span class="val">${data.okres}</span></div>
      <div class="row"><span class="lbl">Godziny tygodniowo</span><span class="val">${data.godziny}</span></div>
      <div class="row"><span class="lbl">Preferowane godziny</span><span class="val">${listuj(data.preferowane_godziny)}</span></div>
      ${data.ograniczenia ? `<div class="q">Ograniczenia</div><div class="ans">${data.ograniczenia}</div>` : ''}
    </div>
    <div class="sec">
      <div class="sec-title">Dyspozycyjność</div>
      <div>${listuj(data.dyspozycyjnosc) !== '—' ? listuj(data.dyspozycyjnosc).split(',').map(u=>`<span class="badge">${u.trim()}</span>`).join('') : '—'}</div>
    </div>
    <div class="sec">
      <div class="sec-title">Języki obce</div>
      <div class="row"><span class="lbl">Angielski</span><span class="val">${poziomJezyka(data.angielski)}</span></div>
      <div class="row"><span class="lbl">Niemiecki</span><span class="val">${poziomJezyka(data.niemiecki)}</span></div>
      <div class="row"><span class="lbl">Czeski</span><span class="val">${poziomJezyka(data.czeski)}</span></div>
    </div>
    <div class="sec">
      <div class="sec-title">Zadania kreatywne</div>
      <div class="q">Propozycja napoju</div><div class="ans">${data.napoj}</div>
      <div class="q">Klient niezadowolony z kawy</div><div class="ans">${data.sytuacja_kawa}</div>
      <div class="q">Klient czekający na śniadanie</div><div class="ans">${data.sytuacja_sniadanie}</div>
    </div>
    ${data.dodatkowe ? `<div class="sec"><div class="sec-title">Dodatkowe informacje</div><div class="ans">${data.dodatkowe}</div></div>` : ''}
    <div class="sec">
      <div class="row"><span class="lbl">Źródło ogłoszenia</span><span class="val">${data.zrodlo || '—'}</span></div>
    </div>
  </div>
  <div class="meta">Zgłoszenie #${Date.now()} &mdash; cukru.cafe rekrutacja</div>
</div></body></html>`;
}

// ── Email potwierdzający dla kandydata ────────────────────────────
function buildConfirmationEmail(data) {
  const imie = data.imie_nazwisko.split(' ')[0];
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8">
<style>
  body{font-family:Arial,sans-serif;color:#1a1a1a;background:#f2ede8;margin:0;padding:24px 16px}
  .card{background:#fff;border-radius:12px;max-width:560px;margin:0 auto;overflow:hidden;border:1px solid #e8e4df}
  .hdr{background:#1a1a1a;padding:36px 32px;text-align:center}
  .hdr img{width:80px;height:80px;border-radius:50%;display:block;margin:0 auto 16px}
  .hdr h1{color:#f2ede8;font-size:20px;margin:0;font-weight:600;letter-spacing:.04em}
  .hdr p{color:rgba(242,237,232,0.45);font-size:12px;margin:6px 0 0;letter-spacing:.1em;text-transform:uppercase}
  .body{padding:36px 32px}
  .body p{font-size:15px;line-height:1.85;color:#333;margin:0 0 16px}
  .body p:last-child{margin:0}
  .box{background:#f7f4f0;border-left:3px solid #1a1a1a;padding:16px 20px;border-radius:0 8px 8px 0;margin:24px 0;font-size:14px;color:#555;line-height:1.75}
  .sig{margin-top:28px;padding-top:20px;border-top:1px solid #f0ede9}
  .ftr{padding:18px 32px;border-top:1px solid #f0ede9;text-align:center}
  .ftr p{font-size:11px;color:#ccc;margin:0;line-height:1.7}
</style></head><body>
<div class="card">
  <div class="hdr">
    <img src="${logoSrc}" alt="cukru.cafe">
    <h1>cukru.cafe</h1>
    <p>Jelenia Góra</p>
  </div>
  <div class="body">
    <p>Szanowna Pani / Szanowny Panie <strong>${imie}</strong>,</p>
    <p>dziękujemy za poświęcony czas i wypełnienie formularza rekrutacyjnego na stanowisko <strong>barista&nbsp;/&nbsp;obsługa klienta</strong> w cukru.cafe.</p>
    <p>Zgłoszenie zostało przez nas odebrane i zostanie starannie przeanalizowane przez nasz zespół.</p>
    <div class="box">
      Pragniemy poinformować, że skontaktujemy się z wybranymi kandydatami po zakończeniu procesu rekrutacyjnego. Jeśli Pani&nbsp;/&nbsp;Pana profil spełni nasze oczekiwania, odezwiemy się telefonicznie lub mailowo.
    </div>
    <div class="sig">
      <p style="margin:0">Z poważaniem,<br><strong>Zespół cukru.cafe</strong></p>
    </div>
  </div>
  <div class="ftr">
    <p>cukru.cafe &middot; Jelenia Góra<br>Wiadomość wysłana automatycznie &mdash; prosimy na nią nie odpowiadać.</p>
  </div>
</div></body></html>`;
}

// ── Submit formularza ─────────────────────────────────────────────
app.post('/submit', async (req, res) => {
  const data = req.body;
  const required = ['imie_nazwisko','telefon','email','wiek','student',
    'o_sobie','praca_z_ludzmi','okres','godziny',
    'angielski','niemiecki','czeski',
    'napoj','sytuacja_kawa','sytuacja_sniadanie','rodo'];
  const missing = required.filter(f => !data[f] || data[f].toString().trim() === '');
  if (missing.length > 0) return res.status(400).json({ error: 'Wypełnij wszystkie wymagane pola.', missing });

  // Zapis kandydata
  saveCandidate(data);

  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"Formularz rekrutacyjny cukru.cafe" <${process.env.SMTP_USER}>`,
      to: process.env.MAIL_TO,
      subject: `Nowe zgłoszenie: ${data.imie_nazwisko}`,
      html: buildRecruiterEmail(data),
    });
    await transporter.sendMail({
      from: `"cukru.cafe" <${process.env.SMTP_USER}>`,
      to: data.email,
      subject: `Potwierdzenie zgłoszenia – cukru.cafe`,
      html: buildConfirmationEmail(data),
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Błąd SMTP:', err.message);
    // Kandydat zapisany — email mógł nie dojść ale dane są bezpieczne
    res.json({ success: true, warning: 'Zgłoszenie zapisane, błąd wysyłki maila.' });
  }
});

// ── Admin: middleware auth ────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.admin) return next();
  res.status(401).json({ error: 'Brak dostępu' });
}

// ── Admin: login ──────────────────────────────────────────────────
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.admin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Nieprawidłowy login lub hasło' });
  }
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/admin/check', (req, res) => {
  res.json({ loggedIn: !!(req.session && req.session.admin) });
});

// ── Admin: kandydaci API ──────────────────────────────────────────
app.get('/admin/candidates', requireAuth, (req, res) => {
  res.json(loadCandidates());
});

app.delete('/admin/candidates/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const candidates = loadCandidates().filter(c => c.id !== id);
  fs.writeFileSync(DATA_FILE, JSON.stringify(candidates, null, 2));
  res.json({ success: true });
});

// ── Admin: panel HTML ─────────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`cukru.cafe rekrutacja działa na http://localhost:${PORT}`);
  console.log(`Panel admina: http://localhost:${PORT}/admin`);
});
