# CLAUDE.md

Guidance for AI agents (and humans) working in this repository. Read this
before editing anything — this codebase looks tiny but is dense, and several
parts break in non-obvious ways if touched carelessly.

## 1. What this repo is

This is the **entire frontend** for **AIMix** (AI Mixing & Mastering), a web
app sold under the "2 Points Sound" / aimixingmastering.com brand. It is a
**static, dependency-free, two-page site** — there is no build step, no
bundler, no `package.json`, no framework. Everything is hand-written HTML with
inline `<style>` and inline `<script>`. It is deployed on **Vercel** as plain
static files (see `vercel.json`).

The whole repo is:

| File | Role |
|------|------|
| `index.html` | The **AI Mixer** page (~2100 lines). Upload → stem separation → live multitrack mixer. |
| `master.html` | The **AI Master** page (~1440 lines). Loads the mixed track → mastering knobs → download. |
| `extendo.html` | **Extend The Mix** by 2 Points Sound (product name; file/identifiers keep the `extendo` codename) (~1200 lines). Standalone DJ tool styled like DJ software (master strip, Deck A/B, hot-cue pads, settings sidebar, multi-track library): drop songs → BPM/grid/key detection → adds 8/16/32 bars of tempo-matched synthesized drums (8 styles × 4 grooves) + transition FX before and after → WAV download. Audio is fully client-side; sign-in gate via the shared Supabase auth. See §9. |
| `vercel.json` | Rewrites `/` → `/index.html` and `/extendo` → `/extendo.html`; on `extendthemix.com` `/extendo*` redirects to `/`. |
| `middleware.js` | Vercel Edge Middleware: `extendthemix.com/` → `extendo.html`. Needed because Vercel serves the static `index.html` at `/` **before** `vercel.json` rewrites run, so a host-based rewrite for `/` never fires. Matches only `/`; everything else passes through. |
| `tests/` | Node tests for Extendo only (`extendo-dsp.test.js` and `extendo-downbeat-bench.js` need just Node; `extendo-e2e.js` needs Playwright + Chromium). The mixer/master pages still have no tests. |
| `ChatGPT Image *.png` | Artist-chain avatar images (Drake/Rihanna/Kendrick/Travis/Weeknd). Served **from GitHub raw URLs**, not locally (see `CHAINS` in `index.html`). The local copies are the source the raw URLs point at. |

There is no linter and no CI; the only tests are the two Extendo scripts in `tests/`. "Running" it is just opening the HTML
files (or `vercel dev` / any static server). Deploys happen by pushing to the
Vercel-connected branch.

### What a user actually does

1. Lands on `index.html`. If not signed in, an **auth wall** blocks playback
   (but not upload preview).
2. (Optional) Types a song into the **Spotify reference** box to pull target
   audio features.
3. **Drops an audio file** (MP3/WAV/FLAC/M4A) on the drop zone.
4. The backend separates it into **4 stems** (drums, instruments, bass,
   vocals). A "cooking" progress tracker animates during the ~30s–5min wait.
5. Stems load into a **4-channel live mixer**. The user adjusts volume / EQ /
   reverb per stem, applies an **artist "vocal chain"** preset, hits
   **Auto-Mix** or **🎲 random tone**, and plays the mix live in the browser.
6. Clicks **"Master + Export"** (`goToMaster()`), which renders the current mix
   to a WAV, stashes it in **IndexedDB**, and navigates to `master.html`.
7. On `master.html`, three macro knobs — **Sparkle / Clarity / Maximize** —
   apply a mastering chain in real time against a LUFS target (-14 / -9 / -6).
8. Clicks **Download** — gated by a **Stripe subscription paywall** — to get the
   final mastered WAV.

## 2. Architecture (the whole system, not just this repo)

This frontend talks to several external services. **None of the backend code
lives in this repo** — only the client calls.

```
  Browser (this repo, static HTML/JS on Vercel)
     │
     ├── FastAPI backend ── Railway
     │     https://aimix-backend-production.up.railway.app
     │     └── proxies Replicate (Demucs stem separation),
     │         Spotify search, Stripe, Systeme.io
     │
     ├── Supabase  (auth + subscriptions DB)
     │     https://bhuduafakmaywnxklfyk.supabase.co
     │
     ├── Stripe    (payments — hosted checkout + payment links)
     │
     └── Meta Pixel (fbq) — conversion tracking
```

