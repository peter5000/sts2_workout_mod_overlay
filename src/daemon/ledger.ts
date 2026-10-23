import {
  RawRunSaveData,
  RawFloorEntry,
  PlayerFloorReport,
  ResolveRepsPayload,
  FloorCommitData,
  RunTerminatedEvent,
  PartyMemberSummary,
  PlayerInfo,
  ActiveSessionStore,
  PendingPlayerFloor
} from '../shared/types';
import { FloorParser } from './parser';
import { PersistenceManager } from './persistence';

export class DebtLedger {
  private runId: string = '';
  private isMultiplayer: boolean = false;
  private playerCount: number = 1;
  private players: PlayerInfo[] = [];
  private squatRatio: number = 2;
  private optIn: boolean = true;
  private lastProcessedFloor: number = 0;
  private runStatus: 'ACTIVE' | 'VICTORY' | 'DEFEAT' = 'ACTIVE';

  private playerDebts: Map<number, number> = new Map();
  private playerDeaths: Map<number, number> = new Map();
  private playerAggregates: Map<number, { accrued: number; pushups: number; squats: number }> = new Map();
  private playerSquatRemainders: Map<number, number> = new Map();
  private playerNames: Map<number, string> = new Map();
  private playerSquatRatios: Map<number, number> = new Map();
  private activeSessionsMap: Map<string, ActiveSessionStore> = new Map();

  private pendingFloorEntry: RawFloorEntry | null = null;
  private pendingPlayerFloors: Map<number, PendingPlayerFloor> = new Map();

  private jogPenaltyActive: boolean = false;
  private jogPenaltyDeadline: number | null = null;

  private persistence: PersistenceManager;

  constructor(persistence?: PersistenceManager) {
    this.persistence = persistence || new PersistenceManager();
    this.restoreFromPersistence();
  }

