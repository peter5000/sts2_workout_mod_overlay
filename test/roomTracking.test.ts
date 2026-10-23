import { normalizeSaveData } from '../src/daemon/adapter';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ [ASSERTION FAILED] ${message}`);
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

export function runRoomTrackingTests() {
  console.log('🧪 Running Room & Floor Tracking Unit Tests...');

  // 1. Act 0 active combat room
  // map_point_history has 3 rooms completed. visited_map_coords has 4 nodes (currently on floor 4).
  // pre_finished_room is null (mid-combat, not reward screen).
  const saveAct0Combat = {
    run_id: 'test_act0_combat',
    current_act_index: 0,
    map_point_history: [
      [
        { map_point_type: 'monster', player_stats: [{ current_hp: 80, max_hp: 80, damage_taken: 0, player_id: 1 }], rooms: [{ room_type: 'monster', turns_taken: 3 }] },
        { map_point_type: 'monster', player_stats: [{ current_hp: 75, max_hp: 80, damage_taken: 5, player_id: 1 }], rooms: [{ room_type: 'monster', turns_taken: 4 }] },
        { map_point_type: 'event', player_stats: [{ current_hp: 75, max_hp: 80, damage_taken: 0, player_id: 1 }], rooms: [{ room_type: 'event', turns_taken: 0 }] }
      ]
    ],
    visited_map_coords: [{ col: 0, row: 0 }, { col: 1, row: 1 }, { col: 1, row: 2 }, { col: 2, row: 3 }],
    pre_finished_room: null,
    players: [{ id: 1, name: 'Hero' }],
    character: 'IRONCLAD'
  };

  const norm1 = normalizeSaveData(saveAct0Combat);
  assert(norm1.current_floor === 4, `Mid-combat floor should be 4, got ${norm1.current_floor}`);
  assert(norm1.in_reward_stage === false, 'Mid-combat room must have in_reward_stage === false');
  assert(norm1.floors.length === 3, `Completed floors in history should be 3, got ${norm1.floors.length}`);
  console.log('  ✓ Act 0 active combat floor tracking verified');

  // 2. Act 0 combat reward screen
  // Player completed combat on floor 4. StS2 appends floor 4 to map_point_history AND sets pre_finished_room.
  const saveAct0Reward = {
    ...saveAct0Combat,
    map_point_history: [
      [
        ...saveAct0Combat.map_point_history[0],
        { map_point_type: 'monster', player_stats: [{ current_hp: 60, max_hp: 80, damage_taken: 15, player_id: 1 }], rooms: [{ room_type: 'monster', turns_taken: 5 }] }
      ]
    ],
    pre_finished_room: { is_pre_finished: true }
  };

  const norm2 = normalizeSaveData(saveAct0Reward);
  assert(norm2.current_floor === 4, `Reward screen floor should be 4, got ${norm2.current_floor}`);
  assert(norm2.in_reward_stage === true, 'Reward screen must have in_reward_stage === true');
  assert(norm2.floors.length === 4, `Floors should be 4, got ${norm2.floors.length}`);
  console.log('  ✓ Act 0 combat reward stage detection verified');

  // 3. Act 0 non-combat node entry (Event / Campfire / Shop)
  // Player picked rewards on floor 4 and selected floor 5 (campfire).
  // In StS2, non-combat rooms are NOT appended to map_point_history until exit!
  // So map_point_history still has 4 rooms, but visited_map_coords has 5 nodes. pre_finished_room is null.
  const saveAct0Campfire = {
    ...saveAct0Reward,
    visited_map_coords: [...saveAct0Combat.visited_map_coords, { col: 2, row: 4 }],
    pre_finished_room: null
  };

  const norm3 = normalizeSaveData(saveAct0Campfire);
  assert(norm3.current_floor === 5, `Entering campfire should track current_floor as 5, got ${norm3.current_floor}`);
  assert(norm3.in_reward_stage === false, 'Campfire mid-room must have in_reward_stage === false');
  assert(norm3.floors.length === 4, `Floors length before exit remains 4, got ${norm3.floors.length}`);
  console.log('  ✓ Act 0 non-combat mid-room floor derivation verified');

  // 4. Multi-Act floor tracking (Act 1 / Act 2 transition)
  // Act 0 completed with 17 floors.
  // Currently in Act 1 (current_act_index = 1).
  // Act 1 map_point_history has 2 rooms completed (Floors 18, 19).
  // visited_map_coords has 3 nodes (Floor 20 event room).
  const saveMultiAct = {
    run_id: 'test_multi_act_tracking',
    current_act_index: 1,
    map_point_history: [
      new Array(17).fill({ map_point_type: 'monster', player_stats: [{ current_hp: 80, max_hp: 80, damage_taken: 0, player_id: 1 }], rooms: [{ room_type: 'monster', turns_taken: 2 }] }),
      [
        { map_point_type: 'ancient', player_stats: [{ current_hp: 80, max_hp: 80, damage_taken: 0, player_id: 1 }], rooms: [{ room_type: 'event', turns_taken: 0 }] },
        { map_point_type: 'monster', player_stats: [{ current_hp: 70, max_hp: 80, damage_taken: 10, player_id: 1 }], rooms: [{ room_type: 'monster', turns_taken: 5 }] }
      ]
    ],
    visited_map_coords: [{ col: 3, row: 0 }, { col: 0, row: 1 }, { col: 0, row: 2 }],
    pre_finished_room: null,
    players: [{ id: 1, name: 'Hero' }],
    character: 'DEFECT'
  };

  const norm4 = normalizeSaveData(saveMultiAct);
  assert(norm4.current_floor === 20, `Multi-act current_floor should be 17 + 3 = 20, got ${norm4.current_floor}`);
  assert(norm4.in_reward_stage === false, 'Event room should have in_reward_stage === false');
  assert(norm4.floors.length === 19, `map_point_history floors should be 19, got ${norm4.floors.length}`);
  console.log('  ✓ Multi-act room tracking (Act 1 + Act 2) verified');

  // 5. Explicit RawRunSaveData format pass-through
  const directData = {
    run_id: 'direct_run',
    is_multiplayer: false,
    player_count: 1,
    players: [{ index: 0, name: 'Player' }],
    floors: [{ floor_num: 1, room_type: 'monster', total_combat_turns: 3, player_metrics: [] }],
    run_status: 'ACTIVE' as const,
    current_floor: 2,
    in_reward_stage: false
  };

  const norm5 = normalizeSaveData(directData);
  assert(norm5.current_floor === 2, `Direct current_floor should pass through as 2, got ${norm5.current_floor}`);
  assert(norm5.in_reward_stage === false, `Direct in_reward_stage should pass through as false, got ${norm5.in_reward_stage}`);
  console.log('  ✓ RawRunSaveData format pass-through verified');

  console.log('  ✓ All Room & Floor Tracking tests passed cleanly!\n');
}
