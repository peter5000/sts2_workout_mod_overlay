# Slay the Spire 2 Workout Mode Overlay

> The all-in-one workout companion for Slay the Spire 2. Level up your real-life fitness while having fun climbing the Spire, solo or with friends!

---

## Table of Contents

- [Overview](#overview)
- [How It Works](#how-it-works)
- [Quick Start by Player Type](#quick-start-by-player-type)
  - [Software Requirements Summary](#software-requirements-summary)
  - [Setup Guide: Solo Player](#setup-guide-solo-player)
  - [Setup Guide: Co-op Host](#setup-guide-co-op-host)
  - [Setup Guide: Co-op Teammate](#setup-guide-co-op-teammate)
- [Using the Overlay In-Game](#using-the-overlay-in-game)
- [Setting Player Names](#setting-player-names)
- [Frequently Asked Questions](#frequently-asked-questions)
- [Technical Details & Architecture](#technical-details--architecture)
- [License](#license)

---

## Overview

The Slay the Spire 2 Workout Mode Overlay is a transparent, floating head-up display (HUD) that turns your gameplay into physical exercise. Every combat encounter calculates workout debt (push-ups and squats) based on turns taken and health lost.

Key advantages:
- **Zero Modding Required:** Runs completely out-of-process alongside Slay the Spire 2. Game files remain untouched and Steam achievements are preserved.
- **Solo and Multiplayer Ready:** Works whether you play alone or with friends in co-op. Every player gets their own customized workout ledger and squat conversion ratio.
- **Interactive Floating HUD:** Sits transparently on top of your game window with toggleable mouse click-through so it never gets in the way of card play.

---

## How It Works

The rules are simple, motivating, and keep you moving between floors:

1. **Combat Debt:**
   When a combat encounter ends, you accrue a workout debt based on how long the battle lasted and how much health you lost:
   ```
   Workout Debt = (Combat Turns * Turn Multiplier) + Health Lost
   ```
2. **Push-ups and Squats:**
   - Push-ups clear debt at a 1:1 ratio (1 push-up = 1 rep).
   - Squats clear debt using your personal Squat Ratio (default is 2 squats = 1 rep; adjustable on the fly to 3:1, 4:1, etc.).
3. **Death Penalty Multiplier:**
   - Base turn multiplier starts at 2.
   - Each mid-combat death increases your turn multiplier by +1 for all subsequent floors.
   - Dying on floor N freezes your turn count at the moment of death, and the increased multiplier begins on floor N+1.
4. **Reward Screen Healing:**
   - When combat finishes, you enter the reward stage. Any healing received (potions, relics, healing cards) dynamically offsets your damage taken, reducing your workout debt.
   - If you want to do your reps right away, click **Commit Floor Now** to lock in your reps early.
   - If you prefer to finish picking cards, your debt automatically commits when the party steps onto the next floor with all reward heals factored in.
5. **Victory vs. Defeat:**
   - **Victory:** Winning the entire game automatically commits and accrues your final boss fight workout debt so you celebrate the win with a victory set.
   - **Defeat:** Wiping in combat waives the reps for that final losing fight (0 reps), preserves all previous uncompleted debt, and triggers a live **24-Hour Countdown Timer** for a mandatory 30-minute accountability jog.

---

## Quick Start by Player Type

Choose the guide that matches your role. Each guide is fully self-contained.

### Software Requirements Summary

| Program | Needed by Solo Player | Needed by Co-op Host | Needed by Co-op Teammate | Download Link |
|---|:---:|:---:|:---:|---|
| **Git** | Required | Required | Required | [Download Git](https://git-scm.com/) |
| **Node.js (v18+ LTS)** | Required | Required | Required | [Download Node.js](https://nodejs.org/) |
| **ngrok** | Not needed | Required | Not needed | [Sign up at ngrok](https://dashboard.ngrok.com/signup) |
| **Slay the Spire 2** | Required | Required | Required | Steam |

---

<details>
<summary><b>Setup Guide: Solo Player (Click to expand)</b></summary>

### Solo Player Setup

If you are playing Slay the Spire 2 by yourself on your own PC, you only need to run the local tracker and the overlay HUD.

#### 1. Install Prerequisites
- Download and install [Git](https://git-scm.com/).
- Download and install [Node.js LTS](https://nodejs.org/) (version 18 or higher).
- Confirm installation by opening a terminal (Command Prompt or PowerShell) and typing:
  ```bash
  git --version
  node -v
  npm -v
  ```

#### 2. Download and Build the Project
Open your terminal and run:
```bash
# 1. Clone the repository
git clone https://github.com/peter5000/sts2_workout_mod_overlay.git

# 2. Enter the project directory
cd sts2_workout_mod_overlay

# 3. Install dependencies and build the application
npm install
npm run build

# 4. Create your local environment configuration file
copy .env.example .env
```
*(If you are on macOS or Linux, use `cp .env.example .env` instead of `copy`).*

#### 3. Launching Your Session
You will need two terminal windows open:

**Terminal 1 — Start the Game Save Tracker:**
```bash
cd sts2_workout_mod_overlay
npm run start:daemon
```

**Terminal 2 — Start the Workout HUD Overlay:**
```bash
cd sts2_workout_mod_overlay
npm run start:overlay
```

Start Slay the Spire 2. The overlay will connect automatically to `127.0.0.1:8765` and begin tracking your run immediately!

</details>

---

<details>
<summary><b>Setup Guide: Co-op Host (Click to expand)</b></summary>

### Co-op Host Setup

The host PC runs Slay the Spire 2, monitors save files, and runs a public relay so teammates can connect their overlays.

#### 1. Install Prerequisites
- Download and install [Git](https://git-scm.com/).
- Download and install [Node.js LTS](https://nodejs.org/) (version 18 or higher).
- Sign up for a free account at [ngrok.com](https://dashboard.ngrok.com/signup) to get a free authentication token.

#### 2. Download and Build the Project
Open your terminal and run:
```bash
# 1. Clone the repository
git clone https://github.com/peter5000/sts2_workout_mod_overlay.git

# 2. Enter the project directory
cd sts2_workout_mod_overlay

# 3. Install dependencies and build the application
npm install
npm run build

# 4. Create your local environment configuration file
copy .env.example .env
```

#### 3. One-Time ngrok Configuration
Get your authtoken from [dashboard.ngrok.com/get-started/your-authtoken](https://dashboard.ngrok.com/get-started/your-authtoken) and link it in your terminal:
```bash
npx ngrok config add-authtoken YOUR_AUTHTOKEN_HERE
```

#### 4. Launching the Host Session
Open three separate terminal windows:

**Terminal 1 — Run the Save Daemon:**
```bash
cd sts2_workout_mod_overlay
npm run start:daemon
```

**Terminal 2 — Open the Public Tunnel:**
```bash
cd sts2_workout_mod_overlay
npx ngrok http 8765 --response-header-add "ngrok-skip-browser-warning: true"
```
Look for the `Forwarding` line printed by ngrok (e.g. `https://random-id.ngrok-free.app`). **Copy this URL and send it to your teammates.**

**Terminal 3 — Run Your Local Overlay:**
```bash
cd sts2_workout_mod_overlay
npm run start:overlay
```

</details>

---

<details>
<summary><b>Setup Guide: Co-op Teammate (Click to expand)</b></summary>

### Co-op Teammate Setup

Teammates joining a multiplayer lobby do **not** need access to the game save files, do **not** need ngrok accounts, and do **not** run the background daemon. You only run the HUD overlay on your own PC and point it to the host.

#### 1. Install Prerequisites
- Download and install [Git](https://git-scm.com/).
- Download and install [Node.js LTS](https://nodejs.org/) (version 18 or higher).

#### 2. Download and Build the Project
Open your terminal and run:
```bash
# 1. Clone the repository
git clone https://github.com/peter5000/sts2_workout_mod_overlay.git

# 2. Enter the project directory
cd sts2_workout_mod_overlay

# 3. Install dependencies and build the application
npm install
npm run build
```

#### 3. Launch the Overlay and Connect to Host
In your terminal, launch the overlay:
```bash
cd sts2_workout_mod_overlay
npm run start:overlay
```

1. Look at the top header bar of your overlay window. Click the connection badge (it will display `127.0.0.1:8765` or `Offline`).
2. Paste the host's ngrok forwarding URL (e.g. `https://random-id.ngrok-free.app`).
3. Click **Save & Reconnect**.
4. The connection indicator will turn green (`Connected`). Your HUD will now synchronize with your game lobby in real time!

</details>

---

## Using the Overlay In-Game

The overlay is split into two panels with dedicated controls:

### Panel A: Workout Deck
- **Pending Floor Banner:** Appears after combat finishes while in the reward screen. Shows your exact turns, damage taken, and workout debt formula. Click **Commit Floor Now** if you want to lock in your debt early and start exercising during card rewards.
- **Exercise Rep Buttons:**
  - **Push-ups (+1, +5, +10, Clear All):** Clears debt at 1:1.
  - **Squats (+2, +6, +10, Custom):** Clears debt according to your active squat ratio.
  - **Custom Entry:** Enter any arbitrary number of reps to subtract from your debt.
- **Unresolved Debt Counter:** Displays your remaining workout debt in bold. Turns green when you reach 0.

### Panel B: Ledger & Controls
- **Player Selector:** In multiplayer, switch between teammates to view everyone's progress and stats.
- **Squat Ratio Controller:** Slider allowing each player to set their own difficulty (e.g. 2:1, 3:1, or 4:1).
- **Death Counter Stepper:** View and adjust cumulative deaths if you started the tracker mid-run.
- **Session Totals:** Displays lifetime completed push-ups, squats, and total workout counters accrued.

### Mouse Click-Through Mode
- Click the lock/mouse toggle button in the top-right header to enable **Click-Through Mode**.
- While enabled, mouse clicks pass directly through the transparent overlay into Slay the Spire 2 so you can play without obstruction.
- Click the button or use your configured shortcut to regain mouse focus when you are ready to log exercises.

---

## Setting Player Names

By default, players in co-op are displayed using their Steam IDs (e.g. `Player 1 (8509)`). You can easily assign friendly display names (e.g. **PlayerOne**, **PlayerTwo**, **PlayerThree**).

Open the `.env` file on the Host PC and add your players' 64-bit Steam IDs:

```env
# Format: PLAYER_NAME_<SteamID>=DisplayName
PLAYER_NAME_10000000000000001=PlayerOne
PLAYER_NAME_10000000000000002=PlayerTwo
PLAYER_NAME_10000000000000003=PlayerThree

# Fallback by player index if playing offline/single player:
PLAYER_NAME_0=PlayerOne
```

### Live Hot-Reload
You do **not** need to restart the daemon or the overlay when editing player names. As soon as you save `.env` on disk, the daemon detects the file update, reloads names, and pushes the change live to all connected overlays immediately!

---

<details>
<summary><b>Frequently Asked Questions (Click to expand)</b></summary>

### Can I get banned or lose Steam achievements?
No. The tracker runs 100% out-of-process. It does not inject code into Slay the Spire 2, does not alter game memory, and does not modify save files. It only reads save checkpoints created naturally by the game.

### What happens if I forget to click "Commit Floor Now"?
Nothing is lost! The commit button is optional for players who want to exercise during the reward screen. If you finish picking your cards and move to the next floor, your debt auto-commits automatically with all reward healing factored in.

### What happens if our run ends in Defeat?
On defeat, the reps for the final losing combat are waived (0 reps). Any debt you accumulated on earlier floors is kept, and the overlay starts a live **24-hour countdown timer** reminding your party to complete a 30-minute accountability jog.

### Can different players use different squat ratios in co-op?
Yes. Each player has their own independent squat ratio setting in Panel B. One player can do 2 squats per rep while another does 3 or 4 squats per rep.

### What if we launch the overlay in the middle of a run?
The daemon replays past floors from your run history to calculate your current debt. If earlier mid-combat deaths already scrolled past the combat log, you can use the death stepper in Panel B to adjust your death counter to the correct value.

</details>

---

<details>
<summary><b>Technical Details & Architecture (Click to expand)</b></summary>

### Exercise Debt Equation

At the end of each floor $f$, each player $p$ accrues a workout counter value ($wc_p$):

$$wc_p = n_p(2 + d_p) + h_p$$

Where:
- $n_p$: Combat turns taken (freezes at round of death if knocked down mid-combat; 0 for non-combat rooms).
- $d_p$: Cumulative deaths suffered across the current run prior to this encounter.
- $h_p$: Net HP lost on that floor ($\max(\text{HP}_{\text{start}} - \text{HP}_{\text{end}}, 0)$).

Remaining workout debt is calculated as:
$$\text{Remaining Debt}_p = \sum wc_{p, \text{accrued}} - \left( \text{Push-ups}_p + \left\lfloor \frac{\text{Squats}_p}{R_p} \right\rfloor \right)$$

### Architecture Diagram

```
+------------------------------------------------------------------------------+
|                             HOST PC ENVIRONMENT                              |
|                                                                              |
|  +------------------------+                                                  |
|  |  Slay the Spire 2      | (Godot Engine Process)                           |
|  |  Save Checkpoint       | Writes current_run.save on floor exit / death    |
|  +-----------+------------+                                                  |
|              |                                                               |
|              v                                                               |
|  +------------------------------------------------------------------------+  |
|  | WORKOUT RELAY DAEMON (Node.js Background Service)                      |  |
|  |  - File Observer (Debounced reading, SHA-256 deduplication)            |  |
|  |  - Metric Parser (Turns, mid-combat death detection via godot.log)     |  |
|  |  - Debt Ledger & Persistence (active_session.json, workout_history)   |  |
|  |  - WebSocket & REST API Service (Port 8765)                            |  |
|  +-----------+------------------------------------------------------------+  |
|              |                                                               |
|              v                                                               |
|  +------------------------------------------------------------------------+  |
|  | WORKOUT OVERLAY HUD (Electron + React)                                 |  |
|  |  - Panel A: Rep Clearer & Live Commit Banner                           |  |
|  |  - Panel B: Session Aggregates & Squat Ratio Controls                  |  |
|  +------------------------------------------------------------------------+  |
+------------------------------------------------------------------------------+
```

### Offline Save Simulator (Testing Without Game)
You can test the entire pipeline without running Slay the Spire 2:
```bash
# Simulate floor 1 combat
npm run simulate -- --step 1

# Simulate floor 3 elite with mid-combat death
npm run simulate -- --step 3

# Simulate run defeat (triggers 24h jog countdown)
npm run simulate -- --step 5
```

</details>

---

## License

This project is licensed under the [MIT License](LICENSE).