  public processSaveData(runData: RawRunSaveData): {
    isNewRun: boolean;
    commitData: FloorCommitData | null;
    terminatedEvent: RunTerminatedEvent | null;
    rewardStageEntered: { floor: number; room_type: string } | null;
  } {
    let isNewRun = false;

    const safeRunId = runData?.run_id || `run_${Date.now()}`;
    const safePlayers = Array.isArray(runData?.players) ? runData.players : [];
    const safeFloors = Array.isArray(runData?.floors) ? runData.floors : [];

    // Check if this is a new run or switching active run
    if (this.runId !== safeRunId) {
      if (this.runId) {
        this.activeSessionsMap.set(this.runId, this.getFullState());
      }
      if (this.activeSessionsMap.has(safeRunId)) {
        this.loadRunStateFromStore(this.activeSessionsMap.get(safeRunId)!);
        this.players = safePlayers;
        this.isMultiplayer = Boolean(runData?.is_multiplayer);
        this.playerCount = runData?.player_count || safePlayers.length || 1;
        isNewRun = false;
      } else {
        this.initNewRun(runData);
        isNewRun = true;
      }
    } else {
      this.players = safePlayers;
      this.isMultiplayer = Boolean(runData?.is_multiplayer);
      this.playerCount = runData?.player_count || safePlayers.length || 1;
    }

    safePlayers.forEach((p, idx) => {
      const pIdx = typeof p.index === 'number' ? p.index : idx;
      if (p.name) this.playerNames.set(pIdx, p.name);
    });

    let commitData: FloorCommitData | null = null;
    let rewardStageEntered: { floor: number; room_type: string } | null = null;

    // Parse unprocessed floors sequentially
    const sortedFloors = [...safeFloors].sort((a, b) => (a.floor_num || 0) - (b.floor_num || 0));
    const maxFloorNum = sortedFloors.length > 0 ? sortedFloors[sortedFloors.length - 1].floor_num : 0;
    const isTerminal = runData.run_status === 'VICTORY' || runData.run_status === 'DEFEAT';

    // 1. If we currently have a pending floor from a prior combat encounter:
    if (this.pendingPlayerFloors.size > 0) {
      const samplePending = this.pendingPlayerFloors.values().next().value as PendingPlayerFloor;
      const pendingFloorNum = samplePending?.floor_num;

      if (pendingFloorNum !== undefined) {
        const currentFloor = typeof runData.current_floor === 'number' ? runData.current_floor : maxFloorNum;
        const inRewardStage = typeof runData.in_reward_stage === 'boolean'
          ? runData.in_reward_stage
          : (currentFloor === pendingFloorNum);

        // Did the party finish reward picking and move on to the next floor?
        // (Or did the run terminate?)
        const partyMovedOn = currentFloor > pendingFloorNum ||
                             maxFloorNum > pendingFloorNum ||
                             (!inRewardStage && currentFloor >= pendingFloorNum) ||
                             (isTerminal && maxFloorNum === pendingFloorNum && this.lastProcessedFloor < pendingFloorNum);

        if (partyMovedOn) {
          // All players finished rewards and moved to the next floor!
          // Auto-commit any players who did not commit early:
          const autoReports: PlayerFloorReport[] = [];
          for (const [pIdx, pending] of this.pendingPlayerFloors.entries()) {
            if (!pending.committed) {
              pending.committed = true;
              const curDebt = this.playerDebts.get(pIdx) || 0;
              this.playerDebts.set(pIdx, curDebt + pending.wc);
              const aggs = this.playerAggregates.get(pIdx) || { accrued: 0, pushups: 0, squats: 0 };
              aggs.accrued += pending.wc;
              this.playerAggregates.set(pIdx, aggs);
              if (pending.player_died) {
                this.playerDeaths.set(pIdx, (this.playerDeaths.get(pIdx) || 0) + 1);
              }
              autoReports.push(this.buildReportForPending(pending));
            }
          }

          if (this.pendingFloorEntry) {
            this.recordStageFromPending(this.pendingFloorEntry, this.pendingPlayerFloors, runData.run_status);
          }
          this.lastProcessedFloor = pendingFloorNum;
          this.pendingPlayerFloors.clear();
          this.pendingFloorEntry = null;

          if (autoReports.length > 0) {
            commitData = {
              floor: pendingFloorNum,
              room_type: samplePending.room_type,
              players: autoReports
            };
          }
        } else {
          // Still in the reward stage of pendingFloorNum:
          // Check if uncommitted players received reward healing (potions, relics, etc.)
          const currentFloorEntry = sortedFloors.find((f) => f && f.floor_num === pendingFloorNum);
          if (currentFloorEntry && ['monster', 'elite', 'boss'].includes(currentFloorEntry.room_type)) {
            for (const metric of currentFloorEntry.player_metrics) {
              const pIdx = metric.player_index;
              const pending = this.pendingPlayerFloors.get(pIdx);
              if (pending && !pending.committed) {
                // Uncommitted player: reward healing offsets damage taken!
                const currentHpLoss = Math.max(0, metric.hp_start - metric.hp_end);
                const turns = pending.turns_taken;
                const deaths = pending.deaths_accumulated;
                const newWc = turns * (2 + deaths) + currentHpLoss;
                pending.hp_lost = currentHpLoss;
                pending.wc = newWc;
                pending.formula = `${turns} * (2 + ${deaths}) + ${currentHpLoss} = ${newWc}`;
              }
              // If pending.committed === true:
              // Early Commit Lock-in Rule: committed players cannot receive subsequent reward healing reductions!
            }
          }
        }
      }
    }

    // 2. Identify newly completed floors (excluding any floor currently pending in reward stage)
    const currentPendingNum = this.pendingFloorEntry?.floor_num ?? (this.pendingPlayerFloors.size > 0 ? (this.pendingPlayerFloors.values().next().value as PendingPlayerFloor)?.floor_num : null);

    const newFloors = sortedFloors.filter((f) => {
      if (!f || f.floor_num <= this.lastProcessedFloor) return false;
      if (currentPendingNum !== null && f.floor_num === currentPendingNum) return false;
      return true;
    });

    if (newFloors.length > 0) {
      for (const floorEntry of newFloors) {
        const isLatest = floorEntry.floor_num === maxFloorNum;
        const currentFloor = typeof runData.current_floor === 'number' ? runData.current_floor : maxFloorNum;
        const isCombat = ['monster', 'elite', 'boss'].includes(floorEntry.room_type);
        const inRewardStage = typeof runData.in_reward_stage === 'boolean'
          ? runData.in_reward_stage
          : (currentFloor === floorEntry.floor_num);

        const isRewardStageNow = (floorEntry.floor_num === currentFloor) && isCombat && inRewardStage && (runData.run_status === 'ACTIVE');

        if (isRewardStageNow) {
          // REWARD STAGE of combat encounter:
          rewardStageEntered = {
            floor: floorEntry.floor_num,
            room_type: floorEntry.room_type
          };
          // Make floor debt pending so players can review and choose to commit early during rewards
          this.pendingFloorEntry = floorEntry;
          this.pendingPlayerFloors.clear();

          for (const metric of floorEntry.player_metrics) {
            const pIdx = metric.player_index;
            const currentDeaths = this.playerDeaths.get(pIdx) || 0;
            let turnsTakenN = floorEntry.total_combat_turns;
            if (metric.died_this_floor && metric.death_turn !== null && metric.death_turn > 0) {
              turnsTakenN = metric.death_turn;
            }
            const hpLostH = Math.max(0, metric.hp_start - metric.hp_end);
            const rawCounters = turnsTakenN * (2 + currentDeaths) + hpLostH;
            const formulaStr = `${turnsTakenN} * (2 + ${currentDeaths}) + ${hpLostH} = ${rawCounters}`;

            this.pendingPlayerFloors.set(pIdx, {
              player_index: pIdx,
              floor_num: floorEntry.floor_num,
              room_type: floorEntry.room_type,
              wc: rawCounters,
              formula: formulaStr,
              turns_taken: turnsTakenN,
              deaths_accumulated: currentDeaths,
              hp_lost: hpLostH,
              player_died: metric.died_this_floor,
              committed: false
            });
          }
          // Note: floor does not commit yet; buttons show in Panel A during reward stage!
        } else {
          // Non-combat room (campfire, event, shop) or terminal floor (DEFEAT / VICTORY):
          // Commits immediately.
          const isDefeatFloor = (runData.run_status === 'DEFEAT') && isLatest;
          const floorReports = FloorParser.parseFloor(
            floorEntry,
            this.playerDeaths,
            this.playerDebts,
            this.playerAggregates,
            this.playerSquatRatios.size > 0 ? this.buildRatioMap() : this.squatRatio,
            isDefeatFloor
          );
          this.lastProcessedFloor = floorEntry.floor_num;
          this.recordStage(floorEntry.floor_num, floorEntry.room_type, floorReports, runData.run_status);

          commitData = {
            floor: floorEntry.floor_num,
            room_type: floorEntry.room_type,
            players: floorReports
          };
        }
      }
    }

    let terminatedEvent: RunTerminatedEvent | null = null;

    // Check terminal run status transitions
    if (runData.run_status !== 'ACTIVE' && this.runStatus === 'ACTIVE') {
      this.runStatus = runData.run_status;
      terminatedEvent = this.handleRunTermination(runData.run_status);
    }

    this.persistCurrentState();

    return { isNewRun, commitData, terminatedEvent, rewardStageEntered };
  }

