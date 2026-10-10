import { RawRunSaveData, RawFloorEntry, PlayerInfo, RoomType, RawPlayerFloorMetric } from '../shared/types';

/**
 * Normalizes raw save data from either:
 * 1) Standard RawRunSaveData (e.g., sample JSON payloads)
 * 2) Native Slay the Spire 2 Godot save format (e.g., current_run.save or history .run files)
 */
export function normalizeSaveData(raw: any): RawRunSaveData {
  if (!raw || typeof raw !== 'object') {
    return {
      run_id: `run_${Date.now()}`,
      is_multiplayer: false,
      player_count: 1,
      players: [{ index: 0, name: 'Player 1', character: 'UNKNOWN' }],
      floors: [],
      run_status: 'ACTIVE'
    };
  }

  // Handle standard RawRunSaveData format
  if (Array.isArray(raw.floors) && typeof raw.run_id === 'string' && Array.isArray(raw.players)) {
    return {
      run_id: raw.run_id,
      is_multiplayer: Boolean(raw.is_multiplayer),
      player_count: typeof raw.player_count === 'number' ? raw.player_count : raw.players.length,
      players: raw.players.map((p: any, idx: number) => ({
        index: typeof p.index === 'number' ? p.index : idx,
        name: p.name || `Player ${idx + 1}`,
        character: p.character || 'UNKNOWN'
      })),
      floors: raw.floors,
      run_status: raw.run_status === 'VICTORY' || raw.run_status === 'DEFEAT' ? raw.run_status : 'ACTIVE'
    };
  }

  // Handle native StS2 Godot save format (current_run.save)
  const seed = raw.seed || raw.players?.[0]?.rng?.seed || '0';
  const startTime = raw.start_time || Date.now();
  const run_id = raw.run_id || `run_${startTime}_${seed}`;

  const is_multiplayer = typeof raw.is_multiplayer === 'boolean'
    ? raw.is_multiplayer
    : (raw.game_mode === 'MULTIPLAYER' || (Array.isArray(raw.players) && raw.players.length > 1));

  const playersRaw = Array.isArray(raw.players) ? raw.players : [];
  const player_count = typeof raw.player_count === 'number' ? raw.player_count : Math.max(playersRaw.length, 1);

  const players: PlayerInfo[] = playersRaw.length > 0
    ? playersRaw.map((p: any, idx: number) => {
        const playerIndex = typeof p.index === 'number' && p.index < 10 ? p.index : idx;
        const charName = (p.character_id || p.character || 'UNKNOWN').replace(/^CHARACTER\./, '');
        return {
          index: playerIndex,
          name: p.name || charName || `Player ${idx + 1}`,
          character: charName
        };
      })
    : [{ index: 0, name: 'Player 1', character: 'UNKNOWN' }];

  let run_status: 'ACTIVE' | 'VICTORY' | 'DEFEAT' = 'ACTIVE';
  if (raw.run_status === 'VICTORY' || raw.win === true) {
    run_status = 'VICTORY';
  } else if (raw.run_status === 'DEFEAT' || raw.killed_by_encounter || raw.was_abandoned) {
    run_status = 'DEFEAT';
  }

  const floors: RawFloorEntry[] = [];
  if (Array.isArray(raw.floors)) {
    floors.push(...raw.floors);
  } else if (Array.isArray(raw.map_point_history)) {
    const totalFloorsCount = raw.map_point_history.reduce((acc: number, a: any) => acc + (Array.isArray(a) ? a.length : 0), 0);
    const playerPrevHp: Record<number, number | null> = {};
    players.forEach((p) => (playerPrevHp[p.index] = null));

    let globalFloorNum = 0;
    raw.map_point_history.forEach((act: any[]) => {
      if (!Array.isArray(act)) return;
      act.forEach((mp: any) => {
        globalFloorNum++;
        const isLastFloor = globalFloorNum === totalFloorsCount;

        const rawType = mp.map_point_type || mp.rooms?.[0]?.room_type || 'event';
        let room_type: RoomType = 'event';
        if (['monster', 'weak_monster', 'normal'].includes(rawType)) room_type = 'monster';
        else if (rawType === 'elite') room_type = 'elite';
        else if (rawType === 'boss') room_type = 'boss';
        else if (['campfire', 'rest', 'rest_site'].includes(rawType)) room_type = 'campfire';
        else if (['shop', 'merchant'].includes(rawType)) room_type = 'shop';
        else room_type = 'event';

        const total_combat_turns = typeof mp.rooms?.[0]?.turns_taken === 'number'
          ? mp.rooms[0].turns_taken
          : 0;

        const playerStats = Array.isArray(mp.player_stats) ? mp.player_stats : [];
        const player_metrics: RawPlayerFloorMetric[] = players.map((p) => {
          const rawPlayerObj = (raw.players && raw.players[p.index]) || raw.players?.[0];
          const playerNetId = typeof rawPlayerObj?.net_id === 'number' ? rawPlayerObj.net_id : null;

          const stat = playerStats.find((s: any) => {
            if (typeof s.player_id === 'number') {
              if (playerNetId !== null && s.player_id === playerNetId) return true;
              return s.player_id === (p.index + 1) || s.player_id === p.index;
            }
            return false;
          }) || playerStats[p.index] || playerStats[0];

          // Determine HP at end of floor
          const rawCurrentHp = typeof rawPlayerObj?.current_hp === 'number' ? rawPlayerObj.current_hp : 0;

          let endHp = (stat && typeof stat.current_hp === 'number' && stat.current_hp > 0)
            ? stat.current_hp
            : (isLastFloor && rawCurrentHp > 0 ? rawCurrentHp : 0);

          // Initialize HP at start of floor 1
          if (playerPrevHp[p.index] === null) {
            if (stat && typeof stat.current_hp === 'number' && stat.current_hp > 0) {
              playerPrevHp[p.index] = stat.current_hp + (stat.damage_taken || 0);
            } else {
              playerPrevHp[p.index] = typeof rawPlayerObj?.max_hp === 'number' ? rawPlayerObj.max_hp : 75;
            }
          }

          const hp_start = playerPrevHp[p.index] as number;
          const hp_end = endHp > 0 ? endHp : hp_start;

          // Update tracking for entry into next floor
          playerPrevHp[p.index] = hp_end;

          const maxHp = stat ? (typeof stat.max_hp === 'number' ? stat.max_hp : 0) : 0;
          const died_this_floor = Boolean(
            stat?.died ||
            stat?.died_this_floor ||
            (maxHp > 0 && hp_end <= 0 && (stat?.damage_taken || 0) > 0)
          );
          const death_turn = died_this_floor ? total_combat_turns : null;

          return {
            player_index: p.index,
            player_name: p.name,
            hp_start,
            hp_end,
            died_this_floor,
            death_turn
          };
        });

        floors.push({
          floor_num: globalFloorNum,
          room_type,
          total_combat_turns,
          player_metrics
        });
      });
    });
  }

  return {
    run_id,
    is_multiplayer,
    player_count,
    players,
    floors,
    run_status
  };
}
