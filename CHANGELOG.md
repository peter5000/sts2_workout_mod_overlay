# Changelog

All notable changes to the Slay the Spire 2 Workout Mode Overlay will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## Versioning Policy

* **v1.5.0 Final** is the authoritative, feature-complete release for the 1.x line.
* **v1.5.x Patch Releases**: Strictly reserved for critical bug fixes, game update compatibility patches, and stability enhancements.
* **v2.x.x Major Releases**: All new feature development, expanded exercise tracking modes, or architectural overhauls will be introduced under the 2.x line.

---

## [1.5.0] - 2026-10-24

### Added
* **Out-of-Process Relay Daemon**: Watches `%APPDATA%/SlayTheSpire2` saves directory using `chokidar` with a 75ms debounce, SHA-256 deduplication, and exponential file-lock retries. Zero modding, zero memory injection, Steam achievements 100% intact.
* **Mathematical Attribution Engine**: Pure functional evaluator implementing $wc_p = n_p(2 + d_p) + h_p$ per individual player.
* **Engine Log Death Detection**: Reverse-chunk tail reader for `godot.log` isolating true player deaths (`Player X died, doing death handling`) and freezing turns at the moment of death. Excludes mid-combat revives (Fairy in a Bottle, Lizard Tail).
* **Death Penalty Multiplier Timing**: Evaluates combat floor debt using pre-existing death counts ($d_p$); death increments apply strictly to subsequent floors ($N+1$ onward).
* **Reward Stage Lifecycle & Early Lock-in**:
  * Detects active reward stages (`pre_finished_room.is_pre_finished === true`).
  * Displays "Commit Floor Now" banner in Panel A.
  * Allows post-combat reward heals to dynamically reduce HP debt ($h_p$).
  * Supports manual early commit to lock in reps immediately, and auto-commits on room exit.
* **Climax Victory Encounter Accrual**: On full game victory (`run_status === 'VICTORY'`), final boss fight debt is accrued and recorded automatically before session termination.
* **Defeat Accountability Jog Penalty**: Final wipe battle debt is waived ($0\ wc$), preserving prior debt and arming a 24-hour countdown timer for a mandatory 30-minute jog.
* **Multi-Player Support & Remote Tunnels**:
  * Express REST API and WebSocket broadcaster listening on `0.0.0.0:8765`.
  * Public co-op play via ngrok tunnels with automatic SSL certificate error bypass and `'ngrok-skip-browser-warning'` headers.
  * In-overlay remote host switcher modal with `localStorage` persistence.
* **Customizable Squat Conversion Ratios**: Independent per-player ratio ($R_p \ge 1$) with sub-integer fractional remainder tracking.
* **Live Configuration Hot-Reload**: Single key schema `PLAYER_NAME_<ID>` (Steam ID or slot index) in `.env`, automatically reloaded without restarting the daemon. Automatically extracts local Steam ID from `STS2_SAVE_DIR` for player 0.
* **Atomic Disk Persistence**: Safe `.tmp` write and `fs.renameSync` preserving `active_session.json` and permanent run breakdowns in `workout_history.json`.
* **Transparent HUD Overlays**: Electron floating windows with `screen-saver` DWM pinning, toggleable mouse click-through (`Ctrl+Shift+X`), and force-foreground (`Ctrl+Shift+Z`).
* **Comprehensive Automated Test Suite**: Modular suites covering log reading, room tracking, auto-commit, death detection, game lifecycle, reward stage, and math formulas.
