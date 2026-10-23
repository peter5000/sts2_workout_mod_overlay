import { normalizeSaveData } from '../src/daemon/adapter';
import { DebtLedger } from '../src/daemon/ledger';
import { PersistenceManager } from '../src/daemon/persistence';
import { CombatDeathInfo } from '../src/daemon/logReader';
import fs from 'fs';
import path from 'path';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ [ASSERTION FAILED] ${message}`);
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

export function runDeathDetectionTests() {
  console.log('🧪 Running Death Detection & godot.log Verification Tests...');

  const testDir = path.join(__dirname, 'scratch_death_test');
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });

  const persistence = new PersistenceManager(testDir);

  // 1. godot.log is parsed after combat and sets log_parsed flag
  const mockLogWithDeath: CombatDeathInfo = {
    success: true,
    logFound: true,
    diedPlayers: new Set(['0']),
    deathTurns: { '0': 3 },
    playerLastTurns: { '0': 3 },
    maxCombatTurn: 5
  };

  const rawCombatFloor = {
    run_id: 'test_death_run_1',
    current_act_index: 0,
    map_point_history: [
      [
        {
          map_point_type: 'monster',
          player_stats: [{ current_hp: 0, max_hp: 75, damage_taken: 50, player_id: 0 }],
          rooms: [{ room_type: 'monster', turns_taken: 5 }]
        }
      ]
    ],
    visited_map_coords: [{ col: 0, row: 0 }],
    pre_finished_room: { is_pre_finished: true },
    players: [{ id: 0, name: 'Hero' }],
    character: 'IRONCLAD'
  };

  const normalizedWithDeath = normalizeSaveData(rawCombatFloor, mockLogWithDeath);
  assert(normalizedWithDeath.floors[0].log_parsed === true, 'log_parsed must be true when godot.log is successfully parsed');
  assert(normalizedWithDeath.floors[0].player_metrics[0].died_this_floor === true, 'Player must be marked dead from log');
  assert(normalizedWithDeath.floors[0].player_metrics[0].death_turn === 3, `Death turn should freeze at 3, got ${normalizedWithDeath.floors[0].player_metrics[0].death_turn}`);
  console.log('  ✓ godot.log parsing and log_parsed flag verified');

  // 2. Current combat death does NOT increase the penalty of that combat!
  // Player enters Floor 1 with 0 prior deaths.
  // Player dies on Turn 3 (75 max HP lost to 0).
  // Formula for Floor 1: turns(3) * (2 + 0 prior deaths) + 75 HP loss = 6 + 75 = 81 wc!
  // (NOT 3 * (2 + 1) + 75 = 9 + 75 = 84 wc).
  const ledger = new DebtLedger(persistence);
  ledger.processSaveData(normalizedWithDeath);

  let state = ledger.getFullState();
  assert(state.pending_player_floors?.[0]?.wc === 81, `Floor 1 wc must use 0 prior deaths (81 wc), got ${state.pending_player_floors?.[0]?.wc}`);
  assert(state.pending_player_floors?.[0]?.turns_taken === 3, 'Turns must be frozen at death turn 3');
  assert(state.player_deaths[0] === 0, 'player_deaths must remain 0 before Floor 1 is committed');

  // Move to Floor 2: Floor 1 commits. player_deaths advances to 1 for subsequent floors!
  const rawFloor2 = {
    ...rawCombatFloor,
    map_point_history: [
      [
        ...rawCombatFloor.map_point_history[0],
        {
          map_point_type: 'monster',
          player_stats: [{ current_hp: 30, max_hp: 75, damage_taken: 20, player_id: 0 }],
          rooms: [{ room_type: 'monster', turns_taken: 4 }]
        }
      ]
    ],
    visited_map_coords: [{ col: 0, row: 0 }, { col: 0, row: 1 }],
    pre_finished_room: { is_pre_finished: true }
  };

  const mockLogNoDeath: CombatDeathInfo = {
    success: true,
    logFound: true,
    diedPlayers: new Set(),
    deathTurns: {},
    playerLastTurns: { '0': 4 },
    maxCombatTurn: 4
  };

  ledger.processSaveData(normalizeSaveData(rawFloor2, mockLogNoDeath));
  state = ledger.getFullState();
  // Player death count is now 1 for Floor 2!
  assert(state.player_deaths[0] === 1, `player_deaths must be 1 on Floor 2, got ${state.player_deaths[0]}`);
  // Floor 2 formula: 4 turns * (2 + 1 death) + 0 HP loss (healed from 0 to 30) = 4 * 3 = 12 wc!
  assert(state.pending_player_floors?.[0]?.wc === 12, `Floor 2 wc must use 1 death penalty (12 wc), got ${state.pending_player_floors?.[0]?.wc}`);
  console.log('  ✓ Death in combat X does not increase penalty for combat X; applies to combat X+1 onward verified');

  // 3. Mid-combat revives (Fairy in the Bottle, Lizard Tail) do NOT count as deaths
  // Player dropped to 0 HP mid-combat but revived. godot.log has NO "died, doing death handling".
  const mockLogRevive: CombatDeathInfo = {
    success: true,
    logFound: true,
    diedPlayers: new Set(), // Godot did not log death handling
    deathTurns: {},
    playerLastTurns: { '0': 5 },
    maxCombatTurn: 5
  };

  const rawReviveFloor = {
    run_id: 'test_revive_run',
    current_act_index: 0,
    map_point_history: [
      [
        {
          map_point_type: 'monster',
          player_stats: [{ current_hp: 15, max_hp: 75, damage_taken: 70, player_id: 0 }],
          rooms: [{ room_type: 'monster', turns_taken: 5 }]
        }
      ]
    ],
    visited_map_coords: [{ col: 0, row: 0 }],
    pre_finished_room: { is_pre_finished: true },
    players: [{ id: 0, name: 'Hero' }],
    character: 'IRONCLAD'
  };

  const normRevive = normalizeSaveData(rawReviveFloor, mockLogRevive);
  assert(normRevive.floors[0].player_metrics[0].died_this_floor === false, 'Revive must NOT count as death');
  assert(normRevive.floors[0].player_metrics[0].death_turn === null, 'Revive must have death_turn === null');

  const reviveLedger = new DebtLedger(persistence);
  reviveLedger.processSaveData(normRevive);
  assert(reviveLedger.getFullState().player_deaths[0] === 0, 'Death counter must remain 0 after revive');
  console.log('  ✓ Fairy in the Bottle & Lizard Tail revives do not count as deaths verified');

  // 4. Zero HP in player_stats during reward screen does NOT trigger false death
  // StS2 leaves current_hp = 0, max_hp = 0 before reward picking
  const rawRewardStatsZero = {
    run_id: 'test_reward_zero_stats',
    current_act_index: 0,
    map_point_history: [
      [
        {
          map_point_type: 'elite',
          player_stats: [{ current_hp: 0, max_hp: 0, damage_taken: 5, player_id: 0 }],
          rooms: [{ room_type: 'elite', turns_taken: 4 }]
        }
      ]
    ],
    visited_map_coords: [{ col: 0, row: 0 }],
    pre_finished_room: { is_pre_finished: true },
    players: [{ id: 0, name: 'Hero', current_hp: 54, max_hp: 75 }],
    character: 'DEFECT'
  };

  const normRewardZero = normalizeSaveData(rawRewardStatsZero, mockLogNoDeath);
  assert(normRewardZero.floors[0].player_metrics[0].died_this_floor === false, 'Zero HP in reward stats must NOT trigger death when log has no death');

  const rewardZeroLedger = new DebtLedger(persistence);
  rewardZeroLedger.processSaveData(normRewardZero);
  assert(rewardZeroLedger.getFullState().player_deaths[0] === 0, 'Death counter must remain 0 during reward screen');
  console.log('  ✓ Reward screen uninitialized zero-HP immunity verified');

  // Cleanup test scratch directory
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });

  console.log('  ✓ All Death Detection & godot.log verification tests passed cleanly!\n');
}
