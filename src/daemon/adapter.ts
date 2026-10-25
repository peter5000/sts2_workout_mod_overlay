import { RawRunSaveData, RawFloorEntry, PlayerInfo, RoomType, RawPlayerFloorMetric } from '../shared/types';
import { getCombatDeathInfoFromLog, CombatDeathInfo } from './logReader';

export function getDefaultPlayerName(idx: number, rawName?: string, rawPlayerObj?: any): string {
  // 1. Gather candidate Steam/Account IDs (length >= 10) from raw player object
  const candidateIds: (string | number)[] = [
    rawPlayerObj?.steam_id,
    rawPlayerObj?.account_id,
    rawPlayerObj?.id,
    rawPlayerObj?.player_id
  ].filter((v) => v !== undefined && v !== null && v !== '' && String(v).length >= 10);

  // For the local player (idx 0), resolve local Steam ID from STS2_SAVE_DIR path if not present in player object
  if (idx === 0) {
    const saveDir = process.env.STS2_SAVE_DIR || '';
    const match = saveDir.match(/steam[/\\](\d{15,})/i);
    if (match && match[1] && !candidateIds.some(id => String(id) === match[1])) {
      candidateIds.push(match[1]);
    }
  }

  // Single standard key schema: PLAYER_NAME_<ID>
  for (const idVal of candidateIds) {
    const strId = String(idVal).trim();
    const envById = process.env[`PLAYER_NAME_${strId}`];
    if (envById && envById.trim().length > 0) {
      return envById.trim();
    }
  }

  // 2. Check save data name if present and custom (not generic default)
  if (rawName && rawName.trim().length > 0 && !rawName.startsWith('Player ') && rawName !== 'UNKNOWN') {
    return rawName.trim();
  }

  // 3. Single standard key schema by index: PLAYER_NAME_<idx> (e.g. PLAYER_NAME_0)
  const envByIndex = process.env[`PLAYER_NAME_${idx}`];
  if (envByIndex && envByIndex.trim().length > 0) {
    return envByIndex.trim();
  }

  // 4. Default fallback showing full Steam ID so players can easily identify and register it
  const primaryId = candidateIds.find(id => String(id).length >= 16);
  if (primaryId) {
    return `Player ${idx + 1} (${String(primaryId)})`;
  }
  return `Player ${idx + 1}`;
}

/**
 * Normalizes raw save data from either:
 * 1) Standard RawRunSaveData (e.g., sample JSON payloads)
 * 2) Native Slay the Spire 2 Godot save format (e.g., current_run.save, current_run_mp.save, or history .run files)
 * 
 * Supports on-demand enrichment from godot.log to detect mid-combat deaths and turn counts.
 */
