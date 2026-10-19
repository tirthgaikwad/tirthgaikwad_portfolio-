# Putting Connect2Minds online

What has to be filled in, set up and checked before the site is public. Nothing here is needed to run the site on
your own computer.

## 1. Fill in before launch (the site shows these as red placeholders)

| What | Where | Why |
|---|---|---|
| Legal name, registered address, GSTIN (or leave empty: "Not registered for GST"), support email, phone, hours | `SITE_INFO` at the top of `legal.js` | Contact page and refund page; required by the Consumer Protection (E-Commerce) Rules 2020 and checked by Razorpay before it allows live payments |
| Grievance Officer name and email (a person living in India) | `SITE_INFO.grievanceName` / `grievanceEmail` in `legal.js` | IT Rules 2021 Rule 3(2) and DPDP Act 2023; shown on Contact, DPDP and Terms |
| Courts for disputes | `terms.html`, "Law and disputes" (points to the registered office on Contact) | Check it with your lawyer |
| Your real domain instead of `https://connect2minds.in` | `sitemap.xml`, `robots.txt` (last line), the `og:image` tag in every page head (search for `connect2minds.in/icons/og-image.png`) | Search engines and link previews need full addresses |
| New logo image | `HEADER_LOGO` in `shared.js`, the `<img>` in `index.html`, `login.html`, `register.html`, `reset.html`, `guardian.html` and the page footers | The current picture still says "ProPartner" |
| Read every legal page once more | `privacy.html`, `dpdp.html`, `terms.html`, `refund.html`, `copyright.html`, `cookies.html` | They were written in plain words, not by a lawyer. A lawyer's review is recommended before launch |

The refund promises in `refund.html` (7 days if unused, answer in 2 working days, pro-rata for business plans) are a
starting point: change them to what you will really do, and keep `terms.html` and `pricing.html` saying the same.

When you change the privacy notice or the terms in substance, raise `PRIVACY_VERSION` (near `ProfileRegister`) or
`TERMS_VERSION` (section 31) in `main.py`: every member is then asked to agree again.

## 2. Server settings (`.env`)

| Key | Needed | What it does |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection |
| `SECRET_KEY` | yes | Signs logins, links and codes. Long and random. Changing it logs everyone out and breaks two-step login secrets |
| `ALLOWED_ORIGINS` | yes | The addresses the pages are served from, comma separated, e.g. `https://connect2minds.in,https://www.connect2minds.in` |
| `SITE_URL` | yes | The pages' address, used in emails (reset links, guardian links, weekly email) |
| `API_URL` | yes | The API's public address (the weekly email's stop link) |
| `COOKIE_SECURE` | optional | `1` forces Secure cookies (on by itself behind https with `X-Forwarded-Proto`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | strongly recommended | Without them: no password reset emails, no email codes, no guardian links, no weekly email. The founder console's Safety tab then offers manual reset links and guardian approval |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | for payments | Test keys first, then live keys after Razorpay approves the website |
| `BUSINESS_NAME`, `BUSINESS_GSTIN` | for receipts | Printed on payment receipts |
| `VAPID_SUBJECT` | for push | A real `mailto:` address (iPhones need it) |
| `ANTHROPIC_API_KEY` | recommended | Turns on the AI Tutor (doubts, exam answers, AI flashcards and quizzes, the founder's AI question drafts) and AI answers in the helper bot. The server's Python also needs `pip install anthropic` |
| `AI_MONTHLY_BUDGET_INR` | with the key | The most the AI Tutor may spend in a month (default 1000). At 80% free accounts pause until the 1st, at 100% everyone. The founder's `/api/founder/ai-usage` shows this month's spend |
| `USD_TO_INR` | optional | Exchange rate used to estimate AI spend in rupees (default 88) |
| `FOUNDER_CODE` | optional | Founder login on the admin tab |
| `SITE_UTC_OFFSET_MINUTES` | optional | "Today" for study and practice; 330 (India) by default |

## 3. Hosting layout

The pages are plain files; the API is `uvicorn main:app`. The simplest setup is one domain with a proxy (nginx,
Caddy, or the host's router): `/api/*`, `/static/*` and websockets (`/api/ws/*`) go to the API, everything else is
served from the project folder. The pages then find the API on their own address (`API_BASE` in `shared.js`/`auth.js`).
If the API must live on another address, put `<script>window.C2M_API_BASE = 'https://api.example.com'</script>`
before `shared.js` / `auth.js` on every page, and add the pages' address to `ALLOWED_ORIGINS`.

- Serve over **https** only. Service workers (push), the microphone and camera (calls) and Secure cookies need it.
- Give `static/uploads/` and `private_uploads/` a **persistent disk** (or move them to object storage); they hold people's
  files, ID cards and the push key.
- One API process unless Redis is added (live sockets, online status and the login-safety sets are kept in memory).
- Do not serve the project folder's other files: `.env`, `*.py`, `private_uploads/`, `__pycache__/`, `media_cache/`
  must never be reachable from the web. Serve only `*.html`, `*.js`, `*.css`, `*.json` used by pages
  (`helpbot_kb.json`, `practice_bank.json`), `icons/`, `favicon.*`, `site.webmanifest`, `robots.txt`, `sitemap.xml`, `sw.js`.
- Unknown addresses should answer with `404.html`.
- Event share links (`/e/<slug>`, events.py) are answered by the API, not by a page file: send `/e/*` to the API too.
  They give WhatsApp, LinkedIn and Google the event's title, description and poster, then forward people to `event.html`.
  The list of public events for search engines is `/api/events-sitemap.xml` (named in `robots.txt`).
- Event uploads: posters go to `static/uploads/events/`; files people attach to a registration go to
  `private_uploads/event_files/` (never served directly; organisers open them through the API).

### Headers the page host must send

The API already sends these; the static pages need them from the host too:

```
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: SAMEORIGIN          # not DENY: the call dock frames the site's own pages
Permissions-Policy: camera=(self), microphone=(self), geolocation=(), payment=(self)
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

## 4. Check after going live

- Sign up with a test account (under 18 and over 18), log in, reset the password by email, turn two-step login on and off.
- Report something from a second account; see it in the founder console's Safety tab, answer it, and check both
  accounts got a notification.
- Send the Support, DPDP and takedown forms; they appear under Enquiries with their reply dates.
- A test payment with Razorpay test keys, then the refund flow in the founder console.
- Open a link to the site in WhatsApp or LinkedIn: the preview should show the picture from `icons/og-image.png`.
