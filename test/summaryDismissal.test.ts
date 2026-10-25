import { DebtLedger } from '../src/daemon/ledger';
import { PersistenceManager } from '../src/daemon/persistence';
import { shouldShowSummaryModal } from '../src/shared/modalState';
import { RawRunSaveData, RawFloorEntry } from '../src/shared/types';
import fs from 'fs';
import path from 'path';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ [ASSERTION FAILED] ${message}`);
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

export function runSummaryDismissalTests() {
  console.log('🧪 Running Summary Modal Dismissal & State Retention Unit Tests...');

  // =========================================================================
  // 1. Unit Verification: shouldShowSummaryModal State Transition Matrix
  // =========================================================================
  // A. Active game: summary modal must NEVER show
  assert(
    shouldShowSummaryModal('ACTIVE', 'run_001', null, 'all') === false,
    'Active run must not trigger summary modal'
  );
  assert(
    shouldShowSummaryModal('ACTIVE', 'run_001', null, 'a') === false,
    'Active run on Panel A must not trigger summary modal'
  );

  // B. Terminal run (VICTORY or DEFEAT): initially shows modal
  assert(
    shouldShowSummaryModal('VICTORY', 'run_001', null, 'all') === true,
    'Victory run without dismissal must display summary modal'
  );
  assert(
    shouldShowSummaryModal('DEFEAT', 'run_001', null, 'a') === true,
    'Defeat run on Panel A without dismissal must display summary modal'
  );

  // C. Panel B isolation: Panel B window must NEVER host modals
  assert(
    shouldShowSummaryModal('VICTORY', 'run_001', null, 'b') === false,
    'Panel B must never display summary modal'
  );
  assert(
    shouldShowSummaryModal('DEFEAT', 'run_001', null, 'b') === false,
    'Panel B must never display defeat summary modal'
  );

  // D. Dismissal: once dismissed for run_001, must stay suppressed
  assert(
    shouldShowSummaryModal('VICTORY', 'run_001', 'run_001', 'all') === false,
    'Dismissed victory summary for run_001 must return false'
  );
  assert(
    shouldShowSummaryModal('DEFEAT', 'run_001', 'run_001', 'a') === false,
    'Dismissed defeat summary for run_001 must return false'
  );

  // E. Subsequent state synchronization (logging reps or changing squat ratio during terminal state):
  // State updates produce fresh store references with identical run_id; must REMAIN suppressed!
  assert(
    shouldShowSummaryModal('VICTORY', 'run_001', 'run_001', 'a') === false,
    'Rep logging / ratio change state refresh must NOT re-open dismissed summary modal'
  );

  // F. User re-opens summary on demand: setting dismissedRunId to null re-activates modal
  assert(
    shouldShowSummaryModal('VICTORY', 'run_001', null, 'a') === true,
    'Reopening summary modal on demand must return true'
  );

  // G. New run isolation: starting a new run (run_002) resets dismissal when that new run finishes
  assert(
    shouldShowSummaryModal('VICTORY', 'run_002', 'run_001', 'a') === true,
    'New run terminal outcome must display summary even if previous run was dismissed'
  );

  console.log('  ✓ shouldShowSummaryModal state transition matrix verified');

  // =========================================================================
  // 2. Integration: Terminal Run Rep Logging & Ratio Updates with DebtLedger
  // =========================================================================
  const testDir = path.join(__dirname, 'scratch_dismissal_test');
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });

  const persistence = new PersistenceManager(testDir);
  const ledger = new DebtLedger(persistence);

  // Step A: Floor 1 combat cleared while ACTIVE (4 turns, 10 HP loss -> 18 wc)
  const floor1: RawFloorEntry = {
    floor_num: 1,
    room_type: 'monster',
    total_combat_turns: 4,
    player_metrics: [
      { player_index: 0, player_name: 'PlayerOne', hp_start: 75, hp_end: 65, died_this_floor: false, death_turn: null }
    ]
  };

  ledger.processSaveData({
    run_id: 'defeat_run_dismissal_test',
    is_multiplayer: false,
    player_count: 1,
    players: [{ index: 0, name: 'PlayerOne', character: 'DEFECT' }],
    run_status: 'ACTIVE',
    floors: [floor1],
    current_floor: 1,
    in_reward_stage: false
  });

  // Step B: Floor 2 wipe combat transitions run to DEFEAT (Floor 2 waived, Floor 1 preserved at 18 wc)
  const floor2Wipe: RawFloorEntry = {
    floor_num: 2,
    room_type: 'elite',
    total_combat_turns: 3,
    player_metrics: [
      { player_index: 0, player_name: 'PlayerOne', hp_start: 65, hp_end: 0, died_this_floor: true, death_turn: 3 }
    ]
  };

  ledger.processSaveData({
    run_id: 'defeat_run_dismissal_test',
    is_multiplayer: false,
    player_count: 1,
    players: [{ index: 0, name: 'PlayerOne', character: 'DEFECT' }],
    run_status: 'DEFEAT',
    floors: [floor1, floor2Wipe],
    current_floor: 2,
    in_reward_stage: false
  });

  let state = ledger.getFullState();
  assert(state.run_status === 'DEFEAT', 'Run status must be DEFEAT');
  assert(state.player_debts[0] === 18, `Debt should be 18 wc (preserved from floor 1), got ${state.player_debts[0]}`);

  // Modal starts open
  let dismissedRunId: string | null = null;
  assert(
    shouldShowSummaryModal(state.run_status, state.run_id, dismissedRunId, 'all') === true,
    'Defeat modal must initially be open'
  );

  // User clicks "Dismiss Summary"
  dismissedRunId = state.run_id;
  assert(
    shouldShowSummaryModal(state.run_status, state.run_id, dismissedRunId, 'all') === false,
    'Defeat modal must be closed after dismissal'
  );

  // User logs 6 push-ups while in DEFEAT state
  ledger.resolveReps({
    player_index: 0,
    action_type: 'CUSTOM_ENTRY',
    exercise: 'pushups',
    reps: 6,
    applied_ratio: 2
  });

  // Re-fetch ledger state: debt decreased, status remains DEFEAT, run_id unchanged
  state = ledger.getFullState();
  assert(state.player_debts[0] === 12, `Debt must decrease to 12 wc, got ${state.player_debts[0]}`);
  assert(state.player_aggregates[0].pushups === 6, 'Pushups aggregate must record 6');
  assert(state.run_status === 'DEFEAT', 'run_status must remain DEFEAT');

  // Verify that summary modal DOES NOT re-open after rep logging!
  assert(
    shouldShowSummaryModal(state.run_status, state.run_id, dismissedRunId, 'all') === false,
    'Summary modal MUST NOT re-open after logging push-ups!'
  );

  // User logs 8 squats (at 2:1 ratio -> clears 4 wc)
  ledger.resolveReps({
    player_index: 0,
    action_type: 'CUSTOM_ENTRY',
    exercise: 'squats',
    reps: 8,
    applied_ratio: 2
  });

  state = ledger.getFullState();
  assert(state.player_debts[0] === 8, `Debt must decrease to 8 wc, got ${state.player_debts[0]}`);
  assert(state.player_aggregates[0].squats === 8, 'Squats aggregate must record 8');

  // Verify that summary modal DOES NOT re-open after squat logging!
  assert(
    shouldShowSummaryModal(state.run_status, state.run_id, dismissedRunId, 'all') === false,
    'Summary modal MUST NOT re-open after logging squats!'
  );

  // User updates squat ratio from 2 to 3
  ledger.setPlayerSquatRatio(0, 3);
  state = ledger.getFullState();
  assert(state.player_squat_ratios?.[0] === 3, 'Squat ratio must update to 3');

  // Verify that summary modal DOES NOT re-open after changing squat ratio!
  assert(
    shouldShowSummaryModal(state.run_status, state.run_id, dismissedRunId, 'all') === false,
    'Summary modal MUST NOT re-open after updating squat ratio!'
  );

  // User clicks "View Defeat Summary" button
  dismissedRunId = null;
  assert(
    shouldShowSummaryModal(state.run_status, state.run_id, dismissedRunId, 'all') === true,
    'Summary modal must re-open when user clicks View Summary'
  );

  // Cleanup test scratch directory
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });

  console.log('  ✓ Terminal run rep logging and ratio updates without repeated summary popups verified!\n');
}
