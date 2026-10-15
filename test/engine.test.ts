import { FloorParser } from '../src/daemon/parser';
import { DebtLedger } from '../src/daemon/ledger';
import { PersistenceManager } from '../src/daemon/persistence';
import { RawRunSaveData, RawFloorEntry } from '../src/shared/types';
import fs from 'fs';
import path from 'path';
import { runLogReaderTests } from './logReader.test';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ [ASSERTION FAILED] ${message}`);
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

function runTests() {
  console.log('🧪 Running Engine Unit Tests...');
  runLogReaderTests();

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
  ledger.setPlayerSquatRatio(0, 3);
  assert(ledger.getPlayerRatio(1) === 2, 'Ally ratio must stay at default 2 when Host changes theirs');
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
  ledger.setPlayerSquatRatio(0, 2);
  const res2 = ledger.resolveReps({ player_index: 0, action_type: 'CUSTOM_ENTRY', exercise: 'squats', reps: 30, applied_ratio: 2 });
  assert(res2.updatedDebt === 0, `Host remaining debt should be 0 after 30 squats, got ${res2.updatedDebt}`);

  console.log('  ✓ DebtLedger rep resolution and fractional squat remainder tracking verified');

  // 3. Test Defeat Jog Penalty Trigger & Losing Combat Workout Waiver
  const defeatFloor: RawFloorEntry = {
    floor_num: 7,
    room_type: 'elite',
    total_combat_turns: 5,
    player_metrics: [
      { player_index: 0, player_name: 'Host', hp_start: 66, hp_end: 0, died_this_floor: true, death_turn: 5 },
      { player_index: 1, player_name: 'Ally', hp_start: 50, hp_end: 0, died_this_floor: true, death_turn: 4 }
    ]
  };

  const defeatSave: RawRunSaveData = {
    ...saveData,
    run_status: 'DEFEAT',
    floors: [floorData, defeatFloor]
  };

  const { commitData: defeatCommit, terminatedEvent } = ledger.processSaveData(defeatSave);
  assert(terminatedEvent !== null, 'Terminated event should be emitted on status transition to DEFEAT');
  assert(terminatedEvent?.data.jog_penalty_required === true, 'Jog penalty should be required on defeat');

  // Verify that workout counters for the final defeat combat are completely waived (wc = 0)
  assert(defeatCommit !== null, 'Defeat floor commit data should be generated');
  assert(defeatCommit!.players[0].evaluation.counters_added === 0, `Defeat combat wc should be 0, got ${defeatCommit!.players[0].evaluation.counters_added}`);
  assert(defeatCommit!.players[1].evaluation.counters_added === 0, `Defeat combat wc should be 0, got ${defeatCommit!.players[1].evaluation.counters_added}`);
  assert(defeatCommit!.players[0].evaluation.formula.includes('(Waived on Defeat)'), 'Formula should indicate waived on defeat');
  // Debt should remain unchanged from before this combat (Host debt was 0 after clearing, Ally debt remains unaffected by floor 7)
  assert(ledger.getFullState().player_debts[0] === 0, 'Host debt should not increase from defeat combat');

  console.log('  ✓ Defeat 24h jog penalty trigger and losing combat workout counter waiver verified');

  const hist = testPersistence.getHistoryStore();
  const runHist = hist.completed_runs.find((r) => r.run_id === 'test_run_unique_1');
  assert(!!runHist && (runHist.stage_history || []).length === 2, `Stage history should have 2 floor entries, got ${runHist?.stage_history?.length}`);
  assert(runHist!.total_squats === 33 && runHist!.total_pushups === 10, `History totals should be 10 pushups / 33 squats, got ${runHist!.total_pushups}/${runHist!.total_squats}`);
  console.log('  ✓ Per-floor stage history persisted to workout_history.json');

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
          player_stats: [{ player_id: 1, current_hp: 60, max_hp: 75, damage_taken: 0, hp_healed: 60 }]
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
  // Starting HP: Weary Traveler penalty ignored (hp_start = 60, hp_end = 60 -> 0 HP loss)
  assert(normalized.floors[0].player_metrics[0].hp_start === 60, `Floor 0 hp_start should be 60, got ${normalized.floors[0].player_metrics[0].hp_start}`);
  assert(normalized.floors[0].player_metrics[0].hp_end === 60, `Floor 0 hp_end should be 60`);

  // Relic damage test: Precarious Shears deals 16 damage on ancient floor
  const relicSaveData = {
    ...nativeSaveData,
    map_point_history: [
      [
        {
          map_point_type: 'ancient',
          rooms: [{ room_type: 'event', turns_taken: 0 }],
          player_stats: [{ player_id: 1, current_hp: 44, max_hp: 75, damage_taken: 16, hp_healed: 60 }]
        }
      ]
    ]
  };
  const normalizedRelic = normalizeSaveData(relicSaveData);
  assert(normalizedRelic.floors[0].player_metrics[0].hp_start === 60, `Relic floor hp_start should be 60`);
  assert(normalizedRelic.floors[0].player_metrics[0].hp_end === 44, `Relic floor hp_end should be 44`);
  const relicHpLost = normalizedRelic.floors[0].player_metrics[0].hp_start - normalizedRelic.floors[0].player_metrics[0].hp_end;
  assert(relicHpLost === 16, `Relic HP loss should be 16, got ${relicHpLost}`);

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

  // 6. Test 1-HP Revive Mid-Combat Death & Turn Freezing (Phantasmal Gardeners real case)
  // Player had 42 HP, took 41 dmg, died on turn 7. Teammate won on turn 11. Player revived to 1 HP.
  const reviveFloorData: RawFloorEntry = {
    floor_num: 12,
    room_type: 'elite',
    total_combat_turns: 11,
    player_metrics: [
      { player_index: 0, player_name: 'DeadRevivedPlayer', hp_start: 42, hp_end: 1, died_this_floor: true, death_turn: 7 },
      { player_index: 1, player_name: 'SurvivingTeammate', hp_start: 55, hp_end: 38, died_this_floor: false, death_turn: null }
    ]
  };

  const reviveDeaths = new Map<number, number>([[0, 0], [1, 0]]);
  const reviveDebts = new Map<number, number>([[0, 0], [1, 0]]);
  const reviveAggs = new Map<number, { accrued: number; pushups: number; squats: number }>();
  const reviveReports = FloorParser.parseFloor(reviveFloorData, reviveDeaths, reviveDebts, reviveAggs, 2);

  // DeadRevivedPlayer: frozen at 7 turns, 41 HP lost. wc = 7 * (2 + 0) + 41 = 14 + 41 = 55 wc (NOT 11 * 2 + 41 = 63)
  assert(reviveReports[0].evaluation.turns_taken_n === 7, `DeadRevivedPlayer turns should be frozen at 7, got ${reviveReports[0].evaluation.turns_taken_n}`);
  assert(reviveReports[0].evaluation.counters_added === 55, `DeadRevivedPlayer wc should be 55, got ${reviveReports[0].evaluation.counters_added}`);
  assert(reviveReports[0].evaluation.deaths_accumulated_d === 1, `DeadRevivedPlayer death count should increment to 1`);

  // Subsequent floor: death penalty applies (2 + 1) = 3
  const nextFloorData: RawFloorEntry = {
    floor_num: 13,
    room_type: 'monster',
    total_combat_turns: 4,
    player_metrics: [
      { player_index: 0, player_name: 'DeadRevivedPlayer', hp_start: 1, hp_end: 1, died_this_floor: false, death_turn: null },
      { player_index: 1, player_name: 'SurvivingTeammate', hp_start: 38, hp_end: 35, died_this_floor: false, death_turn: null }
    ]
  };
  const nextReports = FloorParser.parseFloor(nextFloorData, reviveDeaths, reviveDebts, reviveAggs, 2);
  // wc = 4 * (2 + 1) + 0 = 12
  assert(nextReports[0].evaluation.counters_added === 12, `Subsequent floor wc should be 12 (4 * 3), got ${nextReports[0].evaluation.counters_added}`);

  console.log('  ✓ 1-HP revive mid-combat death and subsequent floor penalty verified');

  // 7. Test Immediate Commit Lifecycle & Dynamic Reward Healing (No 1-floor lag!)
  const testLedger = new DebtLedger(testPersistence);
  const floor1: RawFloorEntry = {
    floor_num: 1,
    room_type: 'event',
    total_combat_turns: 0,
    player_metrics: [{ player_index: 0, player_name: 'Hero', hp_start: 80, hp_end: 80, died_this_floor: false, death_turn: null }]
  };
  const floor2: RawFloorEntry = {
    floor_num: 2,
    room_type: 'monster',
    total_combat_turns: 3,
    player_metrics: [{ player_index: 0, player_name: 'Hero', hp_start: 80, hp_end: 70, died_this_floor: false, death_turn: null }]
  };

  // Step A: Floor 2 completes combat (3 turns, 10 dmg -> 16 wc). Commits immediately upon combat end!
  testLedger.processSaveData({
    run_id: 'run_immediate_test',
    is_multiplayer: false,
    player_count: 1,
    players: [{ index: 0, name: 'Hero', character: 'IRONCLAD' }],
    run_status: 'ACTIVE',
    floors: [floor1, floor2]
  });
  let stateNow = testLedger.getFullState();
  assert(stateNow.player_debts[0] === 16, `Floor 2 should commit immediately (16 wc), got ${stateNow.player_debts[0]}`);

  // Step B: During rewards, player drinks a potion and heals 6 HP (hp_end becomes 76 instead of 70).
  // Ledger dynamically adjusts Floor 2 debt: 16 - 6 = 10 wc!
  const floor2Healed: RawFloorEntry = {
    ...floor2,
    player_metrics: [{ player_index: 0, player_name: 'Hero', hp_start: 80, hp_end: 76, died_this_floor: false, death_turn: null }]
  };
  testLedger.processSaveData({
    run_id: 'run_immediate_test',
    is_multiplayer: false,
    player_count: 1,
    players: [{ index: 0, name: 'Hero', character: 'IRONCLAD' }],
    run_status: 'ACTIVE',
    floors: [floor1, floor2Healed]
  });
  stateNow = testLedger.getFullState();
  assert(stateNow.player_debts[0] === 10, `Debt should dynamically reduce to 10 after 6 HP reward heal, got ${stateNow.player_debts[0]}`);

  // Step C: Player enters Floor 3 (4 turns, 10 dmg -> 18 wc). Commits immediately! Total debt: 10 + 18 = 28 wc.
  const floor3: RawFloorEntry = {
    floor_num: 3,
    room_type: 'monster',
    total_combat_turns: 4,
    player_metrics: [{ player_index: 0, player_name: 'Hero', hp_start: 76, hp_end: 66, died_this_floor: false, death_turn: null }]
  };
  testLedger.processSaveData({
    run_id: 'run_immediate_test',
    is_multiplayer: false,
    player_count: 1,
    players: [{ index: 0, name: 'Hero', character: 'IRONCLAD' }],
    run_status: 'ACTIVE',
    floors: [floor1, floor2Healed, floor3]
  });
  stateNow = testLedger.getFullState();
  assert(stateNow.player_debts[0] === 28, `Total debt should be 28, got ${stateNow.player_debts[0]}`);

  console.log('  ✓ Immediate commit (zero lag) and dynamic reward healing adjustment verified');

  // Cleanup test scratch directory
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });

  console.log('\n🎉 ALL UNIT & MATHEMATICAL VERIFICATION TESTS PASSED CLEANLY!\n');
}

runTests();
