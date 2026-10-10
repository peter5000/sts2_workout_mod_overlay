import { FloorParser } from '../src/daemon/parser';
import { DebtLedger } from '../src/daemon/ledger';
import { PersistenceManager } from '../src/daemon/persistence';
import { RawRunSaveData, RawFloorEntry } from '../src/shared/types';
import fs from 'fs';
import path from 'path';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ [ASSERTION FAILED] ${message}`);
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

function runTests() {
  console.log('🧪 Running Engine Unit Tests...');

  const testDir = path.join(__dirname, 'scratch_test_dir');
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });

  const testPersistence = new PersistenceManager(testDir);

  // 1. Test FloorParser wc equation & turn freezing
  const floorData: RawFloorEntry = {
    floor_num: 6,
    room_type: 'boss',
    total_combat_turns: 6,
    player_metrics: [
      { player_index: 0, player_name: 'Host', hp_start: 80, hp_end: 66, died_this_floor: false, death_turn: null },
      { player_index: 1, player_name: 'Ally', hp_start: 50, hp_end: 0, died_this_floor: true, death_turn: 3 }
    ]
  };

  const deathsMap = new Map<number, number>([[0, 0], [1, 0]]);
  const debtsMap = new Map<number, number>([[0, 0], [1, 0]]);
  const aggsMap = new Map<number, { accrued: number; pushups: number; squats: number }>();

  const reports = FloorParser.parseFloor(floorData, deathsMap, debtsMap, aggsMap, 2);

  // Host: 6 turns * (2 + 0 deaths) + 14 HP lost = 12 + 14 = 26 wc
  assert(reports[0].evaluation.counters_added === 26, `Host wc should be 26, got ${reports[0].evaluation.counters_added}`);
  assert(reports[0].evaluation.turns_taken_n === 6, `Host turns should be 6, got ${reports[0].evaluation.turns_taken_n}`);

  // Ally (Turn Freezing): 3 turns (frozen at death) * (2 + 0 deaths) + 50 HP lost = 6 + 50 = 56 wc
  assert(reports[1].evaluation.counters_added === 56, `Ally wc should be 56, got ${reports[1].evaluation.counters_added}`);
  assert(reports[1].evaluation.turns_taken_n === 3, `Ally frozen turns should be 3, got ${reports[1].evaluation.turns_taken_n}`);
  assert(reports[1].evaluation.deaths_accumulated_d === 1, `Ally deaths should be 1`);

  console.log('  ✓ FloorParser turn freezing and wc calculation verified');

  // 2. Test Debt Ledger rep resolution with clean test persistence
  const ledger = new DebtLedger(testPersistence);

  const saveData: RawRunSaveData = {
    run_id: 'test_run_unique_1',
    is_multiplayer: true,
    player_count: 2,
    players: [{ index: 0, name: 'Host', character: 'IRONCLAD' }, { index: 1, name: 'Ally', character: 'SILENT' }],
    run_status: 'ACTIVE',
    floors: [floorData]
  };

  ledger.processSaveData(saveData);

  // Host initial debt should be 26
  const state = ledger.getFullState();
  assert(state.player_debts[0] === 26, `Host initial debt should be 26, got ${state.player_debts[0]}`);

  // Resolve reps: Host clears 26 wc with 10 pushups (26 - 10 = 16 wc)
  const res1 = ledger.resolveReps({ player_index: 0, action_type: 'CUSTOM_ENTRY', exercise: 'pushups', reps: 10 });
  assert(res1.updatedDebt === 16, `Host remaining debt should be 16 after 10 pushups, got ${res1.updatedDebt}`);

  // Test fractional squat remainder tracking with R = 3:
  // Debt is 16. Log 1 squat (R=3) -> debt 16, remainder 1.
  ledger.resolveReps({ player_index: 0, action_type: 'CUSTOM_ENTRY', exercise: 'squats', reps: 1, applied_ratio: 3 });
  assert(ledger.getFullState().player_debts[0] === 16, `Debt should remain 16 after 1 squat with R=3`);
  assert(ledger.getFullState().player_squat_remainders?.[0] === 1, `Squat remainder should be 1`);

  // Log 1 more squat (total 2) -> debt 16, remainder 2.
  ledger.resolveReps({ player_index: 0, action_type: 'CUSTOM_ENTRY', exercise: 'squats', reps: 1, applied_ratio: 3 });
  assert(ledger.getFullState().player_debts[0] === 16, `Debt should remain 16 after 2 squats with R=3`);
  assert(ledger.getFullState().player_squat_remainders?.[0] === 2, `Squat remainder should be 2`);

  // Log 1 more squat (total 3) -> debt should decrease from 16 to 15, remainder 0!
  const resFrac3 = ledger.resolveReps({ player_index: 0, action_type: 'CUSTOM_ENTRY', exercise: 'squats', reps: 1, applied_ratio: 3 });
  assert(resFrac3.updatedDebt === 15, `Debt should decrease to 15 after 3rd squat, got ${resFrac3.updatedDebt}`);
  assert(ledger.getFullState().player_squat_remainders?.[0] === 0, `Squat remainder should reset to 0`);

  // Host clears remaining 15 wc with 30 squats (30 / 2 = 15 wc with applied_ratio 2) -> remaining debt 0
  const res2 = ledger.resolveReps({ player_index: 0, action_type: 'CUSTOM_ENTRY', exercise: 'squats', reps: 30, applied_ratio: 2 });
  assert(res2.updatedDebt === 0, `Host remaining debt should be 0 after 30 squats, got ${res2.updatedDebt}`);

  console.log('  ✓ DebtLedger rep resolution and fractional squat remainder tracking verified');

  // 3. Test Defeat Jog Penalty Trigger
  const defeatSave: RawRunSaveData = {
    ...saveData,
    run_status: 'DEFEAT'
  };

  const { terminatedEvent } = ledger.processSaveData(defeatSave);
  assert(terminatedEvent !== null, 'Terminated event should be emitted on status transition to DEFEAT');
  assert(terminatedEvent?.data.jog_penalty_required === true, 'Jog penalty should be required on defeat');

  console.log('  ✓ Defeat 24h jog penalty trigger verified');

  // 4. Test Native Save File Adapter (normalizeSaveData)
  const { normalizeSaveData } = require('../src/daemon/adapter');
  const nativeSaveData = {
    start_time: 1791595114,
    game_mode: 'standard',
    players: [{ net_id: 1, character_id: 'CHARACTER.REGENT', current_hp: 51, max_hp: 75 }],
    map_point_history: [
      [
        {
          map_point_type: 'ancient',
          rooms: [{ room_type: 'event', turns_taken: 0 }],
          player_stats: [{ player_id: 1, current_hp: 60, damage_taken: 0, hp_healed: 60 }]
        },
        {
          map_point_type: 'monster',
          rooms: [{ room_type: 'monster', turns_taken: 4 }],
          player_stats: [{ player_id: 1, current_hp: 51, damage_taken: 9, hp_healed: 0 }]
        }
      ]
    ]
  };

  const normalized = normalizeSaveData(nativeSaveData);
  assert(normalized.run_id.startsWith('run_1791595114'), `run_id should start with run_1791595114, got ${normalized.run_id}`);
  assert(normalized.players.length === 1, `Players length should be 1`);
  assert(normalized.players[0].character === 'REGENT', `Character should be REGENT, got ${normalized.players[0].character}`);
  assert(normalized.floors.length === 2, `Floors count should be 2, got ${normalized.floors.length}`);
  assert(normalized.floors[1].room_type === 'monster', `Floor 2 room_type should be monster`);
  assert(normalized.floors[1].total_combat_turns === 4, `Floor 2 turns should be 4`);

  // Process normalized native save in DebtLedger without error
  const resNative = ledger.processSaveData(normalized);
  assert(resNative !== null, 'processSaveData should handle normalized native save cleanly');

  console.log('  ✓ Native StS2 save file adapter (normalizeSaveData) verified');

  // 5. Test Multi-Run Active Session Switching
  const run1: RawRunSaveData = {
    run_id: 'run_sp_100',
    is_multiplayer: false,
    player_count: 1,
    players: [{ index: 0, name: 'SP_Player', character: 'IRONCLAD' }],
    run_status: 'ACTIVE',
    floors: [floorData]
  };

  const run2: RawRunSaveData = {
    run_id: 'run_mp_200',
    is_multiplayer: true,
    player_count: 2,
    players: [{ index: 0, name: 'Host', character: 'IRONCLAD' }, { index: 1, name: 'Ally', character: 'SILENT' }],
    run_status: 'ACTIVE',
    floors: [floorData]
  };

  const multiLedger = new DebtLedger(testPersistence);
  
  // Start SP run 1, log 10 pushups
  multiLedger.processSaveData(run1);
  multiLedger.resolveReps({ player_index: 0, action_type: 'CUSTOM_ENTRY', exercise: 'pushups', reps: 10 });
  assert(multiLedger.getFullState().run_id === 'run_sp_100', 'Active run should be run_sp_100');
  assert(multiLedger.getFullState().player_aggregates[0].pushups === 10, 'SP pushups should be 10');

  // Switch to MP run 2
  multiLedger.processSaveData(run2);
  assert(multiLedger.getFullState().run_id === 'run_mp_200', 'Active run should switch to run_mp_200');
  assert(multiLedger.getFullState().player_aggregates[0].pushups === 0, 'MP initial pushups should be 0');
  multiLedger.resolveReps({ player_index: 0, action_type: 'CUSTOM_ENTRY', exercise: 'pushups', reps: 5 });

  // Switch back to SP run 1 -> SP progress restored!
  multiLedger.processSaveData(run1);
  assert(multiLedger.getFullState().run_id === 'run_sp_100', 'Active run should restore to run_sp_100');
  assert(multiLedger.getFullState().player_aggregates[0].pushups === 10, 'SP pushups should be restored to 10');

  console.log('  ✓ Multi-run active session switching and state persistence verified');

  // Cleanup test scratch directory
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });

  console.log('\n🎉 ALL UNIT & MATHEMATICAL VERIFICATION TESTS PASSED CLEANLY!\n');
}

runTests();
