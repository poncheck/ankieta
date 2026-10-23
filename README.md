# cukru.cafe — Formularz rekrutacyjny

## Uruchomienie

### 1. Sklonuj / skopiuj projekt
```
cukru-rekrutacja/
├── public/
│   └── index.html
├── server.js
├── package.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

### 2. Skonfiguruj maila
Skopiuj plik `.env.example` jako `.env` i uzupełnij dane:

```bash
cp .env.example .env
```

Otwórz `.env` i wpisz:
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` – dane serwera pocztowego
- `SMTP_USER` – adres e-mail nadawcy
- `SMTP_PASS` – hasło (dla Gmaila: **hasło do aplikacji**, nie zwykłe hasło)
- `MAIL_TO` – adres, na który mają przychodzić zgłoszenia

#### Gmail – jak wygenerować hasło do aplikacji:
1. Wejdź na myaccount.google.com
2. Bezpieczeństwo → Weryfikacja dwuetapowa (musi być włączona)
3. Bezpieczeństwo → Hasła do aplikacji
4. Utwórz nowe hasło dla aplikacji "Poczta"
5. Skopiuj wygenerowane hasło do `SMTP_PASS`

### 3. Uruchom przez Docker

```bash
docker compose up -d
```

Formularz dostępny pod: **http://localhost:3000**

Aby zatrzymać:
```bash
docker compose down
```

Aby zobaczyć logi:
```bash
docker compose logs -f
```

### 4. Uruchomienie bez Dockera (lokalnie)

```bash
npm install
node server.js
```

## Dane aplikacji (poza gitem)

Wszystko, co zapisuje aplikacja, leży w katalogu `data/` (w Dockerze zamontowanym jako wolumen) i **nie jest śledzone przez gita**, bo zawiera dane osobowe kandydatów:

- `data/candidates-<id>.json` – zgłoszenia
- `data/cv/` – przesłane CV (PDF/JPG)
- `data/recruitments.json` – definicje rekrutacji

Na świeżej instalacji katalog jest pusty. Pierwszą rekrutację można utworzyć w panelu admina (`/admin`) albo zacząć od gotowego przykładu:

```bash
mkdir -p data && cp examples/recruitments.example.json data/recruitments.json
```

Pamiętaj o kopii zapasowej katalogu `data/` — to jedyne miejsce, gdzie te dane istnieją.

## Co się dzieje po wysłaniu formularza?

1. Kandydat wypełnia formularz na stronie
2. Dane trafiają na `/submit` w Express
3. Serwer buduje ładny mail HTML z podsumowaniem kandydata
4. Mail leci na adres z `MAIL_TO`
5. Kandydat widzi ekran potwierdzenia

## Dostosowanie

- Treść maila: edytuj funkcję `buildEmailHtml()` w `server.js`
- Wygląd formularza: edytuj `public/index.html`
- Port: zmień `PORT` w `.env` i odpowiednio w `docker-compose.yml`
