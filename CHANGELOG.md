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

## [1.5.1] - 2026-10-25

### Fixed
* **Start-of-Act Health Penalty Ingestion**: Isolated automated act-start healing on start-of-act floors (`map_point_type === 'ancient'`). Deliberate health damage—such as Neow relic damage (*Precarious Shears* taking 16 damage) or Ancient blessing choices that reduce Current HP—now directly utilizes Godot's recorded `stat.damage_taken` as workout debt ($wc$) instead of being improperly cancelled out by the act-start heal. Max HP loss that does not reduce Current HP accrues 0 debt. Subsequent event and combat floors continue sequential HP tracking as intended.
* **"All Squats" Button Decimal Calculation**: Fixed button label and confirmation modal in `renderer.tsx` to dynamically deduct the player's banked fractional squat remainder (`Math.max(activeDebt * ratio - activeRemainder, 0)`), ensuring decimal squats are accurately calculated down to 0 remaining debt.
* **Summary Modal Repeated Popup Immunity**: Fixed an issue where logging push-ups/squats or adjusting the squat ratio in terminal run states (`VICTORY` or `DEFEAT`) repeatedly reopened the summary modal. Created `shouldShowSummaryModal` and client dismissal tracking (`dismissedSummaryRunId`) so dismissed summaries stay closed during rep logging, with a persistent "View Summary" button available in Panel A to reopen on demand.
* **Peer Network ID Isolation**: Filtered candidate Steam/Account IDs in `adapter.ts` to require $\ge 10$ digits, preventing internal Godot peer network IDs (e.g. `net_id: 1`) from mistakenly colliding with slot index fallback keys (`PLAYER_NAME_1`).
* **Single Player Summary Display**: Summary table displays "Me" and hides "(Host)" when playing in single-player mode.

### Added
* **Security & PII Exposure Policy**: Established formal repository instructions and contributor rules ([AGENTS.md](AGENTS.md) and [.agents/rules/pii_exposure.md](.agents/rules/pii_exposure.md)) prohibiting any commit or exposure of real Steam IDs and personal player names in code, comments, commit messages, or documentation.

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
