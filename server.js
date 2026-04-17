const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Konfiguracja mailera ──────────────────────────────────────────
function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

// ── Budowanie treści maila ────────────────────────────────────────
function buildEmailHtml(data) {
  const poziomJezyka = (val) => {
    const m = { '1': 'Nie znam', '2': 'Podstawowy', '3': 'Komunikatywny', '4': 'Biegły' };
    return m[val] || val;
  };

  const listuj = (val) => {
    if (!val) return '—';
    if (Array.isArray(val)) return val.join(', ');
    return val;
  };

  return `
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; color: #222; background: #f5f5f5; margin: 0; padding: 20px; }
    .card { background: #fff; border-radius: 8px; max-width: 700px; margin: 0 auto; padding: 32px; border: 1px solid #e0e0e0; }
    h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
    .subtitle { color: #666; font-size: 14px; margin: 0 0 28px; }
    .section { margin-bottom: 24px; border-top: 1px solid #ececec; padding-top: 16px; }
    .section-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #999; margin: 0 0 12px; }
    .row { display: flex; gap: 8px; margin-bottom: 10px; }
    .label { font-size: 13px; color: #666; min-width: 220px; }
    .value { font-size: 13px; color: #222; font-weight: 500; }
    .answer-block { background: #f9f9f9; border-left: 3px solid #ccc; padding: 10px 14px; border-radius: 0 6px 6px 0; margin-bottom: 12px; font-size: 13px; line-height: 1.6; }
    .answer-q { font-size: 12px; color: #888; margin-bottom: 4px; }
    .badge { display: inline-block; background: #f0f0f0; border-radius: 4px; padding: 2px 8px; font-size: 12px; margin: 2px; }
  </style>
</head>
<body>
<div class="card">
  <h1>${data.imie_nazwisko}</h1>
  <p class="subtitle">Nowe zgłoszenie rekrutacyjne &mdash; cukru.cafe &mdash; ${new Date().toLocaleString('pl-PL')}</p>

  <div class="section">
    <div class="section-title">Dane kontaktowe</div>
    <div class="row"><span class="label">Telefon</span><span class="value">${data.telefon}</span></div>
    <div class="row"><span class="label">E-mail</span><span class="value">${data.email}</span></div>
    <div class="row"><span class="label">Wiek</span><span class="value">${data.wiek} lat</span></div>
    <div class="row"><span class="label">Uczeń / student</span><span class="value">${data.student}</span></div>
    ${data.szkola ? `<div class="row"><span class="label">Szkoła / uczelnia</span><span class="value">${data.szkola}</span></div>` : ''}
  </div>

  <div class="section">
    <div class="section-title">Motywacja</div>
    <div class="answer-q">O sobie i dlaczego cukru.cafe</div>
    <div class="answer-block">${data.o_sobie}</div>
    <div class="answer-q">Co lubi w pracy z ludźmi</div>
    <div class="answer-block">${data.praca_z_ludzmi}</div>
  </div>

  <div class="section">
    <div class="section-title">Doświadczenie</div>
    <div class="answer-q">Opis doświadczenia</div>
    <div class="answer-block">${data.doswiadczenie || '—'}</div>
    <div class="answer-q">Zaznaczone umiejętności</div>
    <div>${listuj(data.umiejetnosci_lista) !== '—'
      ? listuj(data.umiejetnosci_lista).split(',').map(u => `<span class="badge">${u.trim()}</span>`).join('')
      : '—'}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Dostępność</div>
    <div class="row"><span class="label">Okres pracy</span><span class="value">${data.okres}</span></div>
    <div class="row"><span class="label">Godziny tygodniowo</span><span class="value">${data.godziny}</span></div>
    <div class="row"><span class="label">Preferowane godziny</span><span class="value">${listuj(data.preferowane_godziny)}</span></div>
    ${data.ograniczenia ? `<div class="answer-q">Ograniczenia</div><div class="answer-block">${data.ograniczenia}</div>` : ''}
  </div>

  <div class="section">
    <div class="section-title">Umiejętności i dyspozycyjność</div>
    <div>${listuj(data.dyspozycyjnosc) !== '—'
      ? listuj(data.dyspozycyjnosc).split(',').map(u => `<span class="badge">${u.trim()}</span>`).join('')
      : '—'}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Języki obce</div>
    <div class="row"><span class="label">Angielski</span><span class="value">${poziomJezyka(data.angielski)}</span></div>
    <div class="row"><span class="label">Niemiecki</span><span class="value">${poziomJezyka(data.niemiecki)}</span></div>
    <div class="row"><span class="label">Czeski</span><span class="value">${poziomJezyka(data.czeski)}</span></div>
  </div>

  <div class="section">
    <div class="section-title">Zadania kreatywne</div>
    <div class="answer-q">Propozycja napoju sezonowego</div>
    <div class="answer-block">${data.napoj}</div>
    <div class="answer-q">Klient niezadowolony z kawy</div>
    <div class="answer-block">${data.sytuacja_kawa}</div>
    <div class="answer-q">Klient czekający na śniadanie</div>
    <div class="answer-block">${data.sytuacja_sniadanie}</div>
  </div>

  ${data.dodatkowe ? `
  <div class="section">
    <div class="section-title">Dodatkowe informacje</div>
    <div class="answer-block">${data.dodatkowe}</div>
  </div>` : ''}

  <div class="section">
    <div class="section-title">Meta</div>
    <div class="row"><span class="label">Źródło ogłoszenia</span><span class="value">${data.zrodlo || '—'}</span></div>
  </div>
</div>
</body>
</html>
  `;
}


