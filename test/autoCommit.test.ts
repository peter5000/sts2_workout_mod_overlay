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

export function runAutoCommitTests() {
  console.log('🧪 Running Auto-Commit Unit Tests...');

  const testDir = path.join(__dirname, 'scratch_autocommit_test');
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });

  const persistence = new PersistenceManager(testDir);

  // 1. Single Player: Combat Reward Stage Pending -> Moving to Next Floor Auto-Commits
  const ledger1 = new DebtLedger(persistence);

  const floor1Combat: RawFloorEntry = {
    floor_num: 1,
    room_type: 'monster',
    total_combat_turns: 4,
    player_metrics: [{ player_index: 0, player_name: 'Hero', hp_start: 80, hp_end: 65, died_this_floor: false, death_turn: null }]
  };

  // State A: Sitting in Floor 1 reward screen (4 turns * 2 + 15 dmg = 23 wc)
  ledger1.processSaveData({
    run_id: 'test_autocommit_run_1',
    is_multiplayer: false,
    player_count: 1,
    players: [{ index: 0, name: 'Hero', character: 'IRONCLAD' }],
    run_status: 'ACTIVE',
    floors: [floor1Combat],
    current_floor: 1,
    in_reward_stage: true
  });

  let state1 = ledger1.getFullState();
  assert(state1.pending_player_floors?.[0]?.floor_num === 1, 'Floor 1 should be pending during reward stage');
  assert(state1.pending_player_floors?.[0]?.wc === 23, 'Floor 1 pending wc should be 23');
  assert(state1.pending_player_floors?.[0]?.committed === false, 'Floor 1 pending committed should be false');
  assert(state1.player_debts[0] === 0, 'Debt should not be accrued before commit');
  assert(state1.last_processed_floor === 0, 'last_processed_floor should remain 0 during rewards');

  // State B: Player moves to Floor 2 (Event room) WITHOUT manually committing
  // In StS2, Floor 2 event room is not yet in floors!
  const { commitData: commit1 } = ledger1.processSaveData({
    run_id: 'test_autocommit_run_1',
    is_multiplayer: false,
    player_count: 1,
    players: [{ index: 0, name: 'Hero', character: 'IRONCLAD' }],
    run_status: 'ACTIVE',
    floors: [floor1Combat], // Still only floor 1 in map history
    current_floor: 2,       // Visited node 2
    in_reward_stage: false  // Out of reward screen
  });

  assert(!!commit1, 'Advancing to Floor 2 must auto-commit Floor 1');
  assert(commit1!.floor === 1, `Auto-commit floor should be 1, got ${commit1!.floor}`);
  state1 = ledger1.getFullState();
  assert(state1.player_debts[0] === 23, `Player debt should have Floor 1 auto-committed (23 wc), got ${state1.player_debts[0]}`);
  assert(state1.last_processed_floor === 1, `last_processed_floor should advance to 1, got ${state1.last_processed_floor}`);
  assert(Object.keys(state1.pending_player_floors || {}).length === 0, 'pending_player_floors must be cleared after auto-commit');
  console.log('  ✓ Single-player combat reward -> next room auto-commit verified');

  // 2. Multiplayer Partial Manual Commit + Remaining Auto-Commit
  const ledger2 = new DebtLedger(persistence);

  const floor1MP: RawFloorEntry = {
    floor_num: 1,
    room_type: 'monster',
    total_combat_turns: 3,
    player_metrics: [
      { player_index: 0, player_name: 'Player 1', hp_start: 80, hp_end: 70, died_this_floor: false, death_turn: null }, // 3*2 + 10 = 16 wc
      { player_index: 1, player_name: 'Player 2', hp_start: 70, hp_end: 50, died_this_floor: false, death_turn: null }  // 3*2 + 20 = 26 wc
    ]
  };

  ledger2.processSaveData({
    run_id: 'test_autocommit_run_2',
    is_multiplayer: true,
    player_count: 2,
    players: [{ index: 0, name: 'Player 1', character: 'IRONCLAD' }, { index: 1, name: 'Player 2', character: 'SILENT' }],
    run_status: 'ACTIVE',
    floors: [floor1MP],
    current_floor: 1,
    in_reward_stage: true
  });

  // Player 0 manually commits early during rewards (wants to do push-ups immediately)
  const manualCommit = ledger2.commitPendingFloor(0);
  assert(!!manualCommit, 'Player 0 manual commit should succeed');
  let state2 = ledger2.getFullState();
  assert(state2.player_debts[0] === 16, `Player 0 debt should be 16 after manual commit, got ${state2.player_debts[0]}`);
  assert(state2.player_debts[1] === 0, `Player 1 debt should still be 0 before commit, got ${state2.player_debts[1]}`);
  assert(state2.pending_player_floors?.[0]?.committed === true, 'Player 0 pending should be marked committed');
  assert(state2.pending_player_floors?.[1]?.committed === false, 'Player 1 pending should remain uncommitted');

  // Party finishes picking rewards and steps onto Floor 2
  const { commitData: autoCommitMP } = ledger2.processSaveData({
    run_id: 'test_autocommit_run_2',
    is_multiplayer: true,
    player_count: 2,
    players: [{ index: 0, name: 'Player 1', character: 'IRONCLAD' }, { index: 1, name: 'Player 2', character: 'SILENT' }],
    run_status: 'ACTIVE',
    floors: [floor1MP],
    current_floor: 2,
    in_reward_stage: false
  });

  assert(!!autoCommitMP, 'Moving to floor 2 should produce commitData for remaining player');
  state2 = ledger2.getFullState();
  // Player 0 debt must NOT be double-counted! (stays 16)
  assert(state2.player_debts[0] === 16, `Player 0 debt must stay 16 (no double counting), got ${state2.player_debts[0]}`);
  // Player 1 debt should be auto-committed to 26
  assert(state2.player_debts[1] === 26, `Player 1 debt should be auto-committed to 26, got ${state2.player_debts[1]}`);
  assert(state2.last_processed_floor === 1, `last_processed_floor should be 1, got ${state2.last_processed_floor}`);
  assert(Object.keys(state2.pending_player_floors || {}).length === 0, 'pending_player_floors should be cleared');
  console.log('  ✓ Multiplayer partial manual commit + remaining auto-commit without double counting verified');

  // 3. Early Commit Lock-in vs Uncommitted Reward Healing
  const ledger3 = new DebtLedger(persistence);

  const floor1Combat3: RawFloorEntry = {
    floor_num: 1,
    room_type: 'monster',
    total_combat_turns: 5,
    player_metrics: [
      { player_index: 0, player_name: 'P1', hp_start: 80, hp_end: 60, died_this_floor: false, death_turn: null }, // 5*2 + 20 = 30 wc
      { player_index: 1, player_name: 'P2', hp_start: 80, hp_end: 60, died_this_floor: false, death_turn: null }  // 5*2 + 20 = 30 wc
    ]
  };

  ledger3.processSaveData({
    run_id: 'test_autocommit_run_3',
    is_multiplayer: true,
    player_count: 2,
    players: [{ index: 0, name: 'P1', character: 'IRONCLAD' }, { index: 1, name: 'P2', character: 'SILENT' }],
    run_status: 'ACTIVE',
    floors: [floor1Combat3],
    current_floor: 1,
    in_reward_stage: true
  });

  // P0 commits early
  ledger3.commitPendingFloor(0);

  // Both players heal 10 HP in reward screen (e.g. potion / relic)
  const floor1Healed: RawFloorEntry = {
    ...floor1Combat3,
    player_metrics: [
      { player_index: 0, player_name: 'P1', hp_start: 80, hp_end: 70, died_this_floor: false, death_turn: null }, // dmg 10
      { player_index: 1, player_name: 'P2', hp_start: 80, hp_end: 70, died_this_floor: false, death_turn: null }  // dmg 10
    ]
  };

  ledger3.processSaveData({
    run_id: 'test_autocommit_run_3',
    is_multiplayer: true,
    player_count: 2,
    players: [{ index: 0, name: 'P1', character: 'IRONCLAD' }, { index: 1, name: 'P2', character: 'SILENT' }],
    run_status: 'ACTIVE',
    floors: [floor1Healed],
    current_floor: 1,
    in_reward_stage: true
  });

  let state3 = ledger3.getFullState();
  // P0 debt locked at 30 wc (early commit lock-in rule)
  assert(state3.player_debts[0] === 30, `Committed P0 debt must remain locked at 30 wc, got ${state3.player_debts[0]}`);
  // P1 pending debt reduced from 30 to 20 wc (5*2 + 10 = 20 wc)
  assert(state3.pending_player_floors?.[1]?.wc === 20, `Uncommitted P1 pending debt should reduce to 20 wc, got ${state3.pending_player_floors?.[1]?.wc}`);

  // Party moves to floor 2 -> P1 auto-commits at 20 wc
  ledger3.processSaveData({
    run_id: 'test_autocommit_run_3',
    is_multiplayer: true,
    player_count: 2,
    players: [{ index: 0, name: 'P1', character: 'IRONCLAD' }, { index: 1, name: 'P2', character: 'SILENT' }],
    run_status: 'ACTIVE',
    floors: [floor1Healed],
    current_floor: 2,
    in_reward_stage: false
  });

  state3 = ledger3.getFullState();
  assert(state3.player_debts[0] === 30, `P0 debt stays 30, got ${state3.player_debts[0]}`);
  assert(state3.player_debts[1] === 20, `P1 debt auto-commits at reduced 20 wc, got ${state3.player_debts[1]}`);
  console.log('  ✓ Early commit lock-in vs reward healing auto-commit verified');

  // 4. Game Victory with Pending Boss Floor (e.g. Floor 49 Boss Reward Screen -> Run Victory)
  const ledger4 = new DebtLedger(persistence);

  const floor49Boss: RawFloorEntry = {
    floor_num: 49,
    room_type: 'boss',
    total_combat_turns: 6,
    player_metrics: [
      { player_index: 0, player_name: 'Hero', hp_start: 75, hp_end: 39, died_this_floor: false, death_turn: null } // 6*2 + 36 = 48 wc
    ]
  };

  // State A: Sitting in boss reward screen (pending 48 wc)
  ledger4.processSaveData({
    run_id: 'test_victory_pending_run',
    is_multiplayer: false,
    player_count: 1,
    players: [{ index: 0, name: 'Hero', character: 'DEFECT' }],
    run_status: 'ACTIVE',
    floors: [floor49Boss],
    current_floor: 49,
    in_reward_stage: true
  });

  let state4 = ledger4.getFullState();
  assert(state4.pending_player_floors?.[0]?.wc === 48, 'Floor 49 boss pending wc should be 48');
  assert(state4.pending_player_floors?.[0]?.committed === false, 'Floor 49 boss pending committed should be false');
  assert(state4.player_debts[0] === 0, 'Debt should not yet be committed');

  // State B: Game transitions to VICTORY without manual floor commit
  const { commitData: victoryCommit, terminatedEvent } = ledger4.processSaveData({
    run_id: 'test_victory_pending_run',
    is_multiplayer: false,
    player_count: 1,
    players: [{ index: 0, name: 'Hero', character: 'DEFECT' }],
    run_status: 'VICTORY',
    floors: [floor49Boss],
    current_floor: 49,
    in_reward_stage: false
  });

  assert(!!victoryCommit, 'Victory transition must trigger commitData for pending boss floor');
  assert(victoryCommit!.floor === 49, `Victory commit floor should be 49, got ${victoryCommit!.floor}`);
  assert(!!terminatedEvent, 'Victory transition must produce terminatedEvent');
  assert(terminatedEvent!.data.outcome === 'VICTORY', 'Outcome should be VICTORY');
  state4 = ledger4.getFullState();
  assert(state4.player_debts[0] === 48, `Player debt should have Floor 49 boss accrued (48 wc), got ${state4.player_debts[0]}`);
  assert(state4.last_processed_floor === 49, `last_processed_floor should advance to 49, got ${state4.last_processed_floor}`);
  assert(Object.keys(state4.pending_player_floors || {}).length === 0, 'pending_player_floors must be cleared upon victory');
  assert(state4.run_status === 'VICTORY', 'run_status should be VICTORY');
  console.log('  ✓ Game victory with pending boss floor auto-commit and wc accrual verified');

  // 5. Game Victory with Direct Final Floor (No Prior Reward State)
  const ledger5 = new DebtLedger(persistence);

  const { commitData: directVictoryCommit, terminatedEvent: directTerminated } = ledger5.processSaveData({
    run_id: 'test_direct_victory_run',
    is_multiplayer: false,
    player_count: 1,
    players: [{ index: 0, name: 'Hero', character: 'DEFECT' }],
    run_status: 'VICTORY',
    floors: [floor49Boss],
    current_floor: 49,
    in_reward_stage: false
  });

  assert(!!directVictoryCommit, 'Direct victory transition must produce commitData');
  assert(directVictoryCommit!.floor === 49, 'Direct victory floor should be 49');
  assert(!!directTerminated, 'Direct victory must produce terminatedEvent');
  assert(directTerminated!.data.outcome === 'VICTORY', 'Direct victory outcome should be VICTORY');
  const state5 = ledger5.getFullState();
  assert(state5.player_debts[0] === 48, `Direct victory must accrue full boss wc (48 wc), got ${state5.player_debts[0]}`);
  assert(state5.last_processed_floor === 49, 'last_processed_floor should be 49');
  console.log('  ✓ Game victory with direct final boss floor wc accrual verified');

  // Cleanup test scratch directory
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });

  console.log('  ✓ All Auto-Commit tests passed cleanly!\n');
}
