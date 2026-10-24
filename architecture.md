# Slay the Spire 2: Workout Mode Overlay (v1.3.0 Architecture Specification)

## 1. System & Game Lifecycle Overview

The **StS2 Workout Mode Helper** is an out-of-process, zero-mod companion daemon and HUD running on the Host PC and guest player PCs. It automatically monitors Slay the Spire 2's native save checkpoints, derives per-player workout debt after every floor, provides an interactive transparent HUD for logging exercise reps, synchronizes multiplayer party sessions across local networks or public tunnels (e.g., ngrok), and manages the full game lifecycle (opt-in modals, dynamic ratio adjustments, victory summaries, and defeat accountability timers).

```
                  [ STS2 Process Boots / New Run Initialized ]
                                       │
                                       ▼
                  ┌──────────────────────────────────────────┐
                  │    RUN START MODAL (Interactive HUD)     │
                  │  • "Enable Workout Mode for this session?"│
                  │  • Configure Squat Ratio (Default: R=2)  │
                  │  • Arms Authoritative Debt Ledger        │
                  └────────────────────┬─────────────────────┘
                                       │ Confirmed
                                       ▼
                  ┌──────────────────────────────────────────┐
                  │             ACTIVE RUN LOOP              │
                  │  For each committed floor:               │
                  │  • Ingest sequential floor metrics       │
                  │  • Calculate wc per player: n(2+d) + h   │
                  │  • Append stage snapshot to history      │
                  │  • Update Remainder Resolver (Panel A)   │
                  │  • Accept Rep Reductions (Freeform/Bulk) │
                  │  • Update Cumulative Ledger (Panel B)    │
                  └────────────────────┬─────────────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    ▼                                     ▼
         [ Victory Banner ]                       [ Party Defeat / Abandon ]
                    │                                     │
                    ▼                                     ▼
   ┌────────────────────────────────┐    ┌─────────────────────────────────┐
   │      VICTORY RECAP SCREEN      │    │       DEFEAT PENALTY SCREEN     │
   │ • "Victory Achieved!"          │    │ • "Defeat - 30-Min Jog Penalty" │
   │ • Full Session Exercise Totals │    │ • 24-Hour Countdown Timer       │
   │ • Party Member Leaderboard     │    │ • Outstanding Debt Breakdown    │
   │ • Preserves stats in history   │    │ • Preserves stats in history    │
   └────────────────────────────────┘    └─────────────────────────────────┘
```

---

## 2. Mathematical Model & Attribution Engine

### 2.1 Per-Player Attribution
All workout counters, HP deltas, turn survivals, death penalties, and squat conversion ratios are tracked **per individual player**. Party members do not share a pooled debt or synced ratio; each player bears individual accountability for their own combat performance and customized exercise parameters.