// ── Email potwierdzający dla kandydata ───────────────────────────
function buildConfirmationHtml(data) {
  const imie = data.imie_nazwisko.split(' ')[0];
  return `
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; color: #1a1a1a; background: #f2ede8; margin: 0; padding: 32px 16px; }
    .card { background: #fff; border-radius: 12px; max-width: 580px; margin: 0 auto; overflow: hidden; border: 1px solid #e8e4df; }
    .header { background: #1a1a1a; padding: 36px 32px; text-align: center; }
    .header h1 { color: #f2ede8; font-size: 22px; margin: 0 0 4px; font-weight: 600; letter-spacing: 0.05em; }
    .header p { color: rgba(242,237,232,0.5); font-size: 13px; margin: 0; letter-spacing: 0.1em; text-transform: uppercase; }
    .body { padding: 36px 32px; }
    .body p { font-size: 15px; line-height: 1.8; color: #333; margin: 0 0 16px; }
    .body p:last-child { margin: 0; }
    .highlight { background: #f7f4f0; border-left: 3px solid #1a1a1a; padding: 14px 18px; border-radius: 0 8px 8px 0; margin: 24px 0; font-size: 14px; color: #555; line-height: 1.7; }
    .footer { padding: 20px 32px; border-top: 1px solid #f0ede9; text-align: center; }
    .footer p { font-size: 12px; color: #bbb; margin: 0; line-height: 1.6; }
  </style>
</head>
<body>
<div class="card">
  <div class="header">
    <h1>cukru.cafe</h1>
    <p>Jelenia Góra</p>
  </div>
  <div class="body">
    <p>Szanowna Pani / Szanowny Panie <strong>${imie}</strong>,</p>
    <p>dziękujemy za poświęcony czas i wypełnienie formularza rekrutacyjnego na stanowisko <strong>barista&nbsp;/&nbsp;obsługa klienta</strong> w cukru.cafe.</p>
    <p>Zgłoszenie zostało przez nas odebrane i jest aktualnie rozpatrywane przez nasz zespół.</p>
    <div class="highlight">
      Pragniemy uprzejmie poinformować, że skontaktujemy się wyłącznie z wybranymi kandydatami, których profil najlepiej odpowiada naszym oczekiwaniom. W przypadku pozytywnego rozpatrzenia kandydatury, odezwiemy się telefonicznie lub mailowo w przeciągu kilku dni roboczych.
    </div>
    <p>Jeszcze raz serdecznie dziękujemy za zainteresowanie naszym miejscem i życzymy powodzenia w dalszych poszukiwaniach.</p>
    <p>Z poważaniem,<br><strong>Zespół cukru.cafe</strong></p>
  </div>
  <div class="footer">
    <p>cukru.cafe · Jelenia Góra<br>Wiadomość wysłana automatycznie — prosimy na nią nie odpowiadać.</p>
  </div>
</div>
</body>
</html>`;
}

// ── Endpoint formularza ───────────────────────────────────────────
app.post('/submit', async (req, res) => {
  const data = req.body;

  // Walidacja pól obowiązkowych
  const required = ['imie_nazwisko', 'telefon', 'email', 'wiek', 'student',
    'o_sobie', 'praca_z_ludzmi', 'okres', 'godziny',
    'angielski', 'niemiecki', 'czeski',
    'napoj', 'sytuacja_kawa', 'sytuacja_sniadanie', 'rodo'];

  const missing = required.filter(f => !data[f] || data[f].trim() === '');
  if (missing.length > 0) {
    return res.status(400).json({ error: 'Wypełnij wszystkie wymagane pola.', missing });
  }

  try {
    const transporter = createTransporter();

    // Mail do rekrutera z pełnym podsumowaniem
    await transporter.sendMail({
      from: `"Formularz rekrutacyjny cukru.cafe" <${process.env.SMTP_USER}>`,
      to: process.env.MAIL_TO,
      subject: `Nowe zgłoszenie: ${data.imie_nazwisko}`,
      html: buildEmailHtml(data),
    });

    // Mail potwierdzający do kandydata
    await transporter.sendMail({
      from: `"cukru.cafe" <${process.env.SMTP_USER}>`,
      to: data.email,
      subject: `Potwierdzenie zgłoszenia rekrutacyjnego – cukru.cafe`,
      html: buildConfirmationHtml(data),
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Błąd wysyłki maila:', err);
    res.status(500).json({ error: 'Błąd wysyłki maila. Sprawdź konfigurację SMTP.' });
  }
});

app.listen(PORT, () => {
  console.log(`cukru.cafe rekrutacja działa na http://localhost:${PORT}`);
});
