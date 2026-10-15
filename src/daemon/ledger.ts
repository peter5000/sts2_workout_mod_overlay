import {
  RawRunSaveData,
  RawFloorEntry,
  PlayerFloorReport,
  ResolveRepsPayload,
  FloorCommitData,
  RunTerminatedEvent,
  PartyMemberSummary,
  PlayerInfo,
  ActiveSessionStore
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

    // Parse unprocessed floors sequentially
    const sortedFloors = [...safeFloors].sort((a, b) => (a.floor_num || 0) - (b.floor_num || 0));
    const maxFloorNum = sortedFloors.length > 0 ? sortedFloors[sortedFloors.length - 1].floor_num : 0;
    const isTerminal = runData.run_status === 'VICTORY' || runData.run_status === 'DEFEAT';

    // Immediate commit logic:
    // Floors commit immediately upon encounter completion so players can do their workout
    // during the reward screen without a 1-floor lag.
    const newFloors = sortedFloors.filter((f) => {
      if (!f || f.floor_num <= this.lastProcessedFloor) return false;
      return true;
    });

    this.pendingFloorEntry = null;

    // Check if the current processed floor had reward healing (e.g. potion or relic healing during rewards)
    if (this.lastProcessedFloor > 0 && sortedFloors.length > 0) {
      const currentFloorEntry = sortedFloors.find((f) => f && f.floor_num === this.lastProcessedFloor);
      if (currentFloorEntry && ['monster', 'elite', 'boss'].includes(currentFloorEntry.room_type)) {
        for (const metric of currentFloorEntry.player_metrics) {
          const pIdx = metric.player_index;
          const hist = this.persistence.getHistoryStore();
          const runHist = hist.completed_runs.find((r) => r.run_id === this.runId);
          const stageEntry = runHist?.stage_history?.find((s) => s.floor_num === this.lastProcessedFloor);
          const playerStageLog = stageEntry?.players.find((p) => p.player_index === pIdx);

          if (playerStageLog) {
            const currentHpLoss = Math.max(0, metric.hp_start - metric.hp_end);
            if (currentHpLoss < playerStageLog.hp_loss) {
              const healDiff = playerStageLog.hp_loss - currentHpLoss;
              const curDebt = this.playerDebts.get(pIdx) || 0;
              const newDebt = Math.max(0, curDebt - healDiff);
              this.playerDebts.set(pIdx, newDebt);

              const aggs = this.playerAggregates.get(pIdx) || { accrued: 0, pushups: 0, squats: 0 };
              aggs.accrued = Math.max(0, aggs.accrued - healDiff);
              this.playerAggregates.set(pIdx, aggs);

              playerStageLog.hp_loss = currentHpLoss;
              playerStageLog.counters_accrued = Math.max(0, playerStageLog.counters_accrued - healDiff);
              playerStageLog.unresolved_debt = newDebt;
              this.persistence.saveWorkoutHistory(hist);
            }
          }
        }
      }
    }

    if (newFloors.length > 0) {
      const allReports: PlayerFloorReport[] = [];
      let latestFloorNum = this.lastProcessedFloor;
      let latestRoomType = newFloors[newFloors.length - 1].room_type;

      for (const floorEntry of newFloors) {
        const isDefeatFloor = (runData.run_status === 'DEFEAT') && (floorEntry.floor_num === maxFloorNum);
        const floorReports = FloorParser.parseFloor(
          floorEntry,
          this.playerDeaths,
          this.playerDebts,
          this.playerAggregates,
          this.playerSquatRatios.size > 0 ? this.buildRatioMap() : this.squatRatio,
          isDefeatFloor
        );
        allReports.push(...floorReports);
        latestFloorNum = floorEntry.floor_num;
        this.recordStage(floorEntry.floor_num, floorEntry.room_type, floorReports, runData.run_status);
      }

      this.lastProcessedFloor = latestFloorNum;

      commitData = {
        floor: latestFloorNum,
        room_type: latestRoomType,
        players: allReports
      };
    }

    let terminatedEvent: RunTerminatedEvent | null = null;

    // Check terminal run status transitions
    if (runData.run_status !== 'ACTIVE' && this.runStatus === 'ACTIVE') {
      this.runStatus = runData.run_status;
      terminatedEvent = this.handleRunTermination(runData.run_status);
    }

    this.persistCurrentState();

    return { isNewRun, commitData, terminatedEvent };
  }

  public commitPendingFloor(): FloorCommitData | null {
    if (!this.pendingFloorEntry || this.pendingFloorEntry.floor_num <= this.lastProcessedFloor) {
      return null;
    }

    const floorEntry = this.pendingFloorEntry;
    this.pendingFloorEntry = null;

    const floorReports = FloorParser.parseFloor(
      floorEntry,
      this.playerDeaths,
      this.playerDebts,
      this.playerAggregates,
      this.playerSquatRatios.size > 0 ? this.buildRatioMap() : this.squatRatio,
      false
    );

    this.lastProcessedFloor = floorEntry.floor_num;
    this.recordStage(floorEntry.floor_num, floorEntry.room_type, floorReports, this.runStatus);

    const commitData: FloorCommitData = {
      floor: floorEntry.floor_num,
      room_type: floorEntry.room_type,
      players: floorReports
    };

    this.persistCurrentState();
    return commitData;
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
      } : null
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
    if (saved.player_squat_ratios) {
      Object.entries(saved.player_squat_ratios).forEach(([k, v]) => this.playerSquatRatios.set(Number(k), v));
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