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
│   │   ├── watcher.ts            # Chokidar save file observer, 75ms debounce, SHA-256 dedupe, .env live reloader
│   │   ├── adapter.ts            # Save file normalizer (translates StS2 Godot saves -> internal schema)
│   │   ├── logReader.ts          # Reverse chunk reader for godot.log (turn actions & death handling events)
│   │   ├── parser.ts             # Mathematical evaluation engine: wc = n(2+d) + h
│   │   ├── ledger.ts             # Authoritative debt ledger, pending floor manager, per-player squat ratios
│   │   └── persistence.ts        # Atomic JSON disk persistence (active_session.json, workout_history.json)
│   ├── overlay/                  # Frontend HUD (Electron + React + TypeScript)
│   │   ├── main.ts               # Electron main process (window bounds, transparent, click-through)
│   │   └── renderer.tsx          # React HUD (Panel A resolver & commit banner, Panel B ledger, modals)
│   └── shared/
│       └── types.ts              # Unified TypeScript interfaces, payloads, and WebSocket events
├── test/
│   ├── engine.test.ts            # Core end-to-end engine verification test suite
│   ├── autoCommit.test.ts        # Reward screen exit & automatic floor commit verification
│   ├── deathDetection.test.ts    # Sole godot.log death parsing & revive non-counting verification
│   ├── gameLifecycle.test.ts     # New run detection, SP/MP switching, and termination verification
│   ├── logReader.test.ts         # Reverse buffer log parsing and turn/death extraction verification
│   ├── rewardStage.test.ts       # Pending reward stage healing offsets and early commit lock-in verification
│   └── roomTracking.test.ts      # Visited map coordinate and current floor calculation verification
├── docs/
│   ├── architecture.md           # Full technical design & lifecycle specification (v1.3.0)
│   ├── daemon_component_flow.md  # Detailed component-by-component data flow and sequence diagrams
│   ├── implementation_plan.md    # Initial engineering roadmap and milestone tracking
│   ├── slay_the_spire_facts.md   # Verified StS2 engine mechanics, save conventions, and log signatures
│   └── walkthrough.md            # Codebase tour, architecture summary, and developer workflows
├── scripts/
│   ├── simulate.ts               # CLI game simulator (test without opening StS2)
│   └── copy-assets.js            # Build script helper for overlay HTML assets
├── README.md                     # User-facing guide, role-based quickstarts, FAQ
├── package.json                  # Scripts & npm dependencies
└── .env                          # Local secrets, host overrides, player name mappings (git-ignored)
```

---

## 🔄 End-to-End Data Pipeline

Here is the exact journey of a single room transition in Slay the Spire 2:

```
┌─────────────────────────┐          ┌─────────────────────────┐
│   Slay the Spire 2      │          │   godot.log             │
│   Save Checkpoint       │          │   %APPDATA%/.../logs/   │
│   current_run.save      │          │   Engine events         │
└────────────┬────────────┘          └────────────┬────────────┘
             │ File change event                  │ Tail reverse read (2MB chunk)
             ▼                                    ▼
┌─────────────────────────┐          ┌─────────────────────────┐
│   SaveWatcher           │          │   LogReader             │
│   (Debounce & Dedupe)   │          │   (Turn & Death Parser) │
│   • 75ms debounce       │          │   • EndPlayerTurnAction │
│   • SHA-256 dedupe      │          │   • Player X died...    │
└────────────┬────────────┘          └────────────┬────────────┘
             │ Raw JSON content                   │ CombatDeathInfo
             ▼                                    ▼
┌──────────────────────────────────────────────────────────────┐
│   normalizeSaveData [src/daemon/adapter.ts]                  │
│   • Unifies run_id using start_time                          │
│   • Chains sequential HP: hp_start = prev floor hp_end       │
│   • Detects floor 0 relic damage (Weary Traveler excluded)   │
│   • Pure godot.log death attribution (revives ignored)       │
└──────────────────────────────┬───────────────────────────────┘
                               │ RawRunSaveData (Standardized floors array)
                               ▼
┌──────────────────────────────────────────────────────────────┐
│   DebtLedger [src/daemon/ledger.ts]                          │
│   • Filters new floors: floor_num > lastProcessedFloor       │
│   • In Reward Stage: holds floor in pendingPlayerFloors      │
│   • On early commit or floor transition: commits to parser   │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│   FloorParser [src/daemon/parser.ts]                         │
│   • Computes wc_p = n_p * (2 + d_p) + h_p                    │
│   • Evaluates per-player squat ratio R_p                     │
│   • Freezes turns at death round if player died mid-combat   │
│   • Death penalty applies to subsequent floors (d_p)         │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│   Disk & Broadcast [persistence.ts & index.ts]               │
│   1. Persistence: atomic write active_session.json & history │
│   2. WebSocket: broadcasts WORKOUT_FLOOR_COMMITTED & STATE   │
└──────────────────────────────┬───────────────────────────────┘
                               │ ws://127.0.0.1:8765
                               ▼
