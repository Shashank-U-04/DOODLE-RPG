# Doodle RPG

Play it at **[doodlerpg.vercel.app](https://doodlerpg.vercel.app)**.

A hand-drawn survival shooter: a custom Three.js engine that renders everything as
ink on paper, waves of sketched enemies, real-world guns, two maps, and online
free-for-all matches on an authoritative match server.

**PLAY VS COMPUTER**: survive the waves. **PLAY WITH FRIENDS**: share a code and
shoot a friend. **CUSTOMIZE CHARACTER** (on the right of the title screen): pick the
fighter your friends see. Best score, settings and your fighter are saved in the browser.

---

## The game

| System            | How it works                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Waves**         | Clear every enemy to advance. Every 5th wave brings a boss with a health bar and a checkpoint.                      |
| **Score & combo** | Kills build a combo meter that decays quickly; airborne kills pay +33%.                                             |
| **Weapons**       | `1–5` / wheel: **AK-47 · M1887 · AWM · katana · Desert Eagle**, each a modelled gun with its own action and reload. |
| **Katana**        | A three-cut combo; landed slashes fill the Focus meter, and a full meter makes `F` a dash-and-strike.               |
| **Grenades**      | `G` throws an M67. Finite per run; ammo packs carry more.                                                           |
| **Movement**      | `WASD`, `Space` (double jump), `Shift` sprint, `C`/`Ctrl` crouch, `X` dash.                                         |
| **Look**          | Pointer lock with adjustable sensitivity and optional inverted Y (title screen).                                    |

### Maps

- **Doodle District**: streets, rooftops and staircases.
- **The Great Pyramid**: one open desert arena around a hollow pyramid with a
  ledge round its top, smaller walk-in pyramids, a temple, the sphinx, an oasis
  and dunes. Mummies join the waves here.

### Online (free for all)

Three screens: the title, the setup screen (pick the map and the kills to win:
5, 10, 15, 20, 25 or 30), then the room. The host creates a room and gets a 4-letter
code; up to nine friends join with it, everyone readies up and the host starts.
The first player to reach the kill target takes it; if everyone else leaves, the
last one standing wins. The host can call a rematch. Online play runs on the **Colyseus match server** in
[`server/`](server/README.md): it owns the room, roster, rules and start, validates
every movement, and referees every shot (hits, damage, health, deaths, respawns
and the score). A dropped player's seat is held for 30 seconds, so a reload
resumes it.

### Characters

**Customize Character** picks one of 20 ready-made fighters (Poly Pizza models by
Quaternius, Polygonal Mind, mastjie, Vaporworks and J-Toastie; see
[`public/characters/CREDITS.md`](public/characters/CREDITS.md)). The pick is saved in
the browser, sent with the join, and every other player sees that fighter running,
aiming and shooting with the weapon it actually holds. Looks are cosmetic: everyone
has the same hitbox.

- Models are drawn in the game's ink style in their own colours. Textured models
  are painted by clustering their texture colours (`src/game/paint.ts`).
- Models without a skeleton or usable animations are rigged at load time with the
  SWAT's skeleton and clips (`src/game/autorig.ts`).
- Characters carrying the sniper hold the "Sniper Rifle" model by Zsky (CC-BY 3.0).

---

## Project structure

```
src/
├── game/
│   ├── engine.ts       # game loop, waves, combat, camera, view-model guns, remote players
│   ├── world.ts        # ink palette and materials, colliders, enemies
│   ├── district.ts     # Doodle District
│   ├── pyramid.ts      # The Great Pyramid
│   ├── guns.ts         # the modelled guns (first person and on rigs)
│   ├── rig.ts          # enemy rigs (and the default doodle for players without a fighter)
│   ├── characters.ts   # the fighter roster: loading, weapons in hand, animation
│   ├── autorig.ts      # rigging for models without a skeleton
│   ├── paint.ts        # texture colours → inks
│   ├── preview.ts      # the Customize Character turntable
│   ├── look.ts         # the saved fighter and its wire code
│   ├── colyseus.ts     # the online session (Colyseus client)
│   ├── transport.ts    # session types and the match server URL
│   └── shaders.ts, props.ts, audio.ts, …
├── pages/              # Landing, Setup, Online, Game, Customize
└── components/DotField.tsx
server/                 # the Colyseus match server (deployed on Render)
public/characters/      # fighter models, card pictures, credits
public/weapons/         # the sniper model
e2e/                    # Playwright smoke tests against the real build and server
docs/                   # performance baseline (how to measure frame times)
```

## Getting started

```bash
# frontend (repo root): Bun, as CI pins it
bun install
bun run dev                      # Vite on :5173

# match server, in another terminal (for online play)
cd server && npm ci && npm start # Colyseus on :2567
```

A development build talks to `http://localhost:2567` by default. Open `/online` in
two browsers (or one normal and one private window), create a room in one and join
with the code in the other.

The frontend uses **Bun** (`bun.lock`; Vercel picks Bun from it) and the match server
uses **npm** (`server/package-lock.json`, as Render runs it). Don't add a root
`package-lock.json`. The server's tests also need the frontend installed: its parity
tests import the game's own map builders and weapon tables.

Every pull request runs `.github/workflows/ci.yml`: frontend typecheck, lint and
build (with a bundle report), the server's `npm run check` on Node 22 and 24, and
the Playwright smoke tests.

## Environment

| Variable            | Where             | Purpose                                                                                                       |
| ------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `VITE_COLYSEUS_URL` | Frontend (Vercel) | The match server's URL. Development builds default to `http://localhost:2567`; production builds must set it. |
| `ALLOWED_ORIGINS`   | Server (Render)   | Exact browser origins allowed to use the match server. See [`server/README.md`](server/README.md).            |

Vite inlines `VITE_*` values at build time: after changing one in Vercel, redeploy.

## Deployment

- **Frontend: Vercel.** Every push to `main` deploys. `vercel.json` rewrites every
  path to `index.html` for client-side routing.
- **Match server: Render**, from the branch in `render.yaml`. See
  [`server/README.md`](server/README.md).

## Scripts

| Script             | What it does                                             |
| ------------------ | -------------------------------------------------------- |
| `bun run dev`      | Vite dev server                                          |
| `bun run build`    | Typecheck + production build to `dist/`                  |
| `bun run preview`  | Serve the production build locally                       |
| `bun run lint`     | ESLint                                                   |
| `bun run format`   | Prettier (CI runs `format:check`)                        |
| `bun run test:e2e` | Playwright smoke tests (starts its own server and build) |

## Controls

| Key           | Action                                                              |
| ------------- | ------------------------------------------------------------------- |
| `WASD`        | Move                                                                |
| Mouse         | Look                                                                |
| `LMB` / `RMB` | Fire / aim down sights (block with the katana)                      |
| `LMB` (AWM)   | Fires; or, with the setting on, hold to scope in and let go to fire |
| `Space`       | Jump · again in the air = double jump                               |
| `Shift`       | Sprint                                                              |
| `C` / `Ctrl`  | Crouch                                                              |
| `X`           | Dash                                                                |
| `F`           | Katana slash                                                        |
| `R`           | Reload                                                              |
| `G`           | Grenade                                                             |
| `1–5` / wheel | Weapon slots                                                        |
| `M`           | Music                                                               |
| `P` / `Esc`   | Pause                                                               |

## License

MIT, see [LICENSE](LICENSE). Character and weapon models keep their own licences
(CC0 / CC-BY 3.0), listed in [`public/characters/CREDITS.md`](public/characters/CREDITS.md).