### 2a. Backend (FastAPI on Railway)

Base URL is the `API` constant, defined **separately in each file** (search for
`const API=` / `var API =`). All of these are backend endpoints this frontend
depends on:

- `POST /separate-start` — multipart file upload; returns `{prediction_id}`
  quickly. Kicks off Replicate.
- `GET  /separate-status/{prediction_id}` — polled every 5s; returns
  `{status: 'succeeded'|'failed'|..., stems:{drums,instruments,bass,vocals}, error}`.
  Stems come back as **base64-encoded audio** in the JSON.
- `GET  /spotify/search?q=` — returns `{name, artist, image, energy, valence,
  danceability, acousticness, loudness}`.
- `POST /systeme/contact` — adds the email as a lead to Systeme.io (CRM).
- `POST /claim-subscription` — links a subscription purchased-before-signup to
  the now-authenticated user.
- `POST /cancel-subscription` — cancels via Stripe (needs Supabase access token).
- `POST /stripe/checkout` — creates a Stripe Checkout session (used by
  `master.html`'s `startCheckout`).
- `POST /stripe/log-usage/{user_id}` — increments the user's monthly master
  count.

**Stem separation is Replicate + Demucs.** The frontend never calls Replicate
directly; the backend does. The async `start` + `poll status` split exists
specifically because **iOS Safari (and in-app browsers) kill fetches that run
longer than ~60s** — see the long comment in `processTrack`.

### 2b. Supabase (auth + subscriptions)

- Anon key is embedded in the client (this is normal for Supabase — it's the
  public anon key, RLS is expected to enforce access). Same URL/key appear in
  **both** files. In `master.html`'s `loadSubscription`, the **same JWT is
  pasted literally four times** — if you rotate the key, grep for it.
- **Auth methods:** Google OAuth (`signInWithOAuth`) and passwordless **magic
  link** (`signInWithOtp`). No passwords.
- **Tables used from the client:**
  - `subscriptions` — columns `user_id`, `plan` (`starter`|`pro`|...),
    `status` (`active`|`canceled`|`past_due`|...).
  - `usage` — one row per master rendered; the client **counts rows** to derive
    usage (`select id, count exact`). Starter limit is **10/month**; Pro is
    unlimited.
- `master.html` queries Supabase **REST directly** (`/rest/v1/...`);
  `index.html` uses the **supabase-js SDK** (`sb.from('subscriptions')...`).
  Two different access patterns for the same data.

### 2c. Stripe (payments)

Two mechanisms coexist:
- **Payment links** (`https://buy.stripe.com/...`) — used by the mixer page and
  the master paywall's quick buttons (`goStripe`, `masterStripe`). Plans:
  `starter` ($9.99/mo), `pro` ($24.99/mo), `pro_yearly` ($224.99/yr).
- **Hosted Checkout via backend** (`startCheckout` → `POST /stripe/checkout`
  with `PRICE_IDS`) — used on `master.html`.
- Publishable key `pk_live_...` and `PRICE_IDS` are hardcoded in `master.html`.
- **Return flow:** Stripe redirects back with `?paid=true` / `?checkout=success`
  (mixer) or `?success=1&session_id=...` (master). The pages detect this, fire
  the Meta **Purchase** event, and try to `claim`/`load` the subscription.

### 2d. Meta Pixel

Pixel id `524092666589747`. Uses **Advanced Matching** — it reads the signed-in
email from `localStorage.aimix_user` and passes it (Meta hashes it). Helper
`window.mfb(event, data)` fires events: `PageView`, `Lead`, `InitiateCheckout`,
`Purchase`. If you touch the auth or checkout flows, keep these firing.

## 3. Client-side state & the index → master handoff

There is no server-side session for the mix itself. State lives in the browser:

- **`localStorage`**
  - `aimix_user` — `{id, email, name}`. The **source of truth the whole app
    reads synchronously** (auth wall, Meta matching, Stripe email prefill).
    Written by the Supabase auth callbacks.
  - `aimix_sub` — cached `{plan, status, usage, limit}`. **Cache only** — real
    payment decisions always re-fetch from Supabase (`loadSubscription`,
    `buildAuthDD`). Do not trust it for gating.
  - `aimix_trackname` — read on `master.html` to name the download file, **but
    it is never actually written** anywhere (only *removed*). See §6.
  - `aimix_mix_state` — only ever *removed* on sign-out; never written.
- **IndexedDB** — database `aimix`, object store `mix`, key `rendered`. Holds
  the **rendered mixdown WAV as an ArrayBuffer**. This is how `index.html` hands
  the audio to `master.html`. `goToMaster()` writes it; `loadMix()` reads it.
- **`?fresh=1`** — navigating to `index.html?fresh=1` (via master's
  `clearAndGoBack`) clears the IndexedDB mix + `aimix_trackname` so a new upload
  starts clean.
- **`window._authUser`**, **`window._sb`**, **`window._streamDest`**,
  **`window._rawData`** — cross-script globals. See §5/§6 for the sharp edges.

## 4. The Web Audio graph — how it's built and where it's rebuilt

This is the heart of the app and the easiest thing to break. There are **two
completely separate graphs** (mixer and master), and each exists in **two
forms**: a live real-time graph and a duplicated offline-render graph.

### 4a. Mixer graph (`index.html`)

Per-stem state lives in the `stems` object: `{drums, inst, bass, vox}` (note:
UI/graph key is **`inst`** but the backend field is **`instruments`**, and
**`vox`** maps to backend **`vocals`** — see the `map` in `processTrack`).

`buildGraph(id)` builds one stem's chain:

```
source → gain → hiShelf(highshelf @8k; but LOWshelf @200 for bass)
              → punch (peaking EQ; freq differs per stem)
              → dryGain ─────────────┐
              → reverb(convolver) → reverbGain ┤→ destination (or _streamDest on iOS)
```

Reverb is a synthetic impulse from `makeImpulse()` (random-noise decay). The
`punch` node is a peaking filter that the sliders drive via `setEQ`.

**Where the live graph is (re)built — this matters:**
- `processTrack()` → after decoding each stem, calls `buildGraph(id)` once.
- `startAllStems(offset)` → creates a **new `BufferSource` every play** and
  re-runs `connectSrc(id, src)`. Sources are one-shot; pause/seek stop and
  recreate them.
- `listenNow()` (iOS) → creates a **brand-new `AudioContext`**, **re-decodes
  every stem from `stems[id].raw`**, and calls `buildGraph` again. So the graph
  can be built 2× per session; the second time uses fresh nodes in a new
  context. If you add per-stem node state, make sure `buildGraph` reinitialises
  it or iOS playback will use stale/undefined nodes.

**Offline render (mix export)** is duplicated by hand in **two** places —
`exportMix()` and `goToMaster()` — each reconstructs a simplified chain in an
`OfflineAudioContext`. ⚠️ **These do NOT match the live graph:** they apply
`gain`, a fixed `highshelf @8000`, and reverb, but **omit the `punch` peaking
filter entirely** and ignore the bass low-shelf. Editing the live graph does
**not** automatically change what gets exported. Keep this discrepancy in mind
(or fix it deliberately).

### 4b. Master graph (`master.html`)

Single stereo buffer through a mastering chain, built in `buildGraph()` into the
node bag `N`:

```
src → loShelf → hiShelf ─┬─ dryGain ───────────────────────────┐
                         └─ exciterHP → exciterHP2 → sat(waveshaper) → satGain ┤
   → mudCut → harshCut → midCut → presence
   → limDelay → limComp(compressor as limiter) → outGain → ceiling → analyser → destination
```

Three macro knobs map onto these nodes:
- **Sparkle** → `updateSparkleNodes` (low/high shelves + parallel exciter drive/mix).
- **Clarity** → `updateClarityNodes` (mud/harsh/mid cuts + presence boost).
- **Maximize** → `updateMaximizeNodes` (limiter threshold/ratio/release + output
  gain toward the LUFS target + ceiling). It is **adaptive**: `analyzeMix()`
  detects `alreadyLimited` tracks and pulls its punches so it doesn't overcook.

**Where it's (re)built:** `buildGraph()` is called on first `togglePlay()`
(desktop) or inside `listenNow()` (iOS, in a fresh context). Knob handlers call
the `update*Nodes` functions on the live `N` nodes.

**Offline render** for the download is duplicated by hand in
`downloadMastered()` — it rebuilds the **entire** chain node-by-node in an
`OfflineAudioContext`, copying each `.value` from the live `N` nodes. ⚠️ This is
a near-exact copy of `buildGraph` + the `update*` math. **If you change the
mastering chain, you must edit both `buildGraph`/`update*Nodes` AND
`downloadMastered` or the preview and the download will diverge.** (There's
already a latent mismatch: live `hiShelf.frequency` is `10000`, the offline copy
uses `9000`.)

## 5. iOS / mobile audio — handle with extreme care

A large fraction of users are on iOS Safari and in-app browsers (Instagram,
TikTok, Twitter). Several mechanisms exist **only** for them, and they are
timing-sensitive:

- **Silent-switch bypass:** audio is routed through a
  `MediaStreamAudioDestinationNode` → a hidden `<audio playsinline>` element so
  iOS treats it as "playback" and ignores the mute switch. `window._streamDest`
  holds that node; `connectSrc`/`startPlay` connect to it **instead of**
  `ctx.destination` when it exists. Don't connect to both — that double-plays.
- **User-gesture requirement:** the `AudioContext` and stream routing are
  created **inside the click handler** (`listenNow()`), and a silent buffer is
  played synchronously to unlock the session. Moving this out of the gesture
  breaks iOS playback silently.
- **`onended` fires synchronously on iOS** during `stop()` (asynchronously on
  desktop). The naive handler reset the playhead to 0 on every pause. The fix
  (heavily commented in `stopAllStems`/`stopPlay`): set `masterPlaying`/
  `_playing = false` **before** calling `.stop()`, and null the `onended`
  handler first. **Do not "simplify" this ordering.**
- **Async job polling** (`separate-start` + `separate-status`) exists because
  Safari kills >60s fetches. Don't revert to a single long `POST /separate`.
- Long comment blocks marked "Layer 1/2/3" and iOS-specific fixes document
  battle-tested workarounds. Treat them as load-bearing.

## 6. Conventions actually used here (not generic advice)

- **No modules, no framework.** Everything is globals and inline handlers
  (`onclick="applyChain('drake')"`). New functions that HTML calls must be on
  `window` (or top-level in the same script).
- **Naming:** app-specific public functions are prefixed **`aimix`**
  (`aimixToggleAuthDD`, `aimixConfirmCancel`, `aimixShowAuthModal`) to avoid
  clashes with the older, unprefixed auth code. Two auth systems coexist in
  `index.html`: an "old" one (`handleUser`, `showAuthWall`, the `#authWall`
  overlay) and a "new" dropdown one (`buildAuthDD`, `#authDD`). They're wired
  together by **monkey-patching `window.handleUser`**. Editing auth means
  reckoning with both.
- **Stem key mapping** is fixed: UI/graph uses `drums/inst/bass/vox`; backend
  JSON uses `drums/instruments/bass/vocals`. The bridge is one `map` object in
  `processTrack`. Don't rename one side only.
- **Dense one-liners.** Much of the audio code packs many statements per line
  (`const c=getCtx(),s=stems[id]; ...`). Match the surrounding density rather
  than reformatting — diffs stay reviewable and there's no formatter to run.
- **Config constants are duplicated per file** on purpose (each page is
  standalone): `API`, Supabase URL/key, Stripe URLs/keys, plan prices. If you
  change one, grep **both** files.
- **Errors are made customer-friendly**, not raw. `mapUploadError()` translates
  HTTP status codes to human messages; the "cooking" tracker rotates reassuring
  messages during the wait. Preserve that tone if you touch the upload path.

## 7. Fragile / duplicated / easy-to-break spots (read before editing)

1. **Live graph vs offline-render graph drift (both pages).** `exportMix`,
   `goToMaster`, and `downloadMastered` each hand-duplicate their page's audio
   graph. They already diverge from the live graphs (mixer omits `punch` &
   bass low-shelf; master uses 9k vs 10k shelf). **Any graph change needs the
   offline copy updated too**, or preview ≠ download.
2. **`aimix_trackname` is never written.** It's read on `master.html` to name
   the download and read on `index.html` only to delete it. Result: downloads
   are always `"Mastered by AIMixingMastering.com.wav"` and the master page
   shows "Untitled Mix". If you want real names, you must **set** it (e.g. from
   `file.name` in `processTrack`).
3. **`window._sb` is never assigned on `master.html`.** The master auth IIFE
   creates a local `sb` but doesn't expose it. Code paths in `checkCanDownload`
   and the Stripe-success handler that reference `window._sb` are effectively
   dead there (guarded, so they fail silently). Don't assume it's available on
   the master page.
4. **All paywall/credit gating is client-side and bypassable.** `checkCanDownload`,
   the auth wall, and `goToMaster`'s plan check run in the browser. Real
   enforcement must live in the **backend** (`/separate*`, `/stripe/log-usage`).
   Never treat the frontend gate as security.
5. **Supabase JWT pasted 4× in `master.html` `loadSubscription`.** Rotating the
   anon key means finding every literal copy across both files.
6. **Two overlapping auth systems in `index.html`** joined by monkey-patching
   `handleUser`. Order of script execution and the `setTimeout` polling
   (`initSB`, `checkSBSession`, `waitForSession`) matters; magic-link redirects
   rely on it. Tread carefully.
7. **Duplicate `id` attribute:** `index.html` has
   `<div class="auth-dropdown" id="authDD" id="authDropdown">` — two `id`s on one
   element. Code uses `authDD`; `authDropdown` is inert. Don't wire anything to
   `authDropdown`.
8. **Dead / placeholder code, don't be misled:**
   - `getSpotifyToken()` + `SPOTIFY_CLIENT_ID` — placeholder secret; the real
     search goes through the backend `/spotify/search`. The client-side token
     path just `alert`s and returns null.
   - `showSection(s){}` — empty stub still referenced by nav `onclick`.
   - `SYSTEME` const in `index.html` — declared, unused (Systeme.io is called
     via the backend `/systeme/contact`).
9. **Artist avatar images load from GitHub raw URLs** (`raw.githubusercontent.com/
   2pointsmtv-tech/aimix-frontend/main/...`), not relative paths. Renaming or
   moving the PNGs, or changing the default branch, breaks the artist grid in
   production even though the files still exist in the repo.
10. **IndexedDB is the only channel between the two pages.** If `goToMaster`'s
    write or `loadMix`'s read schema changes (db name `aimix`, store `mix`, key
    `rendered`, version `1`), the master page shows "No mix found." Keep them in
    lockstep.

