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
* **Per-Player Manual Commit & Reward-Exit Fallback:** During the reward stage, players can click "Commit Floor Now" in Panel A to lock in debt early and do reps during rewards (forfeiting subsequent reward heals). If uncommitted, debt auto-commits with full reward healing credit when the party steps onto the next floor.
* **Dynamic Squat Ratio ($R$):** Instantly adjust rep conversions during gameplay (default: $R = 2$, where $2\ \text{Squats} = 1\ wc$ and $1\ \text{Push-up} = 1\ wc$).
* **Transparent Click-Through Overlay:** Built with Electron & React—floats directly over Slay the Spire 2 with toggleable mouse click-through support.
* **Accountability Defeat Penalty:** Runs ending in defeat trigger a live **24-Hour Countdown Timer** for a mandatory 30-minute jog penalty.
* **Offline Testing & Simulation Suite:** Built-in sample save fixtures and CLI simulator script (`npm run simulate`) for end-to-end testing without running the game.

</details>

---

## 🚀 Getting Started

Choose your role to jump directly to your self-contained setup guide:
* 👑 **If you are the Host** (hosting the game lobby / owning the save file): **[Start here](#host-setup)**
* 🎮 **If you are Joining** (co-op party member connecting remotely): **[Start here](#joiner-setup)**

---

<a id="host-setup"></a>
### 👑 Host Setup Guide

The host's PC runs Slay the Spire 2, monitors save checkpoints, and hosts the workout relay daemon.

#### 1. Prerequisites & Dependencies (Host)
Before getting started, make sure you have the following installed on your PC:
* **Git**: [Download Git](https://git-scm.com/) (required to clone and update the project)
* **Node.js & npm**: [Download Node.js](https://nodejs.org/) (v18.0.0 or higher; LTS recommended)
  * Verify installation in your terminal:
    ```bash
    node -v
    npm -v
    ```
* **ngrok**: Sign up for a free account at [ngrok.com](https://dashboard.ngrok.com/signup) to get a free authtoken (needed to tunnel your local daemon securely to your teammates).

#### 2. Installation & Setup
```bash
# 1. Clone the repository
git clone https://github.com/peter5000/sts2_workout_mod_overlay.git
cd sts2_workout_mod_overlay

# 2. Install dependencies & build
npm install
npm run build

# 3. Configure environment
cp .env.example .env
```
*(Optional: Edit `STS2_SAVE_DIR` in `.env` if your StS2 saves are in a custom directory).*

#### 3. One-Time ngrok Setup
Copy your authtoken from [dashboard.ngrok.com/get-started/your-authtoken](https://dashboard.ngrok.com/get-started/your-authtoken) and register it locally:
```bash
npx ngrok config add-authtoken YOUR_AUTHTOKEN_HERE
```

#### 4. Launching Session (3 Terminals)
* **Terminal 1 — Start the Save Daemon:**
  ```bash
  npm run start:daemon
  ```
* **Terminal 2 — Open Public Tunnel:**
  ```bash
  npx ngrok http 8765 --response-header-add "ngrok-skip-browser-warning: true"
  ```
  *Copy the `https://<something>.ngrok-free.app` forwarding URL printed by ngrok and share it with your co-op teammates.*
* **Terminal 3 — Launch Your HUD Overlay:**
  ```bash
  npm run start:overlay
  ```

---

<a id="joiner-setup"></a>
### 🎮 Joiner Setup Guide

Joiners do **not** need StS2 save file access, daemon background processes, or ngrok accounts. You only run the transparent overlay HUD and connect to the host.

#### 1. Prerequisites & Dependencies (Joiner)
Before getting started, make sure you have the following installed on your PC:
* **Git**: [Download Git](https://git-scm.com/) (required to clone and update the project)
* **Node.js & npm**: [Download Node.js](https://nodejs.org/) (v18.0.0 or higher; LTS recommended)
  * Verify installation in your terminal:
    ```bash
    node -v
    npm -v
    ```

#### 2. Installation & Setup
```bash
# 1. Clone the repository
git clone https://github.com/peter5000/sts2_workout_mod_overlay.git
cd sts2_workout_mod_overlay

# 2. Install dependencies & build
npm install
npm run build
```

#### 3. Launch & Connect
1. **Launch Your Overlay:**
   ```bash
   npm run start:overlay
   ```
2. **Connect to Host:**
   * In the top header bar of the overlay, click the **Host IP / Connection** badge (e.g. `🌐 127.0.0.1:8765`).
   * Enter the Host's ngrok forwarding URL (e.g. `https://example-1234.ngrok-free.app`).
   * Click **Save & Reconnect**. The indicator turns green (`🌐 Connected`) and will automatically sync live run metrics and workout debt!

---

### 👥 Who Runs What Summary

| Role | Runs daemon (`npm run start:daemon`) | Runs ngrok tunnel | Runs overlay (`npm run start:overlay`) |
|------|:------------------------------------:|:-----------------:|:-------------------------------------:|
| **👑 Host** (owns lobby / save file) | ✅ | ✅ | ✅ |
| **🎮 Joiner** (party member) | ❌ | ❌ | ✅ |

---

### 🔗 Connecting Both Overlays in Co-op (Step-by-Step)

When playing multiplayer Slay the Spire 2 with friends:

1. **Host does:**
   * Starts daemon: `npm run start:daemon`
   * Starts public tunnel: `npx ngrok http 8765 --response-header-add "ngrok-skip-browser-warning: true"`
   * Starts host overlay: `npm run start:overlay` (connects automatically to local daemon `127.0.0.1:8765`)
   * Shares the ngrok URL (e.g. `https://example-1234.ngrok-free.app`) with co-op party members.

2. **Each Teammate (Joiner) does:**
   * Opens their overlay on their PC: `npm run start:overlay`
   * Clicks the connection badge in the top header (shows `⚠️ Offline` or `🌐 127.0.0.1:8765`).
   * Pastes the Host's ngrok forwarding URL (e.g. `https://example-1234.ngrok-free.app`).
   * Clicks **Save & Reconnect**. The badge turns green (`🌐 Connected`).

3. **Both Overlays Are Live!**
   * Each player selects their name from the **Active Player** dropdown on Panel A/B.
   * As soon as combat ends, both players' HUDs update in real-time with individual workout debt.
   * Each player logs and clears their own push-ups and squats independently!

#### 💡 Friendly Name Mapping by Steam ID (Optional)
By default, the overlay identifies players by their Steam ID (e.g. `Player 2 (9280)`).
To display friendly names like **PlayerOne** and **PlayerThree**, add each player's 64-bit Steam ID to `.env` on the Host PC:
```env
PLAYER_NAME_10000000000000001=PlayerOne
PLAYER_NAME_10000000000000003=PlayerThree
```

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

## ❓ Frequently Asked Questions & Edge Cases (Q&A)

<details open>
<summary><b>💀 When does a death penalty start affecting my workout counter multiplier?</b></summary>

**A:** The death penalty multiplier takes effect starting from the **subsequent floor** (the floor after you died).
* In the formula $wc_p = n_p(2 + d_p) + h_p$, the multiplier $(2 + d_p)$ on the floor where you die uses your cumulative deaths **entering** that floor.
* Your turn count ($n_p$) freezes at the exact round of death so you are not penalized for additional turns your surviving allies take.
* At the conclusion of that floor, your death count increments ($d_p \leftarrow d_p + 1$). All subsequent combat floors will multiply your turns by $(2 + d_{\text{new}})$.
</details>

<details>
<summary><b>❤️ In co-op, if I die mid-combat but my allies win and I revive with 1 HP, does it count as a death?</b></summary>

**A:** **Yes.** Even though Slay the Spire 2 revives fallen teammates with 1 HP after a victory, the daemon enriches save checkpoints with `godot.log` to catch the mid-combat death event (`Player X died, doing death handling`).
* Your combat turns ($n_p$) freeze at your round of death.
* Your cumulative death count ($d_p$) increments by $+1$ for all future floors.
</details>

<details>
<summary><b>🛡️ What happens if the entire party wipes (Game Defeat)?</b></summary>

**A:** On full game defeat, workout counters for the final losing battle are **waived** ($wc = 0$).
* You are **not** double-penalized with push-up/squat debt for the battle that ended the run.
* Prior uncompleted floors' debt is preserved.
* The mandatory **30-minute defeat jog penalty** triggers with an active 24-hour countdown timer on the overlay.
</details>

<details>
<summary><b>🩹 If I heal from potions or relics on the reward screen, does my debt decrease?</b></summary>

**A:** **Yes, as long as you have not manually committed the floor yet.**
During the reward screen of combat encounters, a **"Commit Floor Now"** button appears in Panel A:
* **If you wait:** Any healing received during rewards (drinking a potion, picking a healing card/relic, etc.) dynamically offsets your HP damage taken ($h_p$). Once all players finish rewards and advance to Floor $n+1$, your debt auto-commits with that healing factored in, and the commit button disappears.
* **If you commit early:** Clicking "Commit Floor Now" locks in your workout debt immediately so you can start clearing reps during the reward screen. Once committed, you forfeit subsequent reward healing reductions for that floor.
</details>

<details>
<summary><b>🚀 What happens if we launch the overlay in the middle of an active run?</b></summary>

**A:** The daemon sequentially replays past floors from `map_point_history` to catch up your active debt. Because earlier mid-combat deaths from prior encounters may have already scrolled past `godot.log`, you can adjust your death counter directly in the Panel B HUD if needed.
</details>

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
