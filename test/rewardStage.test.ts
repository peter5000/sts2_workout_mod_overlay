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

export function runRewardStageTests() {
  console.log('🧪 Running Reward Stage & Commit Banner Lifecycle Tests...');

  const testDir = path.join(__dirname, 'scratch_reward_stage_test');
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });

  const persistence = new PersistenceManager(testDir);
  const ledger = new DebtLedger(persistence);

  const floor1: RawFloorEntry = {
    floor_num: 1,
    room_type: 'elite',
    total_combat_turns: 5,
    player_metrics: [
      {
        player_index: 0,
        player_name: 'Player 1',
        hp_start: 75,
        hp_end: 60,
        died_this_floor: false,
        death_turn: null
      }
    ]
  };

  // 1. Reward Stage Entry Detection
  // Combat ends and game writes checkpoint with in_reward_stage = true
  const saveRewardStage: RawRunSaveData = {
    run_id: 'test_reward_lifecycle',
    is_multiplayer: false,
    player_count: 1,
    players: [{ index: 0, name: 'Player 1', character: 'IRONCLAD' }],
    run_status: 'ACTIVE',
    floors: [floor1],
    current_floor: 1,
    in_reward_stage: true
  };

  const { rewardStageEntered, commitData } = ledger.processSaveData(saveRewardStage);

  assert(!!rewardStageEntered, 'ledger must detect rewardStageEntered when entering combat rewards');
  assert(rewardStageEntered!.floor === 1, `rewardStageEntered floor should be 1, got ${rewardStageEntered!.floor}`);
  assert(rewardStageEntered!.room_type === 'elite', `rewardStageEntered room_type should be elite, got ${rewardStageEntered!.room_type}`);
  assert(commitData === null, 'commitData must be null during active reward stage (pending commit)');

  const state1 = ledger.getFullState();
  assert(state1.pending_player_floors?.[0]?.floor_num === 1, 'Floor 1 must be pending');
  assert(state1.pending_player_floors?.[0]?.committed === false, 'Floor 1 pending must have committed === false');
  assert(state1.pending_player_floors?.[0]?.wc === 25, 'Floor 1 pending wc should be 25 (5*2 + 15)');
  assert(state1.player_debts[0] === 0, 'Debt must not be committed yet during reward stage');
  console.log('  ✓ Reward stage entry detection and pending state verified');

  // 2. Manual Commit During Reward Stage
  const manualCommit = ledger.commitPendingFloor(0);
  assert(!!manualCommit, 'Manual commit during rewards should succeed');
  assert(manualCommit!.floor === 1, 'Manual commit should return floor 1');

  const state2 = ledger.getFullState();
  assert(state2.player_debts[0] === 25, `Player debt must be 25 after manual commit, got ${state2.player_debts[0]}`);
  assert(state2.pending_player_floors?.[0]?.committed === true, 'Pending floor should be marked committed');
  console.log('  ✓ Manual commit during reward stage verified');

  // 3. Advancing to Next Floor Clears Pending Banner
  const floor2Event: RawFloorEntry = {
    floor_num: 2,
    room_type: 'event',
    total_combat_turns: 0,
    player_metrics: [
      {
        player_index: 0,
        player_name: 'Player 1',
        hp_start: 60,
        hp_end: 60,
        died_this_floor: false,
        death_turn: null
      }
    ]
  };

  const saveNextFloor: RawRunSaveData = {
    run_id: 'test_reward_lifecycle',
    is_multiplayer: false,
    player_count: 1,
    players: [{ index: 0, name: 'Player 1', character: 'IRONCLAD' }],
    run_status: 'ACTIVE',
    floors: [floor1, floor2Event],
    current_floor: 2,
    in_reward_stage: false
  };

  ledger.processSaveData(saveNextFloor);
  const state3 = ledger.getFullState();
  assert(Object.keys(state3.pending_player_floors || {}).length === 0, 'pending_player_floors must be empty on next floor');
  assert(state3.last_processed_floor === 2, `last_processed_floor should be 2, got ${state3.last_processed_floor}`);
  assert(state3.player_debts[0] === 25, 'Debt should remain 25');
  console.log('  ✓ Advancing to next floor clears pending banner verified');

  // Cleanup test scratch directory
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });

  console.log('  ✓ All Reward Stage & Commit Banner Lifecycle tests passed cleanly!\n');
}
