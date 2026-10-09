```markdown
# Slay the Spire 2: Workout Mode Overlay (v1.1.0 Specification)
## Architecture, Data Flow, and Overlay Specification

## 1. System & Game Lifecycle Overview

The **StS2 Workout Mode Helper** is an out-of-process, zero-mod companion daemon and HUD running on the Host PC. It automatically monitors the game's file system outputs, derives per-player workout debt after every floor, provides an interactive UI for logging exercise reps, and manages session lifecycle events (run opt-in, parameter configuration, victory recaps, and defeat penalties).


```

```
                  [ STS2 Process Boots / New Run Initialized ]
                                       │
                                       ▼
                  ┌──────────────────────────────────────────┐
                  │    RUN START MODAL (Interactive HUD)     │
                  │  • "Enable Workout Mode for this run?"   │
                  │  • Configure Squat Ratio (Default: 2)    │
                  │  • Future Run Modifiers Hook             │
                  └────────────────────┬─────────────────────┘
                                       │ Confirmed
                                       ▼
                  ┌──────────────────────────────────────────┐
                  │             ACTIVE RUN LOOP              │
                  │  For each floor commit:                  │
                  │  • Calculate wc per player               │
                  │  • Update Pending Debt Panel             │
                  │  • Accept Rep Reductions (Freeform/Bulk) │
                  │  • Update Cumulative Aggregate Ledger    │
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
   │ • Per-Player Performance Stats │    │ • Outstanding Debt Breakdown    │
   │   (Solo or Party Leaderboard)  │    │ • Full Session Exercise Totals  │
   └────────────────────────────────┘    └─────────────────────────────────┘

```



---

## 2. Mathematical Model & Attribution Engine

### 2.1 Per-Player Attribution
All workout counters, HP losses, turn survivals, and death penalties are tracked **per individual player**. Party totals are never pooled into a collective debt; each player bears responsibility for their own combat performance and choices.

### 2.2 Floor Calculation Equation
At the conclusion of each floor $f$, each player $p$ accrues a workout counter value ($wc_p$):

$$wc_p = n_p(2 + d_p) + h_p$$

Where:
* $n_p$: Number of combat turns taken by player $p$.
  * **Survival:** Total combat turns elapsed if the player survived the encounter.
  * **Mid-Combat Death:** If player $p$ dies during combat, $n_p$ **freezes** at the exact turn the player died. Subsequent turns taken by surviving allies do not increase $n_p$ for the fallen player.
  * **Non-Combat Nodes:** For Events, Campfires, and Shops, $n_p = 0$.
* $d_p$: Cumulative deaths suffered by player $p$ across the current run up to that point.
* $h_p$: Net positive HP lost by player $p$ on that floor:
  $$h_p = \max(\text{HP}_{p, \text{start}} - \text{HP}_{p, \text{end}}, 0)$$
  *(Healing or net HP increases yield $h_p = 0$).*

### 2.3 Squat Ratio & Debt Invariants
* **Squat Ratio ($R$):** An integer value representing how many squats equal 1 workout counter.
  * Defaults to $R = 2$.
  * Can be increased or decreased (as an integer: 1, 2, 3, 4...) dynamically at any point during the run via the overlay HUD.
* **Rep Conversions:**
  * $1\ \text{Push-up} = 1\ wc$
  * $R\ \text{Squats} = 1\ wc$
* **Remaining Debt Formula:**
  $$\text{Debt}_p = \sum wc_{p, \text{accrued}} - \left( \text{Push-ups Completed}_p + \left\lfloor \frac{\text{Squats Completed}_p}{R} \right\rfloor \right)$$

---

