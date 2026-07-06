# 🎷 Sax-o-Phone

A virtual saxophone you play on your phone: **press the keys to finger a note, then tilt the phone up to blow.**
Inspired by tilt-to-blow instruments like saxmix. Pure static site — no build step, no dependencies.

## Play

- **Start** — enables sound and asks for motion-sensor permission (required on iOS, must be a tap).
- **Calibrate rest** — hold the phone however you'll play it, then tap. This is your "silent" angle.
- **Blow** — tilt the top of the phone back/up (screen tilts toward the ceiling). The further you tilt past rest, the louder and brighter the tone. A breath meter shows how hard you're blowing.
- **No motion sensor?** Hold the big **BLOW** pad instead. You can also toggle **Tilt: off** to play pad-only.

### Fingering

Standard saxophone fingerings (written pitch). The main keys are grouped Left hand (1/2/3) and Right hand (1/2/3), matching a real sax's six tone holes, plus the **Octave** key and low pinky keys.

| Note | Left | Right |
|------|------|-------|
| C♯ | — | — |
| C | 2 | — |
| B | 1 | — |
| A | 1 2 | — |
| G | 1 2 3 | — |
| F♯ | 1 2 3 | 1 3 (fork) or F♯ key |
| F | 1 2 3 | 1 |
| E | 1 2 3 | 1 2 |
| D | 1 2 3 | 1 2 3 |
| Low C♯/C/B/♭B | 1 2 3 + pinky | 1 2 3 |
| E♭ | 1 2 3 | 1 2 3 + E♭ |

Hold **Octave** to jump up an octave. It's multi-touch, so press as many keys as you have fingers.

Pick **Alto / Tenor / Soprano / Baritone** in the top bar to change the transposition (pitch range).

## Deploy to GitHub Pages

```bash
cd sax-o-phone
git init
git add .
git commit -m "Sax-o-Phone"
git branch -M main
# create an empty repo on GitHub first, then:
git remote add origin git@github.com:<you>/sax-o-phone.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Source: Deploy from a branch → main / root**.
Your instrument will be live at `https://<you>.github.io/sax-o-phone/`.

> ⚠️ Motion sensors and audio require **HTTPS** — GitHub Pages provides this automatically. Opening the file locally (`file://`) works for the keys and BLOW pad, but iOS won't grant motion access without HTTPS.

## How it works

- **Sound:** Web Audio API — detuned saw + square oscillators through a lowpass + peaking formant filter, with breath-driven noise and vibrato, for a reedy sax-ish timbre. Monophonic, like a real sax.
- **Blow:** `devicemotion` gravity along the screen normal. Calibration stores the rest angle; tilting past a deadzone maps to breath (0–1), which drives amplitude, brightness, and vibrato depth.
- **Fingering:** button combinations map to written MIDI notes, transposed per instrument to sounding pitch.

Files: `index.html`, `styles.css`, `app.js`, `manifest.json`. That's the whole app.