export function normalizeSaveData(raw: any, logSource?: CombatDeathInfo | string): RawRunSaveData {
  if (typeof raw === 'string') {
    try {
      const sanitized = raw.replace(/"(player_id|net_id|steam_id|account_id|id)":\s*(\d{15,})/g, '"$1": "$2"');
      raw = JSON.parse(sanitized);
    } catch {
      // fallback
    }
  }

  if (!raw || typeof raw !== 'object') {
    return {
      run_id: `run_${Date.now()}`,
      is_multiplayer: false,
      player_count: 1,
      players: [{ index: 0, name: getDefaultPlayerName(0), character: 'UNKNOWN' }],
      floors: [],
      run_status: 'ACTIVE'
    };
  }

  // Handle standard RawRunSaveData format
  if (Array.isArray(raw.floors) && typeof raw.run_id === 'string' && Array.isArray(raw.players)) {
    const maxFloor = raw.floors.reduce((max: number, f: any) => Math.max(max, f.floor_num || 0), 0);
    return {
      run_id: raw.run_id,
      is_multiplayer: Boolean(raw.is_multiplayer),
      player_count: typeof raw.player_count === 'number' ? raw.player_count : raw.players.length,
      players: raw.players.map((p: any, idx: number) => {
        const pIdx = typeof p.index === 'number' ? p.index : idx;
        return {
          index: pIdx,
          name: getDefaultPlayerName(pIdx, p.name, p),
          character: p.character || 'UNKNOWN'
        };
      }),
      floors: raw.floors,
      run_status: raw.run_status === 'VICTORY' || raw.run_status === 'DEFEAT' ? raw.run_status : 'ACTIVE',
      current_floor: typeof raw.current_floor === 'number' ? raw.current_floor : maxFloor,
      in_reward_stage: typeof raw.in_reward_stage === 'boolean' ? raw.in_reward_stage : undefined
    };
  }

  // Handle native StS2 Godot save format (current_run.save)
  const startTime = raw.start_time || Date.now();
  const run_id = raw.run_id || `run_${startTime}`;

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
          name: getDefaultPlayerName(playerIndex, p.name, p),
          character: charName
        };
      })
    : [{ index: 0, name: getDefaultPlayerName(0), character: 'UNKNOWN' }];

  let run_status: 'ACTIVE' | 'VICTORY' | 'DEFEAT' = 'ACTIVE';
  if (raw.run_status === 'VICTORY' || raw.win === true) {
    run_status = 'VICTORY';
  } else if (raw.run_status === 'DEFEAT' || raw.killed_by_encounter || raw.was_abandoned) {
    run_status = 'DEFEAT';
  }

  // Resolve combat log info on demand if available
  let logInfo: CombatDeathInfo | null = null;
  if (logSource && typeof logSource === 'object' && 'diedPlayers' in logSource) {
    logInfo = logSource as CombatDeathInfo;
  } else if (typeof logSource === 'string') {
    logInfo = getCombatDeathInfoFromLog(logSource);
  } else {
    // Attempt reading from default godot.log location
    logInfo = getCombatDeathInfoFromLog();
  }

  const floors: RawFloorEntry[] = [];
  if (Array.isArray(raw.floors)) {
    floors.push(...raw.floors);
  } else if (Array.isArray(raw.map_point_history)) {
    const totalFloorsCount = raw.map_point_history.reduce((acc: number, a: any) => acc + (Array.isArray(a) ? a.length : 0), 0);
    const playerPrevHp: Record<number, number | null> = {};
    players.forEach((p) => (playerPrevHp[p.index] = null));

    let globalFloorNum = 0;
    raw.map_point_history.forEach((act: any[], actIdx: number) => {
      if (!Array.isArray(act)) return;
      act.forEach((mp: any, actNodeIdx: number) => {
        globalFloorNum++;
        const isLastFloor = globalFloorNum === totalFloorsCount;
        const isCombatFloorType = ['monster', 'weak_monster', 'normal', 'elite', 'boss'].includes(
          mp.map_point_type || mp.rooms?.[0]?.room_type || ''
        );
        const isActStartFloor = mp.map_point_type === 'ancient';

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

        const isCombat = ['monster', 'elite', 'boss'].includes(room_type);
        const playerStats = Array.isArray(mp.player_stats) ? mp.player_stats : [];

        const player_metrics: RawPlayerFloorMetric[] = players.map((p) => {
          const rawPlayerObj = (raw.players && raw.players[p.index]) || raw.players?.[0];
          const playerNetId = typeof rawPlayerObj?.net_id === 'number' ? rawPlayerObj.net_id : null;

          const rawPlayerIds = [
            rawPlayerObj?.steam_id,
            rawPlayerObj?.account_id,
            rawPlayerObj?.id,
            rawPlayerObj?.net_id,
            p.index,
            p.index + 1
          ].filter((v) => v !== undefined && v !== null && v !== '').map(String);

          const stat = playerStats.find((s: any) => {
            if (s && s.player_id !== undefined && s.player_id !== null) {
              const sPid = String(s.player_id);
              return rawPlayerIds.includes(sPid);
            }
            return false;
          }) || playerStats[p.index] || playerStats[0];

          // Determine HP at end of floor
          const rawCurrentHp = typeof rawPlayerObj?.current_hp === 'number' ? rawPlayerObj.current_hp : 0;
          const statHasHp = stat && typeof stat.current_hp === 'number';
          const statMaxHp = stat && typeof stat.max_hp === 'number' ? stat.max_hp : 0;

          let endHp = (statHasHp && stat.current_hp > 0)
            ? stat.current_hp
            : (isLastFloor && rawCurrentHp > 0 ? rawCurrentHp : 0);

          let hp_start: number;
          let hp_end: number;

          if (isActStartFloor) {
            // Start of act floor (Neow / Ancient rooms):
            // StS2 grants an automated act-start heal and resets act modifiers.
            // Ignore act-start healing and strictly use stat.damage_taken.
            // In StS2's engine, stat.damage_taken accurately captures both direct relic damage
            // (e.g. Precarious Shears) and any Max HP loss that forced Current HP downward.
            const startOfActHpPenalty = Math.max(0, stat?.damage_taken || 0);
            const safeEndHp = endHp > 0 ? endHp : (statMaxHp > 0 ? statMaxHp : 70);

            hp_end = safeEndHp;
            hp_start = safeEndHp + startOfActHpPenalty;
            playerPrevHp[p.index] = safeEndHp;
          } else {
            // Regular floors (combat encounters, mid-act events, rest sites, shops):
            if (playerPrevHp[p.index] === null) {
              playerPrevHp[p.index] = endHp > 0 ? endHp : (statMaxHp > 0 ? statMaxHp : 75);
            }

            hp_start = playerPrevHp[p.index] as number;
            hp_end = endHp > 0 ? endHp : (statHasHp && stat.current_hp === 0 ? 0 : hp_start);

            // Update tracking for entry into next floor
            playerPrevHp[p.index] = hp_end;
          }

          // Check if player died during this floor from log reader
          const candidateIds = [
            rawPlayerObj?.steam_id,
            rawPlayerObj?.account_id,
            rawPlayerObj?.id,
            rawPlayerObj?.net_id,
            stat?.player_id,
            rawPlayerObj?.character,
            rawPlayerObj?.character_id,
            p.character,
            p.index,
            p.index + 1
          ].filter((v) => v !== undefined && v !== null && v !== '').map(String);

          const isDiedFromLog = Boolean(
            isLastFloor &&
            isCombat &&
            logInfo &&
            candidateIds.some((id) => logInfo!.diedPlayers.has(id))
          );

          let logDeathTurn: number | null = null;
          if (isDiedFromLog && logInfo) {
            for (const id of candidateIds) {
              if (typeof logInfo.deathTurns[id] === 'number') {
                logDeathTurn = logInfo.deathTurns[id];
                break;
              }
            }
          }

          // Death detection is SOLELY based on godot.log engine events:
          // In StS2, true player death logs 'Player X died, doing death handling'.
          // Fairy in a Bottle and Lizard Tail mid-combat revives do NOT log death handling and do NOT count as deaths.
          // Save file HP stats are NOT used for death detection (prevents false positives from uninitialized reward screens).
          const died_this_floor = isDiedFromLog;

          const death_turn = died_this_floor
            ? (typeof logDeathTurn === 'number' ? logDeathTurn : total_combat_turns)
            : null;

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
          player_metrics,
          log_parsed: isLastFloor && isCombat ? Boolean(logInfo?.success) : undefined
        });
      });
    });
  }

  // Calculate actual current floor reached in the run:
  // StS2 appends completed rooms to map_point_history, but does NOT append the current active node
  // (e.g. event room, campfire, shop, or active combat) until that node is exited!
  // However, visited_map_coords tracks every node coordinate entered in the current act.
  let current_floor = 0;
  if (Array.isArray(raw.map_point_history)) {
    const actIdx = typeof raw.current_act_index === 'number' ? raw.current_act_index : 0;
    for (let a = 0; a < actIdx && a < raw.map_point_history.length; a++) {
      if (Array.isArray(raw.map_point_history[a])) {
        current_floor += raw.map_point_history[a].length;
      }
    }
    if (Array.isArray(raw.visited_map_coords) && raw.visited_map_coords.length > 0) {
      current_floor += raw.visited_map_coords.length;
    } else if (Array.isArray(raw.map_point_history[actIdx])) {
      current_floor += raw.map_point_history[actIdx].length;
    }
  } else if (typeof raw.current_floor === 'number') {
    current_floor = raw.current_floor;
  }
  const maxFloorNum = floors.reduce((max: number, f: any) => Math.max(max, f.floor_num || 0), 0);
  current_floor = Math.max(current_floor, maxFloorNum);

  // Detect if currently sitting at a combat reward screen:
  // In native StS2, when combat ends and rewards are available, pre_finished_room is populated
  // with is_pre_finished: true. When rewards are claimed and the player selects the next node,
  // pre_finished_room is cleared to null.
  let in_reward_stage: boolean | undefined = undefined;
  if (raw.pre_finished_room !== undefined) {
    in_reward_stage = Boolean(raw.pre_finished_room && raw.pre_finished_room.is_pre_finished);
  } else if (typeof raw.in_reward_stage === 'boolean') {
    in_reward_stage = raw.in_reward_stage;
  }

  return {
    run_id,
    is_multiplayer,
    player_count,
    players,
    floors,
    run_status,
    current_floor,
    in_reward_stage
  };
}