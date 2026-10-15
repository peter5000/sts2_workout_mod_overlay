# 🏋️ Slay the Spire 2: Workout Mode Overlay (v1.1.0)

> An out-of-process, zero-mod workout debt tracker and transparent HUD overlay for **Slay the Spire 2**.

---

## 📌 Project Overview

**Slay the Spire 2 Workout Mode Helper** transforms every combat encounter into a real-life physical workout. It monitors your game save file in real-time, calculates per-player workout debt after every floor based on turns taken and health lost, and presents an interactive transparent HUD overlay for logging exercise reps (Push-ups & Squats).

<details>
<summary><b>🎯 Key Features (Click to expand)</b></summary>

### Features & Mechanics
* **Zero Modding Required:** Operates entirely out-of-process as a host daemon reading local save checkpoints—keeping game files intact and preserving Steam achievements.
* **Per-Player Attribution Engine:** Calculates individual workout counters ($wc_p$) per player rather than pooling party debt.
* **Mid-Combat Turn Freezing:** If a player dies mid-combat, their turn count ($n_p$) freezes at the exact round of death so surviving allies don't inflate the fallen player's exercise debt.
* **Delayed Commit & Reward Balancing:** Debt is finalized once rewards are claimed and you step onto the next floor, allowing healing from rewards to offset damage taken.
* **Dynamic Squat Ratio ($R$):** Instantly adjust rep conversions during gameplay (default: $R = 2$, where $2\ \text{Squats} = 1\ wc$ and $1\ \text{Push-up} = 1\ wc$).
* **Transparent Click-Through Overlay:** Built with Electron & React—floats directly over Slay the Spire 2 with toggleable mouse click-through support.
* **Accountability Defeat Penalty:** Runs ending in defeat trigger a live **24-Hour Countdown Timer** for a mandatory 30-minute jog penalty.
* **Offline Testing & Simulation Suite:** Built-in sample save fixtures and CLI simulator script (`npm run simulate`) for end-to-end testing without running the game.

</details>

---

## 🚀 Getting Started

### Prerequisites
* **Node.js**: v18.0.0 or higher
* **npm**: v9.0.0 or higher

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/sts2_workout_mod_overlay.git
   cd sts2_workout_mod_overlay
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment:**
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   *(Optionally specify `STS2_SAVE_DIR` if your save files are located in a custom directory).*

---

## 👥 Who Runs What

| Role | Runs daemon | Runs ngrok | Runs overlay |
|------|:-----------:|:----------:|:------------:|
| **Host** (the player whose PC hosts the StS2 co-op lobby / owns the save file) | ✅ | ✅ | ✅ |
| **Joiner** (everyone else) | ❌ | ❌ | ✅ |

Only the **host** reads the save file, so only the host needs the daemon and the ngrok tunnel.
Joiners only run the overlay and point it at the host's ngrok URL.

### Build (everyone)
```bash
git pull
npm install
npm run build
```

### Host
```bash
# Terminal 1 – daemon (watches the save file, serves REST + WebSocket on :8765)
npm run start:daemon

# Terminal 2 – public tunnel to the daemon (see ngrok setup below)
npx ngrok http 8765 --response-header-add "ngrok-skip-browser-warning: true"

# Terminal 3 – your own overlay
npm run start:overlay
```
Send the `https://<something>.ngrok-free.app` forwarding URL ngrok prints to your joiners.

### Joiner
```bash
npm run start:overlay
```
Then enter the host's ngrok URL (e.g. `https://example-1234.ngrok-free.app`) in the overlay's host field.

---

## 🌐 ngrok Setup (host only, one time)

1. **Sign up** for a free account at <https://dashboard.ngrok.com/signup>.
2. Copy your authtoken from <https://dashboard.ngrok.com/get-started/your-authtoken>.
3. Register it locally (stored in your user ngrok config, **not** in this repo):
   ```bash
   npx ngrok config add-authtoken 2abcEXAMPLEtoken_0123456789abcdefEXAMPLE
   ```
4. Start the tunnel. The `--response-header-add` flag suppresses ngrok's free-tier
   browser-warning interstitial, which otherwise breaks the overlay's API/WebSocket calls:
   ```bash
   npx ngrok http 8765 --response-header-add "ngrok-skip-browser-warning: true"
   ```