Implementation reference: [`src/daemon/parser.ts`](./src/daemon/parser.ts#L15-L80).

### 2.2 Floor Calculation Equation
At the conclusion of each floor $f$, each player $p$ accrues a workout counter value ($wc_p$):

$$wc_p = n_p(2 + d_p) + h_p$$

Where:
* **$n_p$ (Combat Turns Taken):**
  * **Survival:** Total combat turns elapsed if the player survived the encounter (`total_combat_turns`).
  * **Mid-Combat Death (Turn Freezing):** If player $p$ dies during combat, $n_p$ freezes at the round of death (`stat.death_turn`, `stat.turn_died`, `stat.turn_of_death`, or `stat.turns_survived`). If unrecorded by the save checkpoint, it safely falls back to `total_combat_turns`. Subsequent turns taken by surviving allies do not penalize the fallen player.
  * **Non-Combat Nodes:** For Events, Campfires, and Shops, $n_p = 0$.
* **$d_p$ (Cumulative Deaths):** Cumulative deaths suffered by player $p$ up to that floor. Increments by $+1$ upon lethal damage and acts as a multiplier penalty for all subsequent floors.
* **$h_p$ (Net Positive HP Lost):**
  $$h_p = \max(\text{HP}_{p, \text{start}} - \text{HP}_{p, \text{end}}, 0)$$
  *Healing, relic procs, or net HP increases yield $h_p = 0$.*
* **Game Defeat Combat Waiver:** On full game defeat (`run_status === 'DEFEAT'`), the final losing combat floor where the party wipes has its workout counters waived ($wc_p = 0$). Players are not penalized with push-up/squat debt for the battle that ended the run; prior floors' debt is preserved and the 30-minute jog penalty applies.

### 2.3 Sequential Floor HP Tracking & Floor 0 Rules
To accurately calculate $h_p$ across floors with post-combat healing relics, the adapter chains floor entries sequentially:
* **Floor 0 / Ancient Node (Starting Floor):**
  * **Weary Traveler Penalty:** Ignored. The starting HP baseline ($\text{HP}_{\text{start}}$) uses the wounded spawn HP rather than full max HP, ensuring the inherent Ascension modifier does not penalize players before playing.
  * **Starting Relic Damage:** Captured. Relic damage taken on floor 0 (e.g. Precarious Shears dealing 16 self-damage) is added to `stat.damage_taken`, correctly accruing $16\ wc$ without charging the Weary Traveler deficit.
* **Subsequent Floors:** Floor entry HP ($\text{HP}_{\text{start}}$) is derived from the preceding floor's exit HP ($\text{HP}_{\text{end}}$), guaranteeing that heal events and combat damage are accurately isolated.
* **Final Combat in Defeat:** On full game defeat, although the lethal battle registers $\text{HP}_{\text{end}} = 0$ for analytical and stage history accuracy, the workout counters ($wc_p$) for this wipe battle are waived ($0\ wc$), avoiding double-penalizing the party with both exercise counters and the 30-minute defeat jog penalty.

Implementation reference: [`src/daemon/adapter.ts`](./src/daemon/adapter.ts#L145-L185).

### 2.4 Per-Player Squat Ratio & Fractional Remainder ($R_p \ge 1$)
Each player configures their own independent conversion ratio $R_p$:
$$\text{Remaining Debt}_p = \sum wc_{p, \text{accrued}} - \left( \text{Push-ups}_p + \left\lfloor \frac{\text{Squats}_p}{R_p} \right\rfloor \right)$$

Logging custom squats that do not evenly divide by $R_p$ stores the fractional remainder in `player_squat_remainders[p]`:
$$\text{Remainder}_{p, \text{new}} = (\text{Remainder}_{p, \text{old}} + \text{Squats}) \bmod R_p$$
$$\text{Debt Deducted}_p = \min\left( \left\lfloor \frac{\text{Remainder}_{p, \text{old}} + \text{Squats}}{R_p} \right\rfloor, \text{Debt}_p \right)$$

Implementation reference: [`src/daemon/ledger.ts`](./src/daemon/ledger.ts#L125-L195).

### 2.5 Capped Custom Rep Logging
To prevent accidental over-logging from artificially inflating completed rep counts:
* **Push-ups:** $\text{Push-ups Added} = \min(\text{Reps Input}, \text{Current Debt})$.
* **Squats:** $\text{Squats Added} = \min(\text{Reps Input}, \max(\text{Current Debt} \times R_p - \text{Remainder}_p, 0))$.
Logging reps when active debt is 0 will not credit surplus push-ups or squats.

---

## 3. Host & Client System Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              HOST PC ENVIRONMENT                             │
│                                                                              │
│  ┌────────────────────────┐                                                  │
│  │  Slay the Spire 2      │ (Godot 4.5+ Engine Process)                      │
│  │  (Authoritative Host)  │                                                  │
│  └───────────┬────────────┘                                                  │
│              │ Writes save checkpoints on floor exit / rewards / death       │
│              ▼                                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Host File System Storage                                               │  │
│  │ %APPDATA%\SlayTheSpire2\steam\<YOUR_STEAM_ID_HERE>\profile1\saves\                │  │
│  │ Targets: current_run_mp.save (Multiplayer) or current_run.save (Solo) │  │
│  └───────────┬────────────────────────────────────────────────────────────┘  │
│              │ OS Event: ReadDirectoryChangesW (Depth: 1, ignoreInitial: true)│
│              ▼                                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ WORKOUT RELAY DAEMON (src/daemon/index.ts)                             │  │
│  │                                                                        │  │
│  │   ┌────────────────────────────────┐                                   │  │
│  │   │ 1. Save Watcher (watcher.ts)   │ ◄── 75ms debounce, atomic lock    │  │
│  │   │    Targeted Startup Scan       │     retry, selects newest mtime   │  │
│  │   └───────────────┬────────────────┘                                   │  │
│  │                   ▼                                                    │  │
│  │   ┌────────────────────────────────┐                                   │  │
│  │   │ 2. Save Adapter (adapter.ts)   │ ◄── Godot normalization, env-based│  │
│  │   │    Metric Extractor            │     name resolution               │  │
│  │   └───────────────┬────────────────┘                                   │  │
│  │                   ▼                                                    │  │
│  │   ┌────────────────────────────────┐                                   │  │
│  │   │ 3. Debt Ledger (ledger.ts)     │ ◄── Multi-run session store,      │  │
│  │   │    Attribution Engine          │     remainder tracking, rep cap   │  │
│  │   └───────────────┬────────────────┘                                   │  │
│  │                   ▼                                                    │  │
│  │   ┌────────────────────────────────┐                                   │  │
│  │   │ 4. Broadcast Hub (index.ts)    │ ◄── HOST=0.0.0.0:8765             │  │
│  │   │    (WebSocket & REST Engine)   │     Accepts LAN & ngrok tunnels   │  │
│  │   └───────────────┬────────────────┘                                   │  │
│  └───────────────────┼────────────────────────────────────────────────────┘  │
│                      │                                                       │
│                      ├──────────────────────────┐                            │
│                      ▼ (Local ws://127.0.0.1)   ▼ (Remote wss://ngrok-tunnel)│
│  ┌─────────────────────────────────────┐  ┌───────────────────────────────┐  │
│  │ HOST OVERLAY HUD                    │  │ GUEST OVERLAY HUD (GuestPlayer)  │  │
│  │ (Electron / src/overlay/main.ts)    │  │ (Electron / Client PC)        │  │
│  │ • Panel A: Remainder Resolver       │  │ • Panel A: Remainder Resolver │  │
│  │ • Panel B: Run Ledger               │  │ • Panel B: Run Ledger         │  │
│  │ • Direct Window Z-Order Watchdog    │  │ • Dynamic Host IP/Tunnel Modal│  │
│  └─────────────────────────────────────┘  └───────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Subsystem Specifications & Code References

### 4.1 Save Watcher & Active File Priority
* **File Observer (`src/daemon/watcher.ts`):** Listens to `%APPDATA%\SlayTheSpire2\steam\<YOUR_STEAM_ID_HERE>\profile1\saves\`.
* **Startup Active File Priority:** Configured with `depth: 1` and `ignoreInitial: true` to prevent historical completed runs in `history/*.run` from triggering false defeat states.
* **Targeted Initial Scan:** On startup, `scanInitialActiveSave()` inspects both `current_run_mp.save` and `current_run.save`, selecting the active run with the newest modification timestamp (`mtimeMs`).
* **Run Termination Trigger:** When `current_run_mp.save` is deleted upon victory or death (`unlink`), the watcher queries `history/` after a 300ms delay to extract final run outcome data.

Implementation reference: [`src/daemon/watcher.ts`](./src/daemon/watcher.ts#L20-L95).

### 4.2 Native Godot Save Normalization
* **Format Ingestion (`src/daemon/adapter.ts`):** Ingests Godot 4.5+ dictionary format from StS2 saves, extracting seed, start time, game mode, player character IDs, and `map_point_history`.
* **Room Type Normalization:** Maps native room strings (`weak_monster`, `normal`, `elite`, `boss`, `rest_site`, `merchant`) to canonical types (`monster`, `elite`, `boss`, `campfire`, `shop`, `event`).
* **Player Name Resolution:** Evaluates player display names from environment variables (`PLAYER_ID_<SteamID>`, `PLAYER_NAME_<idx>`), save file names, or generic fallbacks (`Player 1`, `Player 2`). Personal Steam IDs are omitted from code and git commits.

Implementation reference: [`src/daemon/adapter.ts`](./src/daemon/adapter.ts#L1-L100).

### 4.3 Multi-Run Session Persistence & History Ledger
* **Active Sessions Store (`src/daemon/persistence.ts`):** `ActiveSessionsMapStore` saves active runs by `run_id` in `active_session.json`. Players can switch between Single-Player (`current_run.save`) and Multiplayer (`current_run_mp.save`) without losing accumulated debt, reps, or remainders.
* **Preservation on Termination:** When a run finishes (`VICTORY` or `DEFEAT`), the ledger maintains completed session stats in memory and appends a permanent record with per-player `party_summary` breakdowns to `workout_history.json`.

Implementation reference: [`src/daemon/persistence.ts`](./src/daemon/persistence.ts#L20-L90) and [`src/daemon/ledger.ts`](./src/daemon/ledger.ts#L270-L315).

### 4.4 Multiplayer Relay & Remote Tunneling
* **Daemon Binding (`src/daemon/index.ts`):** Binds to `0.0.0.0:8765`, enabling remote connections across local Wi-Fi, Tailscale VPNs, or public ngrok tunnels.
* **In-Overlay Host IP & Tunnel Switcher (`src/overlay/renderer.tsx`):**
  * Displays a live status badge (`🌐 <host>` or `⚠️ Offline`) in the HUD header.
  * Clicking the badge opens the Host Configuration Modal to enter host IPs (e.g., `10.0.0.238`) or ngrok URLs (e.g., `abc123xyz.ngrok-free.app`).
  * Persists custom host addresses in `localStorage` across restarts.
* **Protocol & Tunnel Normalization:** Automatically routes `http/ws` for IP addresses and `https/wss` for ngrok/tunnel domains.
* **Chromium SSL & Ngrok Warning Bypass:**
  * In [`src/overlay/main.ts`](./src/overlay/main.ts#L10-L20), `app.commandLine.appendSwitch('ignore-certificate-errors')` and `certificate-error` bypass handlers prevent Chromium `net_error -100` SSL handshake aborts.
  * In [`src/overlay/renderer.tsx`](./src/overlay/renderer.tsx#L70-L80), all REST requests include `'ngrok-skip-browser-warning': 'true'` headers to bypass free-tier ngrok landing pages.

### 4.5 Dual Window Management & DWM Pinning
* **Dual Independent Windows (`src/overlay/main.ts`):**
  * **Panel A (Window A):** Debt Resolver (`?panel=a`, width: 380, height: 320).
  * **Panel B (Window B):** Run Ledger (`?panel=b`, width: 380, height: 220).
* **Z-Order Protection:** Configured with `setAlwaysOnTop(true, 'screen-saver', 1)` and a 2.5s watchdog timer to prevent Windows Desktop Window Manager (DWM) or DirectX fullscreen games from demoting HUD visibility.
* **Taskbar & Alt+Tab Optimization:** `skipTaskbar: true` and single-instance locks prevent taskbar crowding and duplicate processes.
* **Global Hotkeys:**
  * `Ctrl+Shift+X`: Toggles mouse click-through mode for all overlay panels.
  * `Ctrl+Shift+Z`: Forces overlay windows to frontmost z-order position.

Implementation reference: [`src/overlay/main.ts`](./src/overlay/main.ts#L30-L115).

---

## 5. Overlay UI/UX Components

### 5.1 Panel A: Remainder Resolver (Debt Management)
* **Active Player Selector:** Dropdown displaying player names (`HostPlayer (Host)`, `GuestPlayer`).
* **Remaining Workout Count:** Displays unresolved debt ($wc$) with dynamic color feedback (green when 0, red when > 0).
* **Custom Reps Input:** Input box with `Log Push-ups` and `Log Squats` action buttons.
* **Bulk Clearance Buttons:**
  * `All Push-ups (wc)`: Clears entire debt with push-ups.
  * `All Squats (wc * R)`: Clears entire debt with squats according to ratio $R$.

### 5.2 Panel B: Aggregate Ledger (Run Totals)
* **Stat Grid:** Displays total push-ups completed, total squats completed, and remaining unpaid counters.
* **Collapsible Squat Ratio Controller:** Arrow toggle (`▼ Squat Ratio` / `▶ Squat Ratio (R = 2)`) with stepper buttons (`-` / `+`) to adjust ratio $R$ during gameplay.

### 5.3 Modals
1. **Run Start Modal:** Triggered upon run initialization to confirm Workout Mode opt-in and starting squat ratio.
2. **Run Outcome Modal:**
   * **Victory Screen:** Renders final party summary table with each player's debt, push-ups, squats, and deaths.
   * **Defeat Screen:** Triggers the mandatory 30-minute jog penalty with a ticking 24-hour countdown timer (`23:59:59`) and complete party summary table.
3. **Daemon Host Configuration Modal:** Allows remote guests to configure host IP addresses or ngrok tunnel endpoints directly from the HUD.

Implementation reference: [`src/overlay/renderer.tsx`](./src/overlay/renderer.tsx#L160-L460).

---

## 6. API Data Contracts & Events

### 6.1 WebSocket Messages (`ws://<host>:8765`)

#### `RUN_DETECTED` (Run Initialized)
```json
{
  "type": "RUN_DETECTED",
  "timestamp": 1791595114000,
  "data": {
    "run_id": "run_1791595114_2KX7FETFPW50",
    "is_multiplayer": true,
    "player_count": 2,
    "players": [
      { "index": 0, "name": "HostPlayer", "character": "REGENT" },
      { "index": 1, "name": "GuestPlayer", "character": "IRONCLAD" }
    ],
    "default_squat_ratio": 2
  }
}
```

#### `WORKOUT_FLOOR_COMMITTED` (Floor Resolved)
```json
{
  "type": "WORKOUT_FLOOR_COMMITTED",
  "timestamp": 1791595200000,
  "data": {
    "floor": 2,
    "room_type": "monster",
    "players": [
      {
        "player_index": 0,
        "player_name": "HostPlayer",
        "evaluation": {
          "turns_taken_n": 4,
          "player_died": false,
          "deaths_accumulated_d": 0,
          "hp_lost_h": 9,
          "formula": "4 * (2 + 0) + 9 = 17",
          "counters_added": 17
        },
        "debt_state": {
          "unresolved_counters": 17,
          "squat_ratio": 2
        },
        "aggregates": {
          "total_counters_accrued": 17,
          "completed_pushups": 0,
          "completed_squats": 0
        }
      }
    ]
  }
}
```

#### `RUN_TERMINATED` (Victory or Defeat)
```json
{
  "type": "RUN_TERMINATED",
  "timestamp": 1791597400000,
  "data": {
    "outcome": "DEFEAT",
    "floor_reached": 12,
    "jog_penalty_required": true,
    "jog_deadline_timestamp": 1791683800000,
    "party_summary": [
      {
        "player_index": 0,
        "player_name": "HostPlayer",
        "final_unresolved_debt": 22,
        "total_pushups": 15,
        "total_squats": 30,
        "deaths": 0
      },
      {
        "player_index": 1,
        "player_name": "GuestPlayer",
        "final_unresolved_debt": 8,
        "total_pushups": 10,
        "total_squats": 20,
        "deaths": 1
      }
    ]
  }
}
```

### 6.2 REST Endpoints (`http://<host>:8765`)

| Endpoint | Method | Payload / Response | Description |
|---|---|---|---|
| `/api/v1/session/state` | `GET` | Returns `ActiveSessionStore` | Fetches snapshot of active run debts, aggregates, and player names. |
| `/api/v1/session/start` | `POST` | `{ "opt_in": true, "squat_ratio": 2 }` | Confirms session opt-in and starting ratio. |
| `/api/v1/workout/resolve` | `POST` | `{ "player_index": 0, "action_type": "CUSTOM_ENTRY", "exercise": "pushups", "reps": 10 }` | Submits rep deductions. |
| `/api/v1/config/ratio` | `POST` | `{ "player_index": 0, "squat_ratio": 3 }` | Dynamically updates squat ratio $R_p$ for a specific player (or globally if omitted). |

---

## 7. Technical Glossary

| Term | Category | Definition |
|---|---|---|
| **Atomic Write** | System Programming | An OS-level file write where data is written to a `.tmp` file and renamed atomically over the target, preventing corrupt reads. |
| **Click-Through Mode** | Overlay Engine | Electron window state where `ignoreMouseEvents(true, { forward: true })` passes mouse clicks directly through to the game. Toggled via `Ctrl+Shift+X`. |
| **Fractional Remainder** | Workout Engine | Sub-integer squat progress preserved when $R > 1$ and logged squats do not divide evenly by $R$. |
| **Ngrok Tunneling** | Networking | Secure public tunnel (`https://...ngrok-free.app`) exposing host daemon port `8765` to remote guests over the internet. |
| **Screen-Saver Z-Order** | Window Management | Electron window level `screen-saver` ensuring overlay HUD remains visible above fullscreen game viewports. |
| **Turn Freezing ($n_p$)** | Workout Attribution | Halting combat turn counting for a fallen player at their exact round of death, preventing teammates' subsequent turns from penalizing them. |
| **Workout Counter ($wc_p$)** | Workout Engine | Normalized exercise unit defined by $wc_p = n_p(2 + d_p) + h_p$. |