  public commitPendingFloor(playerIndex?: number): FloorCommitData | null {
    if (this.pendingPlayerFloors.size === 0) {
      return null;
    }

    const reports: PlayerFloorReport[] = [];

    if (playerIndex !== undefined) {
      const pending = this.pendingPlayerFloors.get(playerIndex);
      if (!pending || pending.committed) {
        return null;
      }

      pending.committed = true;
      const curDebt = this.playerDebts.get(playerIndex) || 0;
      this.playerDebts.set(playerIndex, curDebt + pending.wc);
      const aggs = this.playerAggregates.get(playerIndex) || { accrued: 0, pushups: 0, squats: 0 };
      aggs.accrued += pending.wc;
      this.playerAggregates.set(playerIndex, aggs);
      if (pending.player_died) {
        this.playerDeaths.set(playerIndex, (this.playerDeaths.get(playerIndex) || 0) + 1);
      }

      reports.push(this.buildReportForPending(pending));

      if (this.pendingFloorEntry) {
        this.recordStageFromPending(this.pendingFloorEntry, this.pendingPlayerFloors, this.runStatus);
      }

      this.persistCurrentState();
      return {
        floor: pending.floor_num,
        room_type: pending.room_type,
        players: reports
      };
    } else {
      // Bulk commit all uncommitted players
      for (const [pIdx, pending] of this.pendingPlayerFloors.entries()) {
        if (!pending.committed) {
          pending.committed = true;
          const curDebt = this.playerDebts.get(pIdx) || 0;
          this.playerDebts.set(pIdx, curDebt + pending.wc);
          const aggs = this.playerAggregates.get(pIdx) || { accrued: 0, pushups: 0, squats: 0 };
          aggs.accrued += pending.wc;
          this.playerAggregates.set(pIdx, aggs);
          if (pending.player_died) {
            this.playerDeaths.set(pIdx, (this.playerDeaths.get(pIdx) || 0) + 1);
          }
          reports.push(this.buildReportForPending(pending));
        }
      }

      if (this.pendingFloorEntry) {
        this.recordStageFromPending(this.pendingFloorEntry, this.pendingPlayerFloors, this.runStatus);
      }

      this.persistCurrentState();
      const sample = this.pendingPlayerFloors.values().next().value as PendingPlayerFloor | undefined;
      return {
        floor: sample ? sample.floor_num : this.lastProcessedFloor,
        room_type: sample ? sample.room_type : 'monster',
        players: reports
      };
    }
  }

