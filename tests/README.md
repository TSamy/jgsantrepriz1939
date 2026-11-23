# Tests (not deployed)

End-to-end checks with Playwright (Chrome, Firefox, WebKit) and axe-core.

    # from the project root
    PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
    AXE_PATH=/path/to/node_modules/axe-core/axe.min.js \
    node tests/run.js                       # everything (~2 min)
    node tests/run.js --only=contacts,fab   # some blocks

Blocks: `deploy` (no fictitious numbers in deployable files), `contacts`,
`fab` (floating WhatsApp), `poster`, `video` (autoplay, accessibility,
slow connections, stall guard), `nav`, `a11y` (axe), `contrast`.

Requirements: Node 18+, python3 with Pillow and numpy, ffmpeg, Google Chrome
(Playwright's bundled Chromium cannot play H.264). Without the env vars, the
script uses `require('playwright')` / `require.resolve('axe-core/...')`.

Test phone numbers and a synthetic poster test card are injected through request
interception only. Nothing in the site is modified. Screenshots go to `$SHOTS_DIR`
(default: a temp folder, printed at the end).

The suite never uses fixed sleeps. Each step waits for an observable state:
CSS transition finished, video actually playing, scroll settled, `aria-current` updated.