## 8. Practical guidance for edits

- **Prefer surgical edits.** These files are large and stateful; small targeted
  changes are far safer than refactors. There is no test net to catch
  regressions.
- **To verify a change,** open the page in a browser (or `vercel dev`). There's
  nothing to build. Test the **full flow** (upload → mix → master → download)
  and **specifically test iOS Safari** for anything touching audio or auth.
- **If you change the audio graph, LUFS math, or knob mapping,** update the
  matching offline-render function in the same commit.
- **If you change auth, subscription, or checkout,** confirm the Meta Pixel
  events still fire and that both the old (`#authWall`) and new (`#authDD`) UIs
  stay consistent.
- **Secrets:** only *public* keys belong here (Supabase anon key, Stripe
  publishable key, Meta pixel id). Never add a service-role key, Stripe secret
  key, or Spotify client secret to these files — those live on the backend.

## 9. Extend The Mix (`extendo.html`) — the DJ extended-mix page

Separate product, served at **extendthemix.com** (own domain on the same Vercel project, see `vercel.json`) and at `/extendo` here; no shared code with the other two pages.
Audio is 100% in the browser; the only network calls are the shared Supabase
auth, the Meta Pixel and `POST /systeme/contact` (lead tagging). See item 5
for the account gate.

1. `decodeAudioData` → mono downmix → `ExtendoDSP.analyze()` (the `<script id="dsp">`
   block, **pure functions, no DOM**; `tests/extendo-dsp.test.js` extracts and
   runs it in Node, keep it DOM-free).
   - Tempo: 3-band log-energy flux at 512-sample hops → 6-harmonic comb on the
     smoothed autocorrelation at integer lags (+ log-tempo prior centred on
     128 BPM, σ 0.6 oct) → top-8 peaks → **multi-scale parabolic refinement**
     over 1…64-beat lags (needed: a 0.05 BPM error drifts ~90 ms over 4
     minutes) → **re-rank the comb at each refined fractional period** (integer
     lags miss high harmonics when the period isn't a whole frame, which used
     to favour 4:3 / 4:5 pattern periods). Confidence ignores octave rivals.
   - Phase: comb over the frame envelope, then `refinePhase` re-pins it with a
     32-sample-hop flux (±20 ms).
   - Downbeat (`detectDownbeat`): per-beat features z-scored over the track —
     kick/bass onsets (+), snare/hat transients (−), 24-band FFT spectrum
     change vs the previous beat (chords/bass notes change on the bar line),
     spectral + energy change between the next 4 beats and the previous 4
     (sections start on a downbeat), plus a bonus for the beat the track's
     first real hit lands on. `tests/extendo-downbeat-bench.js` scores it on
     36 synthetic house/boom-bap/trap tracks (32/36; the 4 misses are 67 BPM
     boom-bap read as 134 with the downbeat still right). Run it before
     touching the weights.
   - `plan()` builds the timeline: the song's first grid downbeat lands exactly
     at the end of the intro (or the user's `firstDBOverride`, snapped to the
     grid); the outro starts on the last bar line before the audio ends;
     "blend" bars overlap drums under the song with linear fades.