## 3. Host PC System Architecture

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
│  │ %APPDATA%\SlayTheSpire2\steam<SteamID>\profile1\saves\                │  │
│  │ Target: current_run_mp.save (or current_run.save)                      │  │
│  └───────────┬────────────────────────────────────────────────────────────┘  │
│              │ OS Event: ReadDirectoryChangesW                               │
│              ▼                                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ WORKOUT RELAY DAEMON (Out-of-Process Background Worker)                │  │
│  │                                                                        │  │
│  │   ┌────────────────────────────────┐                                   │  │
│  │   │ 1. File Observer & Debouncer   │ ◄── 75ms debounce, atomic lock    │  │
│  │   └───────────────┬────────────────┘     retry loop                    │  │
│  │                   ▼                                                    │  │
│  │   ┌────────────────────────────────┐                                   │  │
│  │   │ 2. Canonical Metrics Extractor │ ◄── Ingests floors[], turn logs,  │  │
│  │   │                                │     death timestamps, HP swings   │  │
│  │   └───────────────┬────────────────┘                                   │  │
│  │                   ▼                                                    │  │
│  │   ┌────────────────────────────────┐                                   │  │
│  │   │ 3. Per-Player Debt Ledger      │ ◄── Evaluates wc = n(2+d) + h     │  │
│  │   │                                │     Applies custom rep reductions │  │
│  │   └───────────────┬────────────────┘                                   │  │
│  │                   ▼                                                    │  │
│  │   ┌────────────────────────────────┐                                   │  │
│  │   │ 4. Local Broadcast Hub         │ (ws://127.0.0.1:8765              │  │
│  │   │    (WebSocket & REST Engine)   │  [http://127.0.0.1:8765](https://www.google.com/search?q=http://127.0.0.1:8765))           │  │
│  │   └───────────────┬────────────────┘                                   │  │
│  └───────────────────┼────────────────────────────────────────────────────┘  │
│                      │                                                       │
│                      ▼ Bidirectional State Sync (ws://127.0.0.1:8765)         │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ WORKOUT OVERLAY HUD (Local Click-Through Window / Electron / Web)      │  │
│  │                                                                        │  │
│  │  ┌──────────────────────────────┐    ┌──────────────────────────────┐  │  │
│  │  │ PANEL A: REMAINDER RESOLVER  │    │ PANEL B: AGGREGATE LEDGER    │  │  │
│  │  │ • Unresolved Counters ($wc$) │    │ • Total Push-ups Completed   │  │  │
│  │  │ • Integer Input Box [   ]    │    │ • Total Squats Completed     │  │  │
│  │  │ • [Push-ups] [Squats]        │    │ • Total Run Counters Accrued │  │  │
│  │  │ • [All Push-ups] [All Squats]│    │ • Active Squat Ratio: R=[ 2] │  │  │
│  │  └──────────────────────────────┘    └──────────────────────────────┘  │  │
│  │                                                                        │  │
│  │  ┌──────────────────────────────────────────────────────────────────┐  │  │
│  │  │ MODAL OVERLAYS (Conditional)                                     │  │  │
│  │  │ • Run Start: Enable Workout Mode & Confirm Initial Modifiers     │  │  │
│  │  │ • Game Over: Victory Stats Screen OR Defeat 24h Jog Countdown    │  │  │
│  │  └──────────────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘

```

---

## 4. UI/UX Overlay Specifications

The overlay interface consists of two persistent status panels and two lifecycle modals.

### 4.1 Panel A: Remainder Resolver (Debt Management)
* **Target Display:** Active player selector (or tabbed views for Player 1, Player 2 in multiplayer).
* **Unresolved Counters Display:** Prominently renders current unpaid counters ($wc$).
* **Freeform Input Box:** An `<input type="number" min="1" step="1">` field accepting custom integers.
* **Resolution Action Buttons:**
  1. **`Log Push-ups`:** Takes the integer $k$ from the input box. Deducts $k$ from unresolved counters and credits $k$ push-ups to the aggregate ledger.
  2. **`Log Squats`:** Takes the integer $k$ from the input box. Deducts $\lfloor k / R \rfloor$ from unresolved counters and credits $k$ squats to the aggregate ledger.
  3. **`All with Push-ups`:** Automatically calculates total reps required to clear the current debt entirely with push-ups ($\text{Reps} = \text{Debt}$), zeros out the debt, and credits the aggregate ledger.
  4. **`All with Squats`:** Automatically calculates total reps required to clear current debt entirely with squats ($\text{Reps} = \text{Debt} \times R$), zeros out the debt, and credits the aggregate ledger.

### 4.2 Panel B: Aggregate Ledger (Run Totals)
* **Lifetime Rep Tracker:**
  * Total Push-ups completed this run.
  * Total Squats completed this run.
  * Cumulative workout counters ($wc$) accrued across all completed floors.
* **Squat Ratio Controller:**
  * Inline stepper `[ - ] R = 2 [ + ]` allowing players to adjust the squat-to-counter ratio during gameplay.
* **Multiplayer View:** Shows a consolidated summary table across all connected players.

### 4.3 Modal 1: Game Start Prompt
* **Trigger:** The daemon detects that a new run save has initialized at Floor 0/1.
* **Contents:**
  * **Opt-In Switch:** *"Enable Workout Mode for this session?"*
  * **Squat Ratio Setup:** Input selector for starting squat ratio (Default: 2).
  * **Extensibility Hook:** Placeholder slot for future run modifiers (e.g., Burpee Boss Modifiers, Elite Double Multipliers).
  * **Confirmation Button:** Dismisses the modal and arms the debt engine.

### 4.4 Modal 2: Run Outcome Screen
* **Trigger:** Save file archives into `history/*.run` or marks terminal run status.
* **Branch A: Victory:**
  * Banner: *"Victory Achieved!"*
  * Summary table showing every player's final stats: Floors cleared, total damage sustained, total turns fought, push-ups done, squats done, and remaining unpaid counters.
* **Branch B: Defeat:**
  * Banner: *"Run Defeated - 30-Minute Jog Mandated"*
  * **24-Hour Accountability Countdown:** Live ticking timer (`23:59:59`) showing time remaining to fulfill the jog penalty.
  * Penalty status for each player (highlighting who died and when).
  * Option to export or save the workout summary.

---

## 5. Subsystem Implementation Details

### Subsystem 1: File Observer & Ingestion
* Listens to the save directory via `ReadDirectoryChangesW`.
* Enforces a 75ms debounce delay upon detecting file write triggers.
* Employs an exponential backoff loop catching file locks (`EBUSY` / `PermissionError`):
  * Attempt 1: 25ms delay
  * Attempt 2: 50ms delay
  * Attempt 3: 100ms delay
  * Attempt 4: 200ms delay
* Computes an SHA-256 digest of the read payload. Discards duplicate events where data content has not changed.

### Subsystem 2: Metric Extraction & History Normalizer
* **Floor Step Parsing:** Monitors `floors: Floor[]` array length. When `length` increases, parses the newly appended floor object.
* **Turn Freezing Logic:**
  * For surviving players: $n_p = \text{floor.combat\_stats.total\_turns}$.
  * For players dying mid-combat: The parser inspects the combat action timeline or death event record within the floor metadata to extract `player[p].death_turn`. Assigns $n_p = \text{death\_turn}$.
* **Health Delta:** Evaluates $h_p = \max(\text{hp\_before} - \text{hp\_after}, 0)$ per player.
* **Death Count:** Increments $d_p$ if a player suffered lethal damage on that floor.

### Subsystem 3: Local Server & State Ledger
* Maintains the authoritative in-memory workout ledger.
* Persists session data locally (`workout_session_current.json`) so unexpected client crashes or app reloads do not wipe active workout debt.
* Exposes WebSocket endpoint (`ws://127.0.0.1:8765`) and REST endpoints:
  * `POST /api/v1/session/start`: Submits opt-in confirmation and initial squat ratio.
  * `POST /api/v1/workout/resolve`: Submits custom rep logging or bulk clearance actions.
  * `POST /api/v1/config/ratio`: Updates the current squat ratio $R$.
  * `GET /api/v1/session/state`: Returns the full state payload.

---

## 6. API Data Contracts

### 6.1 Run Start Event (`WebSocket Push`)
Pushed when a new game run is detected:
```json
{
  "type": "RUN_DETECTED",
  "timestamp": 1791389000,
  "data": {
    "run_id": "mp_run_20261008_101",
    "is_multiplayer": true,
    "player_count": 2,
    "players": [
      {"index": 0, "name": "HostPlayer", "character": "IRONCLAD"},
      {"index": 1, "name": "AllyPlayer", "character": "SILENT"}
    ],
    "default_squat_ratio": 2
  }
}

```

### 6.2 Floor Resolved & Debt Frame (`WebSocket Push`)

Pushed after every floor commit:

```json
{
  "type": "WORKOUT_FLOOR_COMMITTED",
  "timestamp": 1791389250,
  "data": {
    "floor": 6,
    "room_type": "monster",
    "players": [
      {
        "player_index": 0,
        "player_name": "HostPlayer",
        "evaluation": {
          "turns_taken_n": 5,
          "player_died": false,
          "deaths_accumulated_d": 0,
          "hp_lost_h": 14,
          "formula": "5 * (2 + 0) + 14",
          "counters_added": 24
        },
        "debt_state": {
          "unresolved_counters": 24,
          "squat_ratio": 2
        },
        "aggregates": {
          "total_counters_accrued": 52,
          "completed_pushups": 28,
          "completed_squats": 0
        }
      },
      {
        "player_index": 1,
        "player_name": "AllyPlayer",
        "evaluation": {
          "turns_taken_n": 3,
          "player_died": true,
          "deaths_accumulated_d": 1,
          "hp_lost_h": 45,
          "formula": "3 * (2 + 1) + 45",
          "counters_added": 54
        },
        "debt_state": {
          "unresolved_counters": 54,
          "squat_ratio": 2
        },
        "aggregates": {
          "total_counters_accrued": 68,
          "completed_pushups": 14,
          "completed_squats": 0
        }
      }
    ]
  }
}

```

### 6.3 Rep Resolution Request (`POST /api/v1/workout/resolve`)

Sent by the overlay when logging reps:

```json
{
  "player_index": 0,
  "action_type": "CUSTOM_ENTRY",
  "exercise": "squats",
  "reps": 20,
  "applied_ratio": 2
}

```

*(For bulk clearance actions, `action_type` can be `"ALL_PUSHUPS"` or `"ALL_SQUATS"`, omitting manual `reps`).*

### 6.4 Terminal Outcome Frame (`WebSocket Push`)

Pushed upon run finish:

```json
{
  "type": "RUN_TERMINATED",
  "timestamp": 1791392000,
  "data": {
    "outcome": "DEFEAT",
    "floor_reached": 11,
    "jog_penalty_required": true,
    "jog_deadline_timestamp": 1791478400,
    "party_summary": [
      {
        "player_index": 0,
        "player_name": "HostPlayer",
        "final_unresolved_debt": 0,
        "total_pushups": 42,
        "total_squats": 20,
        "deaths": 0
      },
      {
        "player_index": 1,
        "player_name": "AllyPlayer",
        "final_unresolved_debt": 32,
        "total_pushups": 14,
        "total_squats": 10,
        "deaths": 1
      }
    ]
  }
}

```

---

## 7. Technical Glossary

| Term | Category | Definition |
| --- | --- | --- |
| **Atomic Write** | System Programming | An OS-level file write where data is written to a temporary file and renamed over the target, ensuring game saves are never left in a half-written or corrupt state. |
| **Canonical Metrics** | Game Architecture | Historical run records (turn logs, HP deltas, card choices) stored directly inside the save file rather than calculated on the fly. |
| **Debounce** | Software Architecture | Delaying processing until file writes have finished, ensuring the watcher does not parse multiple partial updates from a single save action. |
| **Defeat Penalty** | Workout Rule | The rule requiring all players to run/jog for 30 minutes within 24 hours if the run ends in defeat. |
| **Frozen Turn Count ($n_p$)** | Workout Rule | The turn counter freezing at the exact round a player dies in combat, preventing them from being penalized for turns their teammates spent finishing the battle. |
| **Net HP Lost ($h_p$)** | Workout Engine | Positive health lost on a floor ($\max(\text{HP}_{\text{start}} - \text{HP}_{\text{end}}, 0)$). Gaining health yields 0 penalty. |
| **Out-of-Process** | Architecture | Running as an external desktop tool rather than modifying the game's internal code, avoiding crashes and keeping Steam achievements intact. |
| **Read Lock (`EBUSY`)** | System Programming | A temporary access denial occurring when the daemon tries to read a file while the game engine is writing to it. |
| **Squat Ratio ($R$)** | Workout Rule | An integer value indicating how many squats convert to 1 workout counter. Defaults to 2 and can be adjusted at any time. |
| **Unresolved Debt** | Workout Engine | Outstanding workout counters that have been earned but not yet settled via completed push-ups or squats. |
| **Workout Counter ($wc_p$)** | Workout Rule | The normalized exercise unit defined by $wc_p = n_p(2 + d_p) + h_p$. |

```
