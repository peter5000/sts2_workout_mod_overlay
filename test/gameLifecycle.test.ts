import { DebtLedger } from '../src/daemon/ledger';
import { PersistenceManager } from '../src/daemon/persistence';
import { normalizeSaveData } from '../src/daemon/adapter';
import { RawRunSaveData, RawFloorEntry } from '../src/shared/types';
import fs from 'fs';
import path from 'path';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ [ASSERTION FAILED] ${message}`);
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

export function runGameLifecycleTests() {
  console.log('🧪 Running Game Start & Game End Lifecycle Unit Tests...');

  const testDir = path.join(__dirname, 'scratch_lifecycle_test');
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });

  const persistence = new PersistenceManager(testDir);

  // ==========================================
  // 1. GAME START: Fresh Run Initial State
  // ==========================================
  const ledger = new DebtLedger(persistence);

  const initialRunSave: RawRunSaveData = {
    run_id: 'lifecycle_run_alpha',
    is_multiplayer: true,
    player_count: 2,
    players: [
      { index: 0, name: 'HostPlayer', character: 'DEFECT' },
      { index: 1, name: 'AllyPlayer', character: 'REGENT' }
    ],
    run_status: 'ACTIVE',
    floors: [],
    current_floor: 0,
    in_reward_stage: false
  };

  const startResult = ledger.processSaveData(initialRunSave);
  assert(startResult.isNewRun === true, 'Starting fresh run must flag isNewRun === true');
  assert(startResult.commitData === null, 'Starting fresh run must not produce commitData');
  assert(startResult.terminatedEvent === null, 'Starting fresh run must not produce terminatedEvent');

  let state = ledger.getFullState();
  assert(state.run_id === 'lifecycle_run_alpha', 'run_id must match starting run');
  assert(state.last_processed_floor === 0, 'last_processed_floor must initialize to 0');
  assert(state.player_debts[0] === 0 && state.player_debts[1] === 0, 'All player debts must initialize to 0');
  assert(state.player_deaths[0] === 0 && state.player_deaths[1] === 0, 'All player deaths must initialize to 0');
  assert(state.player_aggregates[0].accrued === 0 && state.player_aggregates[1].accrued === 0, 'Aggregates must be 0');
  assert(state.player_names?.[0] === 'HostPlayer', 'Player 0 name should be HostPlayer');
  assert(state.player_names?.[1] === 'AllyPlayer', 'Player 1 name should be AllyPlayer');
  assert(state.run_status === 'ACTIVE', 'Run status must initialize to ACTIVE');
  assert(state.jog_penalty.active === false, 'Jog penalty must be inactive at start');
  console.log('  ✓ Game start fresh run initialization verified');

  // Floor 1 Neow Room (Act 0 start room with 0 combat turns)
  const floor1Neow: RawFloorEntry = {
    floor_num: 1,
    room_type: 'event',
    total_combat_turns: 0,
    player_metrics: [
      { player_index: 0, player_name: 'HostPlayer', hp_start: 75, hp_end: 75, died_this_floor: false, death_turn: null },
      { player_index: 1, player_name: 'AllyPlayer', hp_start: 70, hp_end: 70, died_this_floor: false, death_turn: null }
    ]
  };

  ledger.processSaveData({
    ...initialRunSave,
    floors: [floor1Neow],
    current_floor: 1
  });

  state = ledger.getFullState();
  assert(state.player_debts[0] === 0 && state.player_debts[1] === 0, 'Neow floor 1 event must accrue 0 debt');
  assert(state.last_processed_floor === 1, 'last_processed_floor must be 1 after Neow room');
  console.log('  ✓ Game start Act 0 Neow room zero-debt baseline verified');

  // ==========================================
  // 2. GAME START: Multi-Run Session Isolation
  // ==========================================
  // Advance Run Alpha through a combat floor (Floor 2: 4 turns, 10 HP loss -> 4*2 + 10 = 18 wc)
  const floor2Combat: RawFloorEntry = {
    floor_num: 2,
    room_type: 'monster',
    total_combat_turns: 4,
    player_metrics: [
      { player_index: 0, player_name: 'HostPlayer', hp_start: 75, hp_end: 65, died_this_floor: false, death_turn: null },
      { player_index: 1, player_name: 'AllyPlayer', hp_start: 70, hp_end: 60, died_this_floor: false, death_turn: null }
    ]
  };

  ledger.processSaveData({
    ...initialRunSave,
    floors: [floor1Neow, floor2Combat],
    current_floor: 2,
    in_reward_stage: false
  });

  assert(ledger.getFullState().player_debts[0] === 18, 'Run Alpha HostPlayer debt should be 18 wc');

  // Player starts a brand new Run Beta (e.g. restarts or new lobby)
  const runBetaSave: RawRunSaveData = {
    run_id: 'lifecycle_run_beta',
    is_multiplayer: false,
    player_count: 1,
    players: [{ index: 0, name: 'HostPlayer', character: 'IRONCLAD' }],
    run_status: 'ACTIVE',
    floors: [],
    current_floor: 0,
    in_reward_stage: false
  };

  const betaStartResult = ledger.processSaveData(runBetaSave);
  assert(betaStartResult.isNewRun === true, 'Switching to Run Beta must flag isNewRun === true');
  const betaState = ledger.getFullState();
  assert(betaState.run_id === 'lifecycle_run_beta', 'Active run must now be Run Beta');
  assert(betaState.player_debts[0] === 0, 'Run Beta must start with 0 debt (no leakage from Run Alpha)');
  assert(betaState.last_processed_floor === 0, 'Run Beta last_processed_floor must start at 0');

  // Switch back to Run Alpha: state must be fully restored from session store
  const switchBackResult = ledger.processSaveData({
    ...initialRunSave,
    floors: [floor1Neow, floor2Combat],
    current_floor: 2
  });
  assert(switchBackResult.isNewRun === false, 'Switching back to existing Run Alpha must not be isNewRun');
  const restoredAlpha = ledger.getFullState();
  assert(restoredAlpha.run_id === 'lifecycle_run_alpha', 'Active run must restore to Run Alpha');
  assert(restoredAlpha.player_debts[0] === 18, 'Run Alpha restored debt must be 18 wc');
  console.log('  ✓ Game start multi-run session isolation & state restoration verified');

  // ==========================================
  // 3. GAME END: Defeat Lifecycle
  // ==========================================
  const defeatLedger = new DebtLedger(persistence);

  const defeatRunSave: RawRunSaveData = {
    run_id: 'lifecycle_defeat_run',
    is_multiplayer: false,
    player_count: 1,
    players: [{ index: 0, name: 'HostPlayer', character: 'DEFECT' }],
    run_status: 'ACTIVE',
    floors: [floor1Neow, floor2Combat], // 18 wc accrued on floor 2
    current_floor: 2,
    in_reward_stage: false
  };

  defeatLedger.processSaveData(defeatRunSave);
  assert(defeatLedger.getFullState().player_debts[0] === 18, 'Pre-defeat debt should be 18 wc');

  // Floor 3 Wipe combat: 5 turns, 65 HP loss, died.
  const floor3Wipe: RawFloorEntry = {
    floor_num: 3,
    room_type: 'elite',
    total_combat_turns: 5,
    player_metrics: [
      { player_index: 0, player_name: 'HostPlayer', hp_start: 65, hp_end: 0, died_this_floor: true, death_turn: 5 }
    ]
  };

  const { commitData: defeatCommit, terminatedEvent: defeatTerminated } = defeatLedger.processSaveData({
    run_id: 'lifecycle_defeat_run',
    is_multiplayer: false,
    player_count: 1,
    players: [{ index: 0, name: 'HostPlayer', character: 'DEFECT' }],
    run_status: 'DEFEAT',
    floors: [floor1Neow, floor2Combat, floor3Wipe],
    current_floor: 3,
    in_reward_stage: false
  });

  assert(!!defeatTerminated, 'Defeat outcome must emit terminatedEvent');
  assert(defeatTerminated!.data.outcome === 'DEFEAT', 'Terminated event outcome must be DEFEAT');
  const defeatState = defeatLedger.getFullState();
  assert(defeatState.run_status === 'DEFEAT', 'run_status must transition to DEFEAT');
  // Defeat Waiver: Floor 3 wipe combat adds 0 wc! Total debt remains 18 wc.
  assert(defeatState.player_debts[0] === 18, `Defeat wipe combat must be waived (expected 18 wc, got ${defeatState.player_debts[0]})`);
  // 24-hour jog penalty must activate
  assert(defeatState.jog_penalty.active === true, 'Jog penalty must be ACTIVE on DEFEAT');
  assert(defeatState.jog_penalty.deadline_timestamp !== null, 'Jog penalty deadline must be set');
  const deadlineDiff = defeatState.jog_penalty.deadline_timestamp! - Date.now();
  assert(deadlineDiff > 23 * 3600 * 1000 && deadlineDiff <= 24 * 3600 * 1000 + 1000, 'Jog deadline must be ~24h in future');
  console.log('  ✓ Game end DEFEAT wipe combat waiver & 24h jog penalty verified');

  // Abandoned run normalization to DEFEAT
  const abandonedRaw = {
    run_id: 'lifecycle_abandon_run',
    was_abandoned: true,
    players: [{ id: 1, name: 'HostPlayer' }],
    map_point_history: []
  };
  const normalizedAbandoned = normalizeSaveData(abandonedRaw);
  assert(normalizedAbandoned.run_status === 'DEFEAT', 'was_abandoned: true must normalize to DEFEAT');
  console.log('  ✓ Game end abandoned run normalization to DEFEAT verified');

  // ==========================================
  // 4. GAME END: Victory Lifecycle
  // ==========================================
  const victoryLedger = new DebtLedger(persistence);

  const floor49FinalBoss: RawFloorEntry = {
    floor_num: 49,
    room_type: 'boss',
    total_combat_turns: 6,
    player_metrics: [
      { player_index: 0, player_name: 'HostPlayer', hp_start: 75, hp_end: 39, died_this_floor: false, death_turn: null }, // 6*2 + 36 = 48 wc
      { player_index: 1, player_name: 'AllyPlayer', hp_start: 70, hp_end: 45, died_this_floor: false, death_turn: null } // 6*2 + 25 = 37 wc
    ]
  };

  // State A: Boss combat ends and party is on victory/reward screen (pending commit)
  victoryLedger.processSaveData({
    run_id: 'lifecycle_victory_run',
    is_multiplayer: true,
    player_count: 2,
    players: [
      { index: 0, name: 'HostPlayer', character: 'DEFECT' },
      { index: 1, name: 'AllyPlayer', character: 'REGENT' }
    ],
    run_status: 'ACTIVE',
    floors: [floor49FinalBoss],
    current_floor: 49,
    in_reward_stage: true
  });

  let victState = victoryLedger.getFullState();
  assert(victState.pending_player_floors?.[0]?.wc === 48, 'HostPlayer pending boss wc should be 48');
  assert(victState.pending_player_floors?.[1]?.wc === 37, 'AllyPlayer pending boss wc should be 37');
  assert(victState.player_debts[0] === 0, 'Debt not yet committed during rewards');

  // State B: Game transitions to VICTORY (e.g. cutscene / score screen) WITHOUT players manually committing
  const { commitData: victCommit, terminatedEvent: victTerminated } = victoryLedger.processSaveData({
    run_id: 'lifecycle_victory_run',
    is_multiplayer: true,
    player_count: 2,
    players: [
      { index: 0, name: 'HostPlayer', character: 'DEFECT' },
      { index: 1, name: 'AllyPlayer', character: 'REGENT' }
    ],
    run_status: 'VICTORY',
    floors: [floor49FinalBoss],
    current_floor: 49,
    in_reward_stage: false
  });

  assert(!!victCommit, 'VICTORY must auto-commit all pending players');
  assert(victCommit!.floor === 49, 'Committed floor should be 49');
  assert(!!victTerminated, 'VICTORY must emit terminatedEvent');
  assert(victTerminated!.data.outcome === 'VICTORY', 'Outcome must be VICTORY');

  victState = victoryLedger.getFullState();
  assert(victState.run_status === 'VICTORY', 'run_status must be VICTORY');
  assert(victState.player_debts[0] === 48, `HostPlayer debt must accrue boss wc (48 wc), got ${victState.player_debts[0]}`);
  assert(victState.player_debts[1] === 37, `AllyPlayer debt must accrue boss wc (37 wc), got ${victState.player_debts[1]}`);
  assert(victState.player_aggregates[0].accrued === 48, 'HostPlayer aggregate accrued should be 48');
  assert(victState.player_aggregates[1].accrued === 37, 'AllyPlayer aggregate accrued should be 37');
  assert(victState.jog_penalty.active === false, 'Jog penalty must NOT be active on VICTORY');
  assert(Object.keys(victState.pending_player_floors || {}).length === 0, 'pending_player_floors must be cleared');
  console.log('  ✓ Game end VICTORY pending boss auto-commit & full wc accrual verified');

  // Cleanup test scratch directory
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });

  console.log('  ✓ All Game Start & Game End lifecycle tests passed cleanly!\n');
}
