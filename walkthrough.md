# 📖 Slay the Spire 2 Workout Mode Helper — Codebase Walkthrough

Welcome to the **Slay the Spire 2 Workout Mode Helper** codebase! This guide is designed to help you quickly navigate the repository, understand how data flows through the system, and locate where every piece of logic lives.

---

## 🧭 Executive Summary

- **Philosophy:** 100% out-of-process and zero-modding. We never modify game binaries, inject DLLs, or edit memory. Steam achievements stay intact.
- **How it works:** Slay the Spire 2 (Godot Engine) flushes JSON save checkpoints to disk on floor transitions, rest sites, and combat endings. Our daemon watches this file, extracts gameplay metrics (turns survived, deaths, HP changes), computes exercise debt using a strict mathematical formula, and streams live state via WebSockets and REST API to a transparent Electron HUD overlay floating over the game.
- **Multiplayer:** Works seamlessly over LAN or public internet via [ngrok](https://ngrok.com). Only the host runs the daemon; guest players only run their overlay and connect to the host's tunnel.

---

## 🗂️ Project Directory Map

```text
sts2_workout_mod/
├── src/
│   ├── daemon/                   # Backend relay & state engine (Node.js + Express + WebSocket)
│   │   ├── index.ts              # Server bootstrapper, REST API routes, WebSocket broadcasts
│   │   ├── watcher.ts            # Chokidar save file observer, 75ms debounce, SHA-256 deduplication
│   │   ├── adapter.ts            # Save file normalizer (translates StS2 Godot saves -> internal schema)
│   │   ├── parser.ts             # Mathematical evaluation engine: wc = n(2+d) + h
│   │   ├── ledger.ts             # Authoritative debt ledger, per-player squat ratios, aggregates
│   │   └── persistence.ts        # Atomic JSON disk persistence (active_session.json, workout_history.json)
│   ├── overlay/                  # Frontend HUD (Electron + React + TypeScript)
│   │   ├── main.ts               # Electron main process (window bounds, transparent, click-through)
│   │   └── renderer.tsx          # React HUD (Panel A resolver, Panel B ledger, modals, host switcher)
│   └── shared/
│       └── types.ts              # Unified TypeScript interfaces, payloads, and WebSocket events
├── test/
│   └── engine.test.ts            # End-to-end engine verification test suite
├── scripts/
│   ├── simulate.ts               # CLI game simulator (test without opening StS2)
│   └── copy-assets.js            # Build script helper for overlay HTML assets
├── architecture.md               # Full technical design & lifecycle specification (v1.3.0)
├── README.md                     # Quickstart, ngrok setup guide, troubleshooting
├── package.json                  # Scripts & npm dependencies
└── .env                          # Local secrets, host overrides, player name mappings (git-ignored)
```

---

## 🔄 End-to-End Data Pipeline

Here is the exact journey of a single room transition in Slay the Spire 2:

```
┌─────────────────────────┐
│   Slay the Spire 2      │ (Godot Engine)
│   Save Checkpoint       │ Writes %APPDATA%\SlayTheSpire2\steam\<ID>\profile1\saves\current_run.save
└────────────┬────────────┘
             │ File change event (detected within ~10ms)
             ▼
┌─────────────────────────┐
│   SaveWatcher           │ [src/daemon/watcher.ts]
│   (Debounce & Dedupe)   │ • 75ms debounce prevents reading partial disk writes
│                         │ • SHA-256 hash comparison ignores idempotent file touches
└────────────┬────────────┘
             │ Raw JSON content
             ▼
┌─────────────────────────┐
│   normalizeSaveData     │ [src/daemon/adapter.ts]
│   (Save File Adapter)   │ • Unifies run_id using start_time (seamless defeat transition)
│                         │ • Chains sequential HP: hp_start comes from previous floor's hp_end
│                         │ • Detects floor 0 relic damage (Precarious Shears) while ignoring Weary Traveler
│                         │ • Identifies lethal combat: stat.current_hp == 0 sets hp_end = 0
└────────────┬────────────┘
             │ RawRunSaveData (Standardized floors array)
             ▼
┌─────────────────────────┐
│   DebtLedger            │ [src/daemon/ledger.ts]
│   (State Orchestrator)  │ • Filters new floors: floor_num > lastProcessedFloor
│                         │ • Passes floor metrics into FloorParser
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   FloorParser           │ [src/daemon/parser.ts]
│   (Math Engine)         │ • Computes wc_p = n_p * (2 + d_p) + h_p
│                         │ • Evaluates per-player squat ratio R_p
│                         │ • Freezes turns at death round if player died mid-combat
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   Disk & Broadcast      │ [src/daemon/persistence.ts & src/daemon/index.ts]
│   1. Persistence        │ • Saves full active state to active_session.json
│                         │ • Appends stage_history snapshot to workout_history.json
│   2. WebSocket Server   │ • Broadcasts WORKOUT_FLOOR_COMMITTED to all connected HUDs
└────────────┬────────────┘
             │ ws://127.0.0.1:8765
             ▼
┌─────────────────────────┐
│   Overlay HUD           │ [src/overlay/renderer.tsx]
│   (React + Electron)    │ • Panel A displays new debt & clearance buttons
│                         │ • Panel B updates cumulative push-ups and squats
│                         │ • Audio / visual cue alerts players during reward screen
└─────────────────────────┘
```

---

## 🧠 Deep-Dive: Core Modules & Key Logic

### 1. The Mathematical Engine ([`src/daemon/parser.ts`](file:///c:/Users/chans/Documents/project/sts2_workout_mod/src/daemon/parser.ts))
Enforces the core exercise debt formula for every floor:
$$wc_p = n_p(2 + d_p) + h_p$$
- **Turns ($n_p$):** 
  - Surviving players take `total_combat_turns`.
  - Non-combat floors (Events, Campfires, Shops) have $n_p = 0$.
  - Fallen players freeze at `stat.death_turn` so surviving allies prolonging the fight don't inflate the dead player's debt.
- **Deaths ($d_p$):** Accumulates across the run; acts as a permanent multiplier penalty.
- **HP Delta ($h_p$):** $\max(\text{HP}_{\text{start}} - \text{HP}_{\text{end}}, 0)$. Net healing results in $0$.

### 2. The Save File Adapter ([`src/daemon/adapter.ts`](file:///c:/Users/chans/Documents/project/sts2_workout_mod/src/daemon/adapter.ts))
This module handles all the quirks of Slay the Spire 2's Godot save structure:
- **Session Continuity (Run ID):** In active play, `current_run.save` has no seed. In defeat, `history/<time>.run` has a seed. The adapter keys `run_id` strictly on `start_time` so the game-over transition never wipes player aggregates or resets Panel B.
- **Weary Traveler vs. Starting Relics:** At Ascension 6+, players spawn wounded. The adapter baselines floor 0 HP to the wounded spawn HP (ignoring the Weary Traveler deficit), but adds `stat.damage_taken` so damaging relics like Precarious Shears ($-16\ \text{HP}$) are charged accurately.
- **Final Battle Lethal Damage:** When a player dies in combat (`current_hp: 0`, `damage_taken > 0`), the adapter forces `hp_end = 0` so the lethal blow's full damage is credited.

### 3. The Debt Ledger & Ratio Controller ([`src/daemon/ledger.ts`](file:///c:/Users/chans/Documents/project/sts2_workout_mod/src/daemon/ledger.ts))
Maintains authoritative state across runs and handles rep reductions:
- **Per-Player Squat Ratios ($R_p$):** Player 1 can use $R_0 = 3$ while Player 2 uses $R_1 = 2$.
- **Fractional Squat Remainder:** When $R > 1$, logging 1 squat stores a remainder of 1. When the remainder reaches $R$, $1\ wc$ is deducted from debt and the remainder resets.
- **Over-Logging Cap:** Prevents players from spamming buttons when debt is already 0.
- **Stage History Recording:** Every floor's completion immediately logs a stage snapshot into `workout_history.json`.

### 4. Persistence Architecture ([`src/daemon/persistence.ts`](file:///c:/Users/chans/Documents/project/sts2_workout_mod/src/daemon/persistence.ts))
- **Atomic File Writes:** Writes JSON to a temporary file (`.tmp`) first, then uses `fs.renameSync` to overwrite the target. This ensures the file is never read in a half-written state if the OS crashes.
- **Two Tiers of Storage:**
  - `active_session.json`: Current active run state (survives daemon restarts).
  - `workout_history.json`: Permanent ledger of all historical runs, including outcome, totals, and per-floor `stage_history`.

### 5. Overlay HUD ([`src/overlay/renderer.tsx`](file:///c:/Users/chans/Documents/project/sts2_workout_mod/src/overlay/renderer.tsx))
Built with React and embedded inside an Electron window:
- **Panel A (Debt Resolver):** Lets players log custom push-ups / squats or click `All Push-ups` / `All Squats`.
- **Panel B (Run Ledger):** Displays cumulative push-ups, squats, remaining debt, and the collapsible stepper for adjusting that player's squat ratio.
- **Click-Through Mode:** Pressing `Ctrl + Shift + X` calls Electron's `setIgnoreMouseEvents` so clicks pass directly into Slay the Spire 2 during gameplay.
- **Remote Host Switcher:** Clicking the top-right IP badge opens a modal to enter the host's ngrok URL or LAN IP.

---

## 🌐 Networking & Roles

| Responsibility | Host PC | Guest PC (Joiner) |
|---|:---:|:---:|
| Owns Slay the Spire 2 Save File | ✅ | ❌ |
| Runs Node.js Daemon (`npm run start:daemon`) | ✅ | ❌ |
| Runs ngrok Tunnel (`npx ngrok http 8765 ...`) | ✅ | ❌ |
| Runs Electron Overlay (`npm run start:overlay`) | ✅ | ✅ |

Joiners simply launch their overlay and enter the host's `https://<subdomain>.ngrok-free.app` URL.

---

## 🛠️ Common Workflows

### 1. Running Tests
```bash
npm test
```
Runs `test/engine.test.ts` with ts-node, verifying:
- Turn freezing on player death
- Mathematical equation accuracy
- Fractional squat remainders
- 24-hour defeat jog countdown
- Floor 0 starting relic damage isolation
- Native save parsing & stage history persistence

### 2. Building for Production
```bash
npm run build
```
Compiles TypeScript into `dist/` and copies HTML assets into place.

### 3. Testing with Offline Save Simulation
You don't need Slay the Spire 2 running to test changes:
```bash
npm run simulate -- --step 1    # Floor 1 combat
npm run simulate -- --step 3    # Mid-combat player death
npm run simulate -- --step 5    # Run defeat (triggers 24h jog countdown)
```

---

## 📌 Rules & Code Guidelines for Future Edits
1. **Never Commit Secrets or Steam IDs:** `.env` is git-ignored. Keep all personal Steam IDs strictly in `.env`.
2. **Keep Ratios Independent:** Always look up ratios per player (`getPlayerRatio(playerIndex)`).
3. **Preserve Atomic Writes:** Any new file persistence must use `PersistenceManager.atomicWrite`.
4. **Run `npm test` and `npm run build` Before Committing:** Ensure all test suites pass cleanly.