  public resolveReps(payload: ResolveRepsPayload): { success: boolean; updatedDebt: number; updatedPushups: number; updatedSquats: number } {
    const idx = payload.player_index;
    const currentDebt = this.playerDebts.get(idx) || 0;
    const aggs = this.playerAggregates.get(idx) || { accrued: 0, pushups: 0, squats: 0 };
    const ratio = this.getPlayerRatio(idx);
    const currentRemainder = this.playerSquatRemainders.get(idx) || 0;

    let debtDeduction = 0;
    let pushupsAdded = 0;
    let squatsAdded = 0;

    switch (payload.action_type) {
      case 'CUSTOM_ENTRY':
        const reps = payload.reps || 0;
        if (payload.exercise === 'pushups') {
          debtDeduction = Math.min(reps, currentDebt);
          pushupsAdded = debtDeduction;
        } else if (payload.exercise === 'squats') {
          const maxSquatsNeeded = Math.max(currentDebt * ratio - currentRemainder, 0);
          const effectiveSquats = Math.min(reps, maxSquatsNeeded);
          const totalSquats = currentRemainder + effectiveSquats;
          debtDeduction = Math.min(Math.floor(totalSquats / ratio), currentDebt);
          const newRemainder = totalSquats % ratio;
          this.playerSquatRemainders.set(idx, newRemainder);
          squatsAdded = effectiveSquats;
        }
        break;

      case 'ALL_PUSHUPS':
        debtDeduction = currentDebt;
        pushupsAdded = currentDebt;
        break;

      case 'ALL_SQUATS':
        debtDeduction = currentDebt;
        const totalSquatsNeeded = Math.max(currentDebt * ratio - currentRemainder, 0);
        squatsAdded = totalSquatsNeeded;
        this.playerSquatRemainders.set(idx, 0);
        break;
    }

    const newDebt = Math.max(currentDebt - debtDeduction, 0);
    aggs.pushups += pushupsAdded;
    aggs.squats += squatsAdded;

    this.playerDebts.set(idx, newDebt);
    this.playerAggregates.set(idx, aggs);

    this.persistCurrentState();
    this.syncHistoryAggregates();

    return {
      success: true,
      updatedDebt: newDebt,
      updatedPushups: aggs.pushups,
      updatedSquats: aggs.squats
    };
  }

  public setSquatRatio(ratio: number): void {
    const clamped = Math.max(1, Math.min(ratio, 10));
    this.squatRatio = clamped;
    this.players.forEach((p) => {
      this.playerSquatRatios.set(p.index, clamped);
    });
    this.persistCurrentState();
  }

  public setPlayerSquatRatio(playerIndex: number, ratio: number): void {
    const clamped = Math.max(1, Math.min(ratio, 10));
    this.playerSquatRatios.set(playerIndex, clamped);
    this.persistCurrentState();
  }

  public setPlayerDeaths(playerIndex: number, deaths: number): void {
    const clamped = Math.max(0, deaths);
    this.playerDeaths.set(playerIndex, clamped);
    this.persistCurrentState();
    if (this.runId) {
      this.persistence.updatePlayerDeaths(this.runId, playerIndex, clamped);
    }
  }

  public getPlayerRatio(playerIndex: number): number {
    return this.playerSquatRatios.get(playerIndex) ?? this.squatRatio;
  }