5. ngrok prints a forwarding URL such as `https://example-1234.ngrok-free.app` — share that with joiners.
   On the free plan the URL changes every time ngrok restarts, so re-share it after restarts.

> ⚠️ Never commit your authtoken or your personal ngrok URL.

---

## 🛠️ Troubleshooting

1. Update and rebuild first:
   ```bash
   git pull
   npm install
   npm run build
   ```
2. Restart everything (host: daemon → ngrok → overlay; joiner: overlay). Re-share the ngrok URL if it changed.
3. Still broken? Open a GitHub issue with: your role (host/joiner), OS, the daemon console output,
   and what you expected vs. what happened. Redact Steam IDs and ngrok URLs.

---

<details>
<summary><b>🔬 Technical Details: Mathematical Model & Architecture (Click to expand)</b></summary>

## 🧮 Mathematical Model & Exercise Debt Equation

At the conclusion of each floor $f$, each player $p$ accrues a workout counter value ($wc_p$):

$$wc_p = n_p(2 + d_p) + h_p$$

Where:
* $n_p$: Combat turns taken by player $p$ (freezes at death turn if fallen mid-combat; $0$ for events/campfires/shops).
* $d_p$: Cumulative deaths suffered by player $p$ across the current run up to that point.
* $h_p$: Net positive HP lost on that floor ($\max(\text{HP}_{\text{start}} - \text{HP}_{\text{end}}, 0)$).
* **Defeat Combat Waiver:** On full game defeat, workout counters for the final losing battle are waived ($wc_p = 0$). Prior floors' debt is preserved and the 30-minute jog penalty applies.

### Rep Conversions & Unresolved Debt
$$\text{Remaining Debt}_p = \sum wc_{p, \text{accrued}} - \left( \text{Push-ups Completed}_p + \left\lfloor \frac{\text{Squats Completed}_p}{R} \right\rfloor \right)$$

---

## 🏗️ System Architecture & Data Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              HOST PC ENVIRONMENT                             │
│                                                                              │
│  ┌────────────────────────┐                                                  │
│  │  Slay the Spire 2      │ (Godot Engine Process)                           │
│  │  Save Output           │ Writes save checkpoints on floor exit / death    │
│  └───────────┬────────────┘                                                  │
│              ▼                                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ WORKOUT RELAY DAEMON (Background Node.js Service)                       │  │
│  │  • File Observer & Debouncer (75ms debounce, SHA-256 deduplication)    │  │
│  │  • Metric Extractor (Parses turn logs, death turn freezing, HP deltas)  │  │
│  │  • Per-Player Debt Ledger & Persistence (active_session.json)          │  │
│  │  • Broadcast Engine (WebSocket & REST API @ ws://127.0.0.1:8765)        │  │
│  └───────────┬────────────────────────────────────────────────────────────┘  │
│              ▼                                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ WORKOUT OVERLAY HUD (Electron + React Transparent Overlay Window)       │  │
│  │  • Panel A: Remainder Resolver (Freeform & Bulk Rep Clearance)         │  │
│  │  • Panel B: Aggregate Ledger & Live Squat Ratio Controller             │  │
│  │  • Lifecycle Modals: Run Opt-in & 24h Defeat Jog Penalty Countdown     │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

</details>

---

## 💻 Development & Testing

### Launching the Daemon & Overlay
```bash
# Start background daemon server
npm run start:daemon

# Start Electron HUD overlay window
npm run start:overlay
```

### Running the Offline Save Simulator
Test the full pipeline without running Slay the Spire 2:
```bash
# Simulate floor 1 fight
npm run simulate -- --step 1

# Simulate boss fight with mid-combat player death
npm run simulate -- --step 3

# Simulate run defeat (triggers 24h jog countdown)
npm run simulate -- --step 5
```

---

## 🔒 Security & Privacy Notice
* All data remains strictly local to your Host PC (`127.0.0.1`).
* Sensitive API keys, custom save directory overrides, and local environment parameters must be placed inside `.env` (which is excluded from version control via `.gitignore`). Never commit secret tokens or credentials to git.

---

## 📜 License
This project is licensed under the [MIT License](LICENSE).