┌──────────────────────────────────────────────────────────────┐
│   Overlay HUD [src/overlay/renderer.tsx]                     │
│   • Panel A: "Commit Floor Now" banner, rep clearers         │
│   • Panel B: updates cumulative push-ups, squats, ratio      │
└──────────────────────────────────────────────────────────────┘
```

---

## 🧠 Deep-Dive: Core Modules & Key Logic

### 1. The Mathematical Engine ([`src/daemon/parser.ts`](../src/daemon/parser.ts))
Enforces the core exercise debt formula for every floor:
$$wc_p = n_p(2 + d_p) + h_p$$
- **Turns ($n_p$):** 
  - Surviving players take `total_combat_turns`.
  - Non-combat floors (Events, Campfires, Shops) have $n_p = 0$.
  - Fallen players freeze at their logged death round (`death_turn`) so surviving allies prolonging combat do not inflate the fallen player's debt.
- **Deaths ($d_p$):** Cumulative deaths suffered prior to the current encounter. The death suffered during floor $N$ increments the counter for subsequent floors ($N+1$ onward), without penalizing floor $N$ itself.
- **HP Delta ($h_p$):** $\max(\text{HP}_{\text{start}} - \text{HP}_{\text{end}}, 0)$. Net healing results in $0$.
- **Defeat Combat Waiver:** On full game defeat (`run_status === 'DEFEAT'`), the final battle where the party wiped has its workout counters waived ($wc_p = 0$). Players are not penalized with rep debt for the losing fight; prior floors' debts are preserved and the mandatory 30-minute jog penalty applies.
- **Victory Full Accrual:** On game victory (`run_status === 'VICTORY'`), the final boss fight accrues full workout debt ($wc_p$) automatically.

### 2. The Combat Log Reader ([`src/daemon/logReader.ts`](../src/daemon/logReader.ts))
Extracts ground-truth combat events directly from the Godot engine log:
- **Reverse Chunk Buffering:** Scans the tail of `godot.log` in 64KB reverse chunks (up to 2MB) to isolate the active combat block.
- **Turn Action Tracking:** Parses `EndPlayerTurnAction` and `NetEndPlayerTurnAction` to track each player's latest active round.
- **Pure Death Detection:** Identifies `Player (\d+) died, doing death handling`. Mid-combat revives from Fairy in a Bottle and Lizard Tail do not log this signature and are therefore never counted as deaths.

### 3. The Save File Adapter ([`src/daemon/adapter.ts`](../src/daemon/adapter.ts))
Handles the nuances of Slay the Spire 2's Godot save structure:
- **Session Continuity (Run ID):** Keys `run_id` on `start_time` so transitions to game history never wipe player aggregates or reset Panel B.
- **Weary Traveler vs. Starting Relics:** Baselines floor 0 HP to wounded spawn HP (Ascension 6+), but incorporates `stat.damage_taken` so damaging relics like Precarious Shears ($-16\ \text{HP}$) are accurately charged.
- **Player Name Resolution:** Resolves display names via the single standard key schema `PLAYER_NAME_<ID>` (e.g. `PLAYER_NAME_<SteamID>` or `PLAYER_NAME_0`), automatically extracting the local Steam ID from `STS2_SAVE_DIR` for player 0.

### 4. The Debt Ledger & Ratio Controller ([`src/daemon/ledger.ts`](../src/daemon/ledger.ts))
Authoritative state manager across runs and rep reductions:
- **Reward Stage Lifecycle:** Holds pending combat encounters in `pendingPlayerFloors` during reward screens. Uncommitted players receive dynamic debt reductions from reward healing; players can click **Commit Floor Now** in Panel A to lock in reps early.
- **Per-Player Squat Ratios ($R_p$):** Each player independently sets their conversion ratio ($R_0 = 3$, $R_1 = 2$, etc.).
- **Fractional Squat Remainder:** Sub-integer squat progress is preserved in `playerSquatRemainders` and redeemed once accumulated to $R$.
- **Over-Logging Cap:** Prevents players from spamming rep buttons when debt is already 0.
- **Stage History Recording:** Every committed floor logs a snapshot into `workout_history.json`.

### 5. Persistence Architecture ([`src/daemon/persistence.ts`](../src/daemon/persistence.ts))
- **Atomic File Writes:** Writes JSON to `.tmp` files first, then uses `fs.renameSync` to overwrite the target, ensuring zero corruption during abrupt process terminations.
- **Two Storage Tiers:**
  - `active_session.json`: Restores active run state across daemon restarts.
  - `workout_history.json`: Permanent ledger of all historical runs, party summaries, and floor snapshots.

### 6. Overlay HUD ([`src/overlay/renderer.tsx`](../src/overlay/renderer.tsx))
Built with React and embedded inside Electron:
- **Panel A (Debt Resolver):** Displays unresolved debt, rep stepper inputs (`−` / `+`), `Log Push-ups`, `Log Squats`, bulk clearers (`All Push-ups`, `All Squats`), and the reward screen **Commit Floor Now** banner.
- **Panel B (Run Ledger):** Displays cumulative push-ups, squats, remaining debt, and the collapsible stepper for adjusting that player's squat ratio.
- **Click-Through Mode:** Pressing `Ctrl + Shift + X` passes mouse clicks directly through to Slay the Spire 2 during combat.
- **Remote Host Switcher:** Clicking the top-right IP badge opens a modal to configure host IP addresses or ngrok tunnel endpoints.

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
Run the comprehensive test suite to verify all engine subsystems:
```bash
# Run all tests
npm test

# Run individual test suites
npx ts-node test/autoCommit.test.ts
npx ts-node test/deathDetection.test.ts
npx ts-node test/gameLifecycle.test.ts
npx ts-node test/rewardStage.test.ts
npx ts-node test/roomTracking.test.ts
npx ts-node test/logReader.test.ts
```

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