  private buildRatioMap(): Map<number, number> {
    const map = new Map<number, number>();
    this.players.forEach((p) => {
      map.set(p.index, this.getPlayerRatio(p.index));
    });
    return map;
  }

  private computeTotals(): { totalAccrued: number; totalPushups: number; totalSquats: number } {
    let totalAccrued = 0;
    let totalPushups = 0;
    let totalSquats = 0;
    this.playerAggregates.forEach((aggs) => {
      totalAccrued += aggs.accrued;
      totalPushups += aggs.pushups;
      totalSquats += aggs.squats;
    });
    return { totalAccrued, totalPushups, totalSquats };
  }

  private buildReportForPending(pending: PendingPlayerFloor): PlayerFloorReport {
    const pIdx = pending.player_index;
    const pName = this.playerNames.get(pIdx) || `Player ${pIdx + 1}`;
    const curDebt = this.playerDebts.get(pIdx) || 0;
    const aggs = this.playerAggregates.get(pIdx) || { accrued: 0, pushups: 0, squats: 0 };
    const deaths = this.playerDeaths.get(pIdx) || 0;
    return {
      player_index: pIdx,
      player_name: pName,
      evaluation: {
        turns_taken_n: pending.turns_taken,
        player_died: pending.player_died,
        deaths_accumulated_d: deaths,
        hp_lost_h: pending.hp_lost,
        formula: pending.formula,
        counters_added: pending.wc
      },
      debt_state: {
        unresolved_counters: curDebt,
        squat_ratio: this.getPlayerRatio(pIdx)
      },
      aggregates: {
        total_counters_accrued: aggs.accrued,
        completed_pushups: aggs.pushups,
        completed_squats: aggs.squats
      }
    };
  }

  private recordStageFromPending(
    floorEntry: RawFloorEntry,
    pendingMap: Map<number, PendingPlayerFloor>,
    status: 'ACTIVE' | 'VICTORY' | 'DEFEAT'
  ): void {
    if (!this.runId) return;

    const stagePlayers = Array.from(pendingMap.values()).map((p) => {
      const pIdx = p.player_index;
      const pName = this.playerNames.get(pIdx) || `Player ${pIdx + 1}`;
      const curDebt = this.playerDebts.get(pIdx) || 0;
      const aggs = this.playerAggregates.get(pIdx) || { accrued: 0, pushups: 0, squats: 0 };
      const deaths = this.playerDeaths.get(pIdx) || 0;
      return {
        player_index: pIdx,
        player_name: pName,
        squat_ratio: this.getPlayerRatio(pIdx),
        counters_accrued: p.committed ? p.wc : 0,
        unresolved_debt: curDebt,
        cumulative_pushups: aggs.pushups,
        cumulative_squats: aggs.squats,
        deaths,
        hp_loss: p.hp_lost,
        turns_taken: p.turns_taken
      };
    });

    const t = this.computeTotals();

    this.persistence.recordFloorStage(
      this.runId,
      {
        floor_num: floorEntry.floor_num,
        room_type: floorEntry.room_type,
        timestamp: Date.now(),
        players: stagePlayers
      },
      {
        floors_reached: floorEntry.floor_num,
        total_counters_accrued: t.totalAccrued,
        total_pushups: t.totalPushups,
        total_squats: t.totalSquats,
        outcome: status
      }
    );
  }

  private recordStage(
    floorNum: number,
    roomType: string,
    reports: PlayerFloorReport[],
    status: 'ACTIVE' | 'VICTORY' | 'DEFEAT'
  ): void {
    if (!this.runId) return;

    const stagePlayers = reports.map((r) => ({
      player_index: r.player_index,
      player_name: r.player_name,
      squat_ratio: this.getPlayerRatio(r.player_index),
      counters_accrued: r.evaluation.counters_added,
      unresolved_debt: r.debt_state.unresolved_counters,
      cumulative_pushups: r.aggregates.completed_pushups,
      cumulative_squats: r.aggregates.completed_squats,
      deaths: r.evaluation.deaths_accumulated_d,
      hp_loss: r.evaluation.hp_lost_h,
      turns_taken: r.evaluation.turns_taken_n
    }));

    const t = this.computeTotals();

    this.persistence.recordFloorStage(
      this.runId,
      {
        floor_num: floorNum,
        room_type: roomType,
        timestamp: Date.now(),
        players: stagePlayers
      },
      {
        floors_reached: floorNum,
        total_counters_accrued: t.totalAccrued,
        total_pushups: t.totalPushups,
        total_squats: t.totalSquats,
        outcome: status
      }
    );
  }

