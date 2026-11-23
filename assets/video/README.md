# Hero background video — `assets/video/`

Only real footage of American eel glass eels (*Anguilla rostrata*) may be
used here. The company confirms the species and holds the rights to the footage.

## Current files (encoded 2026-11-22)

| File                      | Used on                                   | Size      | Format                          |
|---------------------------|-------------------------------------------|-----------|---------------------------------|
| `civelles-portrait.mp4`   | Portrait screens (phones, upright tablets) | ~1.5 MB   | 480×848, H.264 Main, 30 fps, 13.3 s, no audio |
| `civelles-landscape.mp4`  | Landscape screens (desktops, laptops)      | ~1.1 MB   | 480×320 crop, H.264 Main, 30 fps, 13.3 s, no audio |
| `civelles-poster.jpg`     | Poster (all screens)                       | 60 KB     | 446×720 JPEG, company photo, black side bars trimmed |

Source: `media-source/WhatsApp Video 2026-11-21 at 14.31.34.mp4` (848×480
rotated to portrait, 14.3 s). It is not deployed.

Processing: rotation applied, audio removed, 1 s crossfade so the loop
has no visible jump, faststart for progressive playback. **No upscaling:**
the source is 480 px wide, and enlarging it would add weight without adding
detail. The browser scales it with `object-fit: cover`, which crops and never
stretches.

## Adding the poster image

1. Save the company's image as `assets/video/civelles-poster.jpg`. Use JPEG,
   about 1280 px on the long side and ≤ 250 KB.
2. In `assets/js/config.js`, set
   `heroPoster: 'assets/video/civelles-poster.jpg'`.
   The image is applied only once it has loaded (no broken image if missing),
   with `object-fit: cover`: cropped to fit, never stretched. It stays on screen
   when the video does not autoplay (reduced motion, slow connection).

## Replacing the footage (recommended when better footage exists)

The current source is a WhatsApp-compressed phone video, so it looks soft on
large screens. For a sharper hero, supply the original file. In WhatsApp,
"send as document" keeps the full quality. Landscape orientation, 1080p or more,
stable camera (tripod) and 10–20 s are best. Then run:

    tools/prepare-video.sh <source-video> [crop-y-offset-for-landscape]

## Built-in behaviour (assets/js/main.js → initHeroVideo)

- Autoplay, muted, looping, `playsinline` (iOS). `data-enabled="false"` turns it off.
- Loaded after the page has finished loading (protects first paint).
- Portrait vs landscape file chosen by screen orientation.
- `prefers-reduced-motion: reduce`, Save-Data, slow-2G/2G/3G connection: no
  download, poster/gradient only, plus a "Play background video" button.
- Stall guard: if an automatic start is not playing after 8 s (very slow
  network, or a browser that does not report its connection, such as iOS Safari),
  the download is cancelled and the Play button is offered.
- Accessible pause/play button (`aria-pressed`, visible label, keyboard).
- Pauses automatically when off-screen or the tab is hidden; resumes unless the
  visitor paused it.
- If a file is missing or fails, the video is removed and the gradient stays.
