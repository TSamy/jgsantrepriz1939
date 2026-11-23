# JGS Antrepriz 1939 — showcase website

Static website for https://jgsantrepriz1939.com. Plain HTML, CSS and
JavaScript, with no framework, build step or third-party requests.

## Structure

```
index.html                 Single page: Home · About Us · Our Product · Export Information · Contact
assets/
  css/main.css             All styles (design tokens at the top)
  js/config.js             ← EDIT HERE: phone/WhatsApp numbers, WhatsApp message, hero poster
  js/main.js               Mobile nav, active section, hero video, contacts, floating WhatsApp, copy email, reveal
  fonts/                   Fraunces + Inter (self-hosted, SIL OFL licenses included)
  img/                     Official logo (logo.jpeg) + header mark, favicons
  video/                   Hero video: civelles-portrait.mp4 + civelles-landscape.mp4 (see assets/video/README.md)
tools/prepare-video.sh     ffmpeg script that encodes the hero video
tests/                     Playwright + axe end-to-end checks (NOT deployed, see tests/README.md)
media-source/              Original footage as received (NOT deployed)
_template-original/        Archived "Desi" template + first JGS draft (NOT deployed)
.deployignore              Paths to exclude when uploading to the server
```

## Local preview

    python3 -m http.server 8000
    # open http://localhost:8000

Use a local server rather than opening the file directly. The "Copy email"
button only shows up on `localhost` or HTTPS.

## Phone numbers, WhatsApp and poster: `assets/js/config.js`

All values still to supply live in this one file:

- `contacts[].phone`: Haitian (`+509` + 8 digits) and US (`+1` + 10 digits)
  numbers in international format. Spaces are shown as typed.
  **Empty = hidden everywhere**: contact card, Call Now / WhatsApp buttons
  and the floating WhatsApp button. Malformed or placeholder values are hidden too.
- `contacts[].whatsapp`: show the WhatsApp button for that number.
- `whatsappMessage`: prefilled English message, URL-encoded automatically.
- `heroPoster`: path to the company-supplied poster image (empty until it exists).

Links are generated as `tel:+<digits>` and `https://wa.me/<digits>?text=<encoded>`.
WhatsApp only opens after a click. One WhatsApp number makes the floating
button a direct link; two numbers turn it into a Haiti / USA chooser. The
floating button shows only between the hero and the Contact section, so it never
covers the hero controls, the contact buttons or the footer.

## Design tokens

Colours, fonts and spacing are CSS variables at the top of `assets/css/main.css`:
night blue `--night-*`, pearl white `--pearl-*`, champagne `--champagne-*`.
`--champagne-700` is the only champagne shade with enough contrast for
text on the light pearl background.

## Adding French (planned)

1. Copy `index.html` to `fr/index.html`. Set `<html lang="fr">`, prefix every
   asset path with `../` and translate the text.
2. Set the French page's canonical to `https://jgsantrepriz1939.com/fr/`, and
   add reciprocal `hreflang` links on both pages (they are already commented out in `index.html`).
3. Uncomment the `.lang-switch` block in the navigation of both pages.
4. Add `/fr/` to `sitemap.xml`.
5. JS UI strings (menu labels, video button, copy status) are in
   `assets/js/main.js`. Move them to `data-*` attributes if both languages
   share one script.

## Content rules

Publish only information the company has validated. Do not add
certifications, permits, export capacity, quantities, sizes, prices or
guarantees unless the company provides and confirms them.

## Roadmap / still to do

- [x] Real footage encoded and hero video enabled (2026-11-22)
- [x] Poster image (company photo, black side bars trimmed)
- [ ] Final Haitian and US phone/WhatsApp numbers (config.js)
- [ ] Optional: higher-quality original footage (current source is WhatsApp-compressed, 480 px wide)
- [x] Official logo and favicons (2026-11-22)
- [ ] Open Graph share image (1200×630)
- [ ] Validated legal texts (privacy notice / legal notice), then link them in the footer
- [ ] `robots.txt`, `sitemap.xml`, `404.html`
- [ ] Professional inquiry form with anti-spam protection (honeypot + time
      check + Cloudflare Turnstile or hCaptcha) via a form service or a small
      server endpoint
- [ ] French version (`/fr/`)

## License

Adapted from the "Desi" template by Inovatik (MIT), archived in
`_template-original/`. Fonts: SIL Open Font License 1.1.