2. Drums (`<script id="drums">`): patterns are 16/32-step strings per
   instrument in `STYLES` (`x`/`o`/`-`/`.`). Each style has a synth `kit` and
   **4 `grooves`** (`{name, A, B}`; B is the variation for the 2nd 4 bars of
   each 8). `opt.groove[styleId]` picks one; `shuffleGrooves()` randomises the
   selected styles and **rebuilds automatically** when a result exists. Every (style, instrument) is rendered **once** as a one-shot via
   a tiny `OfflineAudioContext` (`loadShots`), then `renderSection` mixes
   patterns in plain JS. ⚠️ Do not go back to scheduling one Web Audio node per
   hit over the whole timeline — that took ~20 s per build. Also **no
   `DynamicsCompressorNode` anywhere** in the render path: it adds ~6 ms of
   latency and would shift the grid.
   Transition FX: `sec.fxEnds` (bar-aligned, section-relative) marks where a
   transition lands; `renderSection` then does the **snare build** (replaces
   the pattern for the last `fx.len` bars, kick kept) and the **filter sweep**
   (per-sample 2-pole high-pass rising 30 Hz → 2.5 kHz). The **noise riser**
   (`renderRiser`, Web Audio, cached) and **reverse cymbal** (reversed crash
   one-shot) are added in `build()` at absolute times. `tl.fxRegions` drives
   the pink overlays.
   **Melody bed** (`opt.bed`): `hpss()` in the DSP block (median-filter
   harmonic/percussive separation, 2048/512 STFT, 17×17 medians, in-place
   insertion-sort median) strips the drums from a 4/8-bar phrase of the song;
   `bedLoop()` builds a seam-crossfaded loop per channel (cached per track +
   phrase), `pickPhrase()` uses the user's **sample box** (`song.samp.in/out =
   {start,bars}`, set with "Intro here / Outro here", drawn green on Deck A,
   draggable by whole bars, toolbar `#sampBox`: 1…32 bars, ÷2/×2, Loop =
   sample-accurate `BufferSource.loop` via `player.play(...,loop)`, Melody
   only = previews the HPSS loop buffer with `player.view0` offsetting the
   deck time) or otherwise auto-picks the last/first *loud* phrase (slides by
   4 bars while rms < 50 % of the track's loudness); `placeBed()` loops it from the last
   bar line to the end of the outro (2-bar fade-out) and/or from 0 to the drop
   (1-bar fade-in). Mixed in `build()` as `bedL/bedR`; `tl.bedRegions` draws
   the green "MELODY LOOP" bands. ~2 s per 8-bar stereo phrase.
3. `build()` mixes the song in with a single integer sample `shift`
   (sample-exact), loudness-matches drums to the song's 85th-percentile RMS
   (−1.5 dB), soft-clips only above 0.95, and `download()` encodes 16-bit WAV.
4. Deck UI: one `player` + `view` (`'src'` = **Deck A** original with
   metronome click, `'ext'` = **Deck B** extended result). `lib[]` holds every
   loaded track (`loadFiles` → `processQueue` analyses them one at a time;
   `selectTrack` makes one the `song`; each track keeps its own `result`,
   `firstDBOverride` and `counted`). `detectKey` (Krumhansl chroma → Camelot)
   fills the KEY readouts. The player routes through `gain` (output knob) →
   `AnalyserNode` (LED meter). Hot-cue pads A–D map to `cuesOf()`. `bandCols()` computes 3-band + peak per 256 samples once
   per buffer; `drawOverview` caches the full-track RGB waveform (regions,
   cue triangles) and `drawDetail` redraws the zoomed window with the beat grid
   and bar numbers every frame. Bar 1 is the song's first downbeat (ORIGINAL)
   or the start of the intro drums (EXTENDED). Cue buttons jump 2 bars early.
   The grid is `(bpm, firstBeat, downbeat)`; every manual edit goes through
   `setAnchor(t)` ("this time is a beat 1"). **GRID EDIT** mode on the zoomed
   waveform: pointer drag slides the grid, a click snaps the nearest beat to
   beat 1 (pointer handlers own the canvas, the seek-on-click is suppressed).
   `nudgeBpm` pivots around bar 1 so a BPM trim keeps the downbeat; `setBpm`
   (typed value, ½×/2×, TAP) re-detects phase + downbeat. `setBar1(t)` stores
   `song.firstDBOverride` for tracks whose intro should sit under the drums.

5. Account gate (`GATE=true`, the hosted test copy on claude.ai runs with
   `GATE=false`): analysing, grid editing and drum previews are free and
   anonymous; **Build** needs a sign-in (same Supabase project + custom auth
   domain + `storageKey` as the other pages, magic link or Google; magic link
   `emailRedirectTo` is `origin+pathname` = `/extendo`, which must be on the
   Supabase redirect allowlist). On first sign-in the email is tagged
   `extendo-lead` in Systeme.io. Free accounts get `FREE_BUILDS` (3) mixes,
   counted **per song** (`song.counted`, rebuilds/shuffles of the same track
   are free). After that `openUnlock()` asks for Spotify + Instagram follows
   (`SOCIAL` links; honour system — both links must be clicked) and stores
   `extendo_unlocked`. Counters/flags live in Supabase **`user_metadata`**
   (`extendo_builds`, `extendo_unlocked`) via `saveMeta()` — no new tables,
   follows the account across devices, and like every gate here it is
   client-side and bypassable (§7.4). Unlock tags `extendo-unlocked`; the PRO
   teaser tags `extendo-pro-waitlist`. Meta Pixel `Lead` events fire on magic
   link / Google / unlock / waitlist. Cross-tab: the magic link opens a new
   tab, supabase-js propagates the session to the original tab, whose
   `auth.pending==='build'` then builds the still-loaded track.

6. **Pro** (`$49.99` lifetime / `$9.99` monthly): entitlement comes from the
   backend (`POST /extendo/status` with the user's access token → the
   `extendo_subscriptions` table, see aimix-backend `extendo_tables.sql`),
   never from `user_metadata`. Pro features: the sampler, grooves 3–4 of each
   style (`FREE_GROOVES=2`), Build all. Free accounts get `PRO_TRIES` (5) uses,
   charged once per song at build time (`spendProTry`, counter
   `user_metadata.extendo_pro_used`). `openUpgrade()` → `startCheckout(kind)`
   → `POST /extendo/checkout` → Stripe; the return URL `?pro=success&kind=..&
   session_id=..` re-polls the entitlement and fires the Meta `Purchase` with
   `eventID = session_id` (CAPI dedupe). Cancel monthly: `POST /extendo/cancel`.
7. **Metadata & export.** `parseTags()` (DSP block) reads title/artist/album/
   genre/year/track/BPM/key/cover + raw ID3 frames from MP3, M4A, FLAC and WAV
   **before** `decodeAudioData` (which detaches the buffer). The deck and
   library show the cover and tags. `encodeWav(chs, sr, meta, bits)` writes a
   LIST/INFO chunk and an `id3 ` chunk: with an ID3 source every original frame
   is copied verbatim and only `TIT2` gets " (Extended Mix)"; BPM/key are added
   only when the original had none; nothing branded is written. Bit depth
   follows the source (24-bit WAV/FLAC → 24-bit, else 16). The mix passes the
   song through sample-for-sample; soft-limiting only happens where added
   drums or the melody bed overlap it. Filename: `Artist - Title (Extended
   Mix).wav`.

The shared `player` object follows the same iOS rule as the other pages: set
`playing=false` and null `onended` **before** `stop()`.

8. **In-app help.** Any element with `data-tip` (+ optional `data-tip-title`)
   gets a styled hover popover (`#tipBox`, 380 ms delay, never on touch). The
   6-step **tour** (`TOUR[]`, `startTour`, spotlight ring + card) runs once on
   first visit (`localStorage.extendo_tour`) and from the `?` button; Escape /
   arrows navigate it, and it swallows the deck's keyboard shortcuts while open.
