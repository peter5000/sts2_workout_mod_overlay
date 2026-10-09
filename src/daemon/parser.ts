import { RawFloorEntry, RawRunSaveData, PlayerFloorReport, RoomType } from '../shared/types';

export class FloorParser {
  /**
   * Parse a newly committed floor entry for all players.
   * Enforces mathematical model: wc_p = n_p(2 + d_p) + h_p
   * Handles mid-combat turn freezing when a player dies before combat ends.
   */
  public static parseFloor(
    floorEntry: RawFloorEntry,
    playerDeathCounts: Map<number, number>,
    playerUnresolvedDebt: Map<number, number>,
    playerAggregates: Map<number, { accrued: number; pushups: number; squats: number }>,
    squatRatio: number
  ): PlayerFloorReport[] {
    const isNonCombat: boolean = ['event', 'campfire', 'shop', 'rest'].includes(floorEntry.room_type);
    const reports: PlayerFloorReport[] = [];

    for (const metric of floorEntry.player_metrics) {
      const idx = metric.player_index;
      const currentDeaths = playerDeathCounts.get(idx) || 0;

      // 1. Calculate turns taken (n_p)
      let turnsTakenN = 0;
      if (!isNonCombat) {
        if (metric.died_this_floor && metric.death_turn !== null && metric.death_turn > 0) {
          // Turn freezing: freeze at exact round of death
          turnsTakenN = metric.death_turn;
        } else {
          turnsTakenN = floorEntry.total_combat_turns;
        }
      }

      // 2. Increment deaths (d_p) if player died on this floor
      const newDeathsD = metric.died_this_floor ? currentDeaths + 1 : currentDeaths;
      if (metric.died_this_floor) {
        playerDeathCounts.set(idx, newDeathsD);
      }

      // 3. Calculate health delta (h_p)
      const hpLostH = Math.max(metric.hp_start - metric.hp_end, 0);

      // 4. Calculate workout counter (wc_p)
      const countersAdded = turnsTakenN * (2 + currentDeaths) + hpLostH;

      // 5. Update unresolved debt and aggregates
      const prevDebt = playerUnresolvedDebt.get(idx) || 0;
      const newDebt = prevDebt + countersAdded;
      playerUnresolvedDebt.set(idx, newDebt);

      const aggs = playerAggregates.get(idx) || { accrued: 0, pushups: 0, squats: 0 };
      aggs.accrued += countersAdded;
      playerAggregates.set(idx, aggs);

      const formulaStr = `${turnsTakenN} * (2 + ${currentDeaths}) + ${hpLostH} = ${countersAdded}`;

      reports.push({
        player_index: idx,
        player_name: metric.player_name,
        evaluation: {
          turns_taken_n: turnsTakenN,
          player_died: metric.died_this_floor,
          deaths_accumulated_d: newDeathsD,
          hp_lost_h: hpLostH,
          formula: formulaStr,
          counters_added: countersAdded
        },
        debt_state: {
          unresolved_counters: newDebt,
          squat_ratio: squatRatio
        },
        aggregates: {
          total_counters_accrued: aggs.accrued,
          completed_pushups: aggs.pushups,
          completed_squats: aggs.squats
        }
      });
    }

    return reports;
  }
}
