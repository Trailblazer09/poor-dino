# 🦕 Poor Dino — Cope & Run

A dinosaur too stubborn to
stay extinct, jogging through a thunderstorm under a colorful parachute while the game
mocks him the whole way.

**Play it live:** https://poor-dino-cope-and-run.netlify.app/

## 📸 Screenshots

<p align="center">
  <img src="screenshots/img2.png" width="800" alt="Gameplay: the T-Rex gliding under its parachute at night while the game taunts it">
</p>

<p align="center">
  <img src="screenshots/image.png" width="46%" alt="Start screen">
  <img src="screenshots/img3.png" width="46%" alt="Game over with a shareable score card">
</p>

## ✨ Features

- **Signature parachute mechanic**: The canopy pops open the instant the dino's feet leave the ground, billows as it fills with air at the top of the jump, then pinches shut as it nears the ground (with a gentle pendulum sway).
- **3 lives + heart pickups**: A hit costs a heart (with brief mercy invincibility) instead of an instant game over; once you're down a life, a glowing heart sometimes floats in that you can grab to earn one back (capped at 3).
- **Opening thunderstorm**: Every run starts with heavy, wind-blown rain and lightning flashes + thunderclaps that ease off after a few seconds.
- **Sarcastic quips**: Taunts scroll along under the ground and keep needling you as you run.
- **Air double-jump**: A live-filling power vessel charges over ~20s; when full, jump again in mid-air. Spends the meter, then recharges.
- **Meteor event**: A telegraphed "☄️ INCOMING!" warning, a flaming meteor crashes down, and leaves a smoking boulder to hurdle.
- **Shareable ending**: Game over gives you a sarcastic rank + epitaph and an auto-generated score card you can copy, share, or download. 100% client-side.
- **Rich, procedural graphics** (zero image files):
  - Day → dusk → night → dawn sky cycle with a sun/moon that arcs overhead and twinkling stars.
  - Parallax clouds and rolling hills.
  - A hand-drawn T-Rex that runs, jumps, ducks, blinks, and kicks up dust.
  - Cactus clusters and flapping pterodactyls.
  - Screen shake, particle puffs, and gentle sound effects.
- **Endless & responsive**: Scales to phones and desktops; keyboard, mouse, and touch.
- **High score** saved locally.

## 🎮 Controls

| Action | Keys | Touch |
| ------ | ---- | ----- |
| Jump   | `Space` / `↑` / `W` | Swipe up |
| Duck   | `↓` / `S` | Swipe down |
| Start / Restart | `Space` | Tap |
| Mute   | 🔊 button (top-left) | Tap button |

## ▶️ Run locally

It's a static site — any file server works:

```bash
npx serve .        # or: python -m http.server 8000
```

Then open the printed URL. (Opening `index.html` directly in a browser works too.)

## 🚀 Deploy

No build step — any static host works. `index.html` just needs to be at the site root.

- **Netlify:** drag the folder onto <https://app.netlify.com/drop>, or connect the repo with build command empty and publish directory `.`

## 📁 Project structure

```
poor-dino/
├── index.html   # markup, HUD, overlays
├── style.css    # UI / overlay styling
├── game.js      # game engine + all procedural graphics
└── README.md
```

Built with plain HTML, CSS, and the Canvas 2D API — no frameworks, no build step.
