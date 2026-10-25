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

  // 6. Start of Act Floor (Neow room):
  // Player 0 takes Precarious Shears relic (16 damage taken, 56 hp healed).
  // Player 1 takes Wish relic (9 Max HP lost, 0 damage taken, 56 hp healed).
  // Both penalties must accrue as wc and MUST NOT be mitigated by the 56 act-start heal!
  const saveNeowActStart = {
    run_id: 'test_neow_act_start',
    current_act_index: 0,
    map_point_history: [
      [
        {
          map_point_type: 'ancient',
          rooms: [{ room_type: 'event', turns_taken: 0 }],
          player_stats: [
            { player_id: '10000000000000001', current_hp: 40, max_hp: 70, damage_taken: 16, hp_healed: 56, max_hp_lost: 0 },
            { player_id: '10000000000000002', current_hp: 56, max_hp: 61, damage_taken: 0, hp_healed: 56, max_hp_lost: 9 }
          ]
        },
        {
          map_point_type: 'monster',
          rooms: [{ room_type: 'monster', turns_taken: 4 }],
          player_stats: [
            { player_id: '10000000000000001', current_hp: 36, max_hp: 70, damage_taken: 4, hp_healed: 0, max_hp_lost: 0 },
            { player_id: '10000000000000002', current_hp: 52, max_hp: 61, damage_taken: 4, hp_healed: 0, max_hp_lost: 0 }
          ]
        }
      ]
    ],
    visited_map_coords: [{ col: 0, row: 0 }, { col: 0, row: 1 }],
    pre_finished_room: null,
    players: [
      { id: '10000000000000001', name: 'PlayerOne' },
      { id: '10000000000000002', name: 'PlayerTwo' }
    ],
    character: 'SILENT'
  };

  const norm6 = normalizeSaveData(saveNeowActStart);
  assert(norm6.floors.length === 2, `Floors should be 2, got ${norm6.floors.length}`);
  
  // Floor 1 (Neow room):
  const f1p0 = norm6.floors[0].player_metrics[0];
  const f1p1 = norm6.floors[0].player_metrics[1];
  const p0Loss = f1p0.hp_start - f1p0.hp_end;
  const p1Loss = f1p1.hp_start - f1p1.hp_end;
  assert(p0Loss === 16, `Player 0 relic damage should accrue 16 wc penalty (ignoring heal), got ${p0Loss}`);
  assert(p1Loss === 0, `Player 1 Max HP loss without current HP reduction should accrue 0 wc penalty, got ${p1Loss}`);

  // Floor 2 (Subsequent combat encounter):
  // Verifies that next floor uses exit HP from Floor 1 as starting HP
  const f2p0 = norm6.floors[1].player_metrics[0];
  const f2p1 = norm6.floors[1].player_metrics[1];
  assert(f2p0.hp_start === 40, `Player 0 floor 2 hp_start should be 40, got ${f2p0.hp_start}`);
  assert(f2p0.hp_end === 36, `Player 0 floor 2 hp_end should be 36, got ${f2p0.hp_end}`);
  assert(f2p1.hp_start === 56, `Player 1 floor 2 hp_start should be 56, got ${f2p1.hp_start}`);
  assert(f2p1.hp_end === 52, `Player 1 floor 2 hp_end should be 52, got ${f2p1.hp_end}`);
  console.log('  ✓ Neow relic damage and Max HP loss damage_taken isolation verified');

  // 7. Multi-Act transition (Act 2 start Ancient room with healing):
  // Player enters Act 2 with 20 HP from Act 1 boss.
  // Game heals player +50 HP to 70 HP, but player takes 10 damage from ancient choice.
  // Must accrue 10 wc, not wiped out by the 50 HP act-start heal.
  const saveAct2Ancient = {
    run_id: 'test_act2_ancient_heal',
    current_act_index: 1,
    map_point_history: [
      [
        {
          map_point_type: 'boss',
          rooms: [{ room_type: 'boss', turns_taken: 8 }],
          player_stats: [{ player_id: '10000000000000001', current_hp: 20, max_hp: 75, damage_taken: 30, hp_healed: 0 }]
        }
      ],
      [
        {
          map_point_type: 'ancient',
          rooms: [{ room_type: 'event', turns_taken: 0 }],
          player_stats: [{ player_id: '10000000000000001', current_hp: 60, max_hp: 75, damage_taken: 10, hp_healed: 50 }]
        }
      ]
    ],
    visited_map_coords: [{ col: 0, row: 0 }],
    pre_finished_room: null,
    players: [{ id: '10000000000000001', name: 'PlayerOne' }],
    character: 'IRONCLAD'
  };

  const norm7 = normalizeSaveData(saveAct2Ancient);
  const act2AncientMetric = norm7.floors[1].player_metrics[0];
  const act2Penalty = act2AncientMetric.hp_start - act2AncientMetric.hp_end;
  assert(act2Penalty === 10, `Act 2 ancient room penalty should be 10 wc (ignoring 50 heal), got ${act2Penalty}`);
  console.log('  ✓ Act 2 start Ancient room penalty isolation verified');

  console.log('  ✓ All Room & Floor Tracking tests passed cleanly!\n');
}
