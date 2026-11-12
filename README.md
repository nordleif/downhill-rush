# Downhill Rush

A third-person downhill mountain bike game for the browser. You ride one long mountain from the summit gate to the valley, choose between green, blue and black trails at three forks, and score with tricks. The game is one HTML page built on three.js with a folder of textures, plus a small room server for multiplayer. Both run on one Cloudflare Worker.

## Play

https://downhill-rush.bo-29c.workers.dev


- **Ride Solo**: race the clock. Works offline.
- **Create Race**: opens a room with a code, for example **PINE 42**. Share the code or use **Copy Link**. Up to 8 riders start on the same countdown. The rider who has been in the room longest starts and restarts the race.
- **Join Race**: enter a room code, or open a shared link (`?room=pine-42`).

## Controls

| Action | Keyboard | Touch | Controller |
|---|---|---|---|
| Steer | A D or arrow keys | Left thumb, sideways | Left stick |
| Pedal | W or Up | Left thumb, up | Right trigger |
| Brake | S, Down or Shift | Left thumb down, or BRAKE | Left trigger |
| Jump | Space | JUMP | A |
| Spin in the air | A D | Left thumb, sideways | Left stick |
| Backflip, frontflip | S, W in the air | Left thumb down, up | Left stick |
| Whip, Tabletop, Barspin, No-Hander, Superman | 1 2 3 4 5 | Trick buttons | X, Y, B, LB, RB |
| Back to checkpoint | R | | |
| Pause | Esc | II | Start |
| Sound | M | Pause menu | |

## Scoring

- A trick counts when its animation finishes before you land. Spins and flips count per full turn.
- Landing banks the points. The combo multiplier is the number of tricks in the jump.
- A perfect landing adds 25 percent. A sketchy landing keeps 60 percent. A crash loses the combo.
- Each repeat of a trick is worth 20 percent less, down to a quarter.
- Flow points come from carving corners at speed, clean sections between checkpoints, jump chains, long air and riding a whole skinny.
- The total is tricks plus flow plus a time bonus. Medal limits are in `src/score.js`.

## Worlds

- **World** on the start screen switches between Mountain and City. Switching reloads the page.
- City is the same trail layout in a hillside town: asphalt streets, paving, buildings, street lamps and a park.
- A room uses the world of its host. A rider who joins from the other world is moved over.
- `?world=city` in the address picks the world directly.

## Bike Shop

- Every finished run pays its total score as coins.
- **Bike Shop** on the start screen sells six bikes. Each one is better than the last in speed, grip, air and toughness.
- Carbon Beast also needs a gold medal.
- In a race, every rider sees the bikes of the others. The host can tick **Same Bikes** so that all bikes ride like the starter bike.
- The coin balance shows under the score while riding.
- Coins and bikes are stored in the browser, so they belong to one device.
- Prices, stats and looks are in `src/bikes.js`.

## Build

```
npm install
npm run build
```

This bundles `src/main.js` with three.js and inlines the result into `src/index.html`. The output is `docs/index.html`. `npm run watch` rebuilds on every change.

The page loads its textures from `docs/tex`, so it must be served over HTTP. It does not run from a `file://` path.

## Run locally

```
npm install && npm run build
cd server
npm install
npm run dev
```

Open http://127.0.0.1:8787. Multiplayer works between tabs and between machines on the same network.

URL options: `?low` and `?high` force the graphics level, `?touch` shows the touch controls, `?server=wss://host` selects another room server, `?debug` exposes `window.__dr` for inspection.

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`. It builds the page and deploys the Worker. The workflow needs the repository secret `CLOUDFLARE_API_TOKEN`: a Cloudflare API token made from the **Edit Cloudflare Workers** template.

To deploy by hand: `npm run build`, then `cd server && npx wrangler deploy`.

### Single-player on GitHub Pages

In the repository settings, set **Pages** to deploy from the `main` branch, folder `/docs`. The page then runs from `github.io`. Solo play needs no server. Multiplayer from that page connects to the Worker URL above.

## Test

```
npm run sim
npm run map
```

`npm run sim` rides every route with a headless bot on the real physics and prints times, crashes and jumps. Run it after each change to the course or the physics: every route MUST still finish. `npm run map` writes a top-down map of the course to `scripts/out/`.

## How multiplayer works

- Every browser simulates its own rider and sends its state 15 times a second. The other browsers interpolate between the states they receive.
- The course is generated from a fixed seed, so every browser builds the same mountain.
- The Worker (`server/`) serves the page from `docs/` and runs one Durable Object per room under `/room/<id>`. The room assigns ids and start slots, picks the host and relays messages. It keeps no game state.
- The host sends the start signal. Each browser then runs its own countdown and times its own run.

## Files

| Path | Content |
|---|---|
| `src/course.js` | Trail layout, terrain height, wooden features, trees, rocks and city buildings. Pure math, no rendering |
| `src/physics.js` | Bike movement, jumps, landings, crashes |
| `src/score.js` | Trick values, combos, medals |
| `src/world.js` | The visible mountain: ground, forest, wood, water, signs, sky |
| `src/pbr.js` | Shared material and texture loader |
| `docs/tex/` | Ground, rock, bark, plank, street, wall and foliage textures, cut from CC0 scans by [Poly Haven](https://polyhaven.com) |
| `src/bikes.js` | The bikes in the shop: price, stats, look |
| `src/bike.js` | Rider and bike model with trick poses |
| `src/camera.js` | Chase camera |
| `src/input.js` | Keyboard, touch, controller |
| `src/audio.js` | Synthesised sound |
| `src/fx.js` | Particles |
| `src/net.js` | Room connection |
| `src/bot.js` | Autopilot for the menu demo and the test script |
| `src/main.js` | Game loop, race rules, HUD |
| `src/index.html` | Markup and CSS |
| `server/` | The Worker that serves the page and the rooms |
| `scripts/` | Headless test rider and map renderer |

## Edit the course

The layout is the `layout()` function in `src/course.js`. A trail is a chain of commands: `go(metres)`, `arc(degrees, radius)`, `kicker`, `table`, `roller`, `ramp`, `skinny`, `drop`, `rough`, `cp`. Trail height follows the mountain. A trail that crosses a ravine gets a bridge. Run `npm run map` and `npm run sim` after a change.