  private syncHistoryAggregates(): void {
    if (!this.runId) return;
    const t = this.computeTotals();
    this.persistence.updateRunAggregates(this.runId, t.totalPushups, t.totalSquats, t.totalAccrued);
  }

  public setOptIn(optIn: boolean): void {
    this.optIn = optIn;
    this.persistCurrentState();
  }

  public getFullState(): ActiveSessionStore {
    const debtsObj: Record<number, number> = {};
    const deathsObj: Record<number, number> = {};
    const aggsObj: Record<number, { accrued: number; pushups: number; squats: number }> = {};
    const remaindersObj: Record<number, number> = {};
    const namesObj: Record<number, string> = {};

    this.playerDebts.forEach((val, key) => (debtsObj[key] = val));
    this.playerDeaths.forEach((val, key) => (deathsObj[key] = val));
    this.playerAggregates.forEach((val, key) => (aggsObj[key] = val));
    this.playerSquatRemainders.forEach((val, key) => (remaindersObj[key] = val));
    this.playerNames.forEach((val, key) => (namesObj[key] = val));
    const ratiosObj: Record<number, number> = {};
    this.playerDebts.forEach((_v, key) => (ratiosObj[key] = this.getPlayerRatio(key)));
    this.playerSquatRatios.forEach((val, key) => (ratiosObj[key] = val));

    const pendingObj: Record<number, PendingPlayerFloor> = {};
    this.pendingPlayerFloors.forEach((val, key) => (pendingObj[key] = val));

    return {
      run_id: this.runId,
      is_multiplayer: this.isMultiplayer,
      player_count: this.playerCount,
      squat_ratio: this.squatRatio,
      player_squat_ratios: ratiosObj,
      opt_in: this.optIn,
      last_processed_floor: this.lastProcessedFloor,
      player_debts: debtsObj,
      player_deaths: deathsObj,
      player_aggregates: aggsObj,
      player_squat_remainders: remaindersObj,
      player_names: namesObj,
      run_status: this.runStatus,
      jog_penalty: {
        active: this.jogPenaltyActive,
        deadline_timestamp: this.jogPenaltyDeadline
      },
      pending_floor: this.pendingFloorEntry ? {
        floor_num: this.pendingFloorEntry.floor_num,
        room_type: this.pendingFloorEntry.room_type
      } : (this.pendingPlayerFloors.size > 0 ? {
        floor_num: this.pendingPlayerFloors.values().next().value!.floor_num,
        room_type: this.pendingPlayerFloors.values().next().value!.room_type
      } : null),
      pending_player_floors: pendingObj
    };
  }

  public getSquatRatio(): number {
    return this.squatRatio;
  }

  public getRunId(): string {
    return this.runId;
  }

  public isMultiplayerGame(): boolean {
    return this.isMultiplayer;
  }

  private initNewRun(runData: RawRunSaveData): void {
    this.runId = runData?.run_id || `run_${Date.now()}`;
    this.isMultiplayer = Boolean(runData?.is_multiplayer);
    this.players = Array.isArray(runData?.players) ? runData.players : [];
    this.playerCount = runData?.player_count || this.players.length || 1;
    this.lastProcessedFloor = 0;
    this.runStatus = 'ACTIVE';
    this.pendingFloorEntry = null;
    this.pendingPlayerFloors.clear();

    this.playerDebts.clear();
    this.playerDeaths.clear();
    this.playerAggregates.clear();
    this.playerSquatRemainders.clear();
    this.playerNames.clear();
    this.playerSquatRatios.clear();

    for (const p of this.players) {
      const idx = typeof p.index === 'number' ? p.index : 0;
      this.playerDebts.set(idx, 0);
      this.playerDeaths.set(idx, 0);
      this.playerAggregates.set(idx, { accrued: 0, pushups: 0, squats: 0 });
      this.playerSquatRemainders.set(idx, 0);
      if (p.name) this.playerNames.set(idx, p.name);
    }
  }

