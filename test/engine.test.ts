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

  // Host clears remaining 16 wc with 32 squats (32 / 2 = 16 wc) -> remaining debt 0
  const res2 = ledger.resolveReps({ player_index: 0, action_type: 'CUSTOM_ENTRY', exercise: 'squats', reps: 32, applied_ratio: 2 });
  assert(res2.updatedDebt === 0, `Host remaining debt should be 0 after 32 squats, got ${res2.updatedDebt}`);

  console.log('  ✓ DebtLedger rep resolution verified');

  // 3. Test Defeat Jog Penalty Trigger
  const defeatSave: RawRunSaveData = {
    ...saveData,
    run_status: 'DEFEAT'
  };

  const { terminatedEvent } = ledger.processSaveData(defeatSave);
  assert(terminatedEvent !== null, 'Terminated event should be emitted on status transition to DEFEAT');
  assert(terminatedEvent?.data.jog_penalty_required === true, 'Jog penalty should be required on defeat');

  console.log('  ✓ Defeat 24h jog penalty trigger verified');

  // Cleanup test scratch directory
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });

  console.log('\n🎉 ALL UNIT & MATHEMATICAL VERIFICATION TESTS PASSED CLEANLY!\n');
}

runTests();