  private handleRunTermination(outcome: 'VICTORY' | 'DEFEAT'): RunTerminatedEvent {
    const isDefeat = outcome === 'DEFEAT';
    this.jogPenaltyActive = isDefeat;
    this.jogPenaltyDeadline = isDefeat ? Date.now() + 24 * 60 * 60 * 1000 : null;

    const summaries: PartyMemberSummary[] = this.players.map((p) => {
      const idx = p.index;
      const aggs = this.playerAggregates.get(idx) || { accrued: 0, pushups: 0, squats: 0 };
      return {
        player_index: idx,
        player_name: p.name,
        squat_ratio: this.getPlayerRatio(idx),
        final_unresolved_debt: this.playerDebts.get(idx) || 0,
        total_pushups: aggs.pushups,
        total_squats: aggs.squats,
        deaths: this.playerDeaths.get(idx) || 0
      };
    });

    const { totalAccrued, totalPushups, totalSquats } = this.computeTotals();

    // Save to historical ledger (merges with per-floor stage_history)
    this.persistence.appendHistory({
      run_id: this.runId,
      completed_at: Date.now(),
      outcome,
      floors_reached: this.lastProcessedFloor,
      total_counters_accrued: totalAccrued,
      total_pushups: totalPushups,
      total_squats: totalSquats,
      jog_penalty_applied: isDefeat,
      party_summary: summaries
    });

    return {
      type: 'RUN_TERMINATED',
      timestamp: Date.now(),
      data: {
        outcome,
        floor_reached: this.lastProcessedFloor,
        jog_penalty_required: isDefeat,
        jog_deadline_timestamp: this.jogPenaltyDeadline,
        party_summary: summaries
      }
    };
  }

  private persistCurrentState(): void {
    if (this.runId) {
      this.activeSessionsMap.set(this.runId, this.getFullState());
    }
    const sessionsObj: Record<string, ActiveSessionStore> = {};
    this.activeSessionsMap.forEach((val, key) => (sessionsObj[key] = val));
    this.persistence.saveActiveSessions(this.runId, sessionsObj);
  }

  private restoreFromPersistence(): void {
    const mapStore = this.persistence.loadActiveSessions();
    if (mapStore) {
      Object.entries(mapStore.sessions || {}).forEach(([k, v]) => this.activeSessionsMap.set(k, v));
      if (mapStore.current_run_id && this.activeSessionsMap.has(mapStore.current_run_id)) {
        this.loadRunStateFromStore(this.activeSessionsMap.get(mapStore.current_run_id)!);
      }
    }
  }

  private loadRunStateFromStore(saved: ActiveSessionStore): void {
    this.runId = saved.run_id;
    this.isMultiplayer = saved.is_multiplayer;
    this.playerCount = saved.player_count;
    this.squatRatio = saved.squat_ratio;
    this.optIn = saved.opt_in;
    this.lastProcessedFloor = saved.last_processed_floor;
    this.runStatus = saved.run_status;
    this.jogPenaltyActive = saved.jog_penalty?.active || false;
    this.jogPenaltyDeadline = saved.jog_penalty?.deadline_timestamp || null;
    this.pendingFloorEntry = null;

    this.playerDebts.clear();
    this.playerDeaths.clear();
    this.playerAggregates.clear();
    this.playerSquatRemainders.clear();
    this.playerNames.clear();
    this.playerSquatRatios.clear();
    this.pendingPlayerFloors.clear();

    if (saved.player_squat_ratios) {
      Object.entries(saved.player_squat_ratios).forEach(([k, v]) => this.playerSquatRatios.set(Number(k), v));
    }
    if (saved.pending_player_floors) {
      Object.entries(saved.pending_player_floors).forEach(([k, v]) => {
        this.pendingPlayerFloors.set(Number(k), v);
      });
    }

    Object.entries(saved.player_debts || {}).forEach(([k, v]) => this.playerDebts.set(Number(k), v));
    Object.entries(saved.player_deaths || {}).forEach(([k, v]) => this.playerDeaths.set(Number(k), v));
    Object.entries(saved.player_aggregates || {}).forEach(([k, v]) => this.playerAggregates.set(Number(k), v));
    if (saved.player_squat_remainders) {
      Object.entries(saved.player_squat_remainders).forEach(([k, v]) => this.playerSquatRemainders.set(Number(k), v));
    }
    if (saved.player_names) {
      Object.entries(saved.player_names).forEach(([k, v]) => this.playerNames.set(Number(k), v));
    }
  }
}