import {
  RawRunSaveData,
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
  private activeSessionsMap: Map<string, ActiveSessionStore> = new Map();

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

    let commitData: FloorCommitData | null = null;

    // Parse unprocessed floors sequentially
    const sortedFloors = [...safeFloors].sort((a, b) => (a.floor_num || 0) - (b.floor_num || 0));
    const newFloors = sortedFloors.filter((f) => f && f.floor_num > this.lastProcessedFloor);

    if (newFloors.length > 0) {
      const allReports: PlayerFloorReport[] = [];
      let latestFloorNum = this.lastProcessedFloor;
      let latestRoomType = newFloors[newFloors.length - 1].room_type;

      for (const floorEntry of newFloors) {
        const floorReports = FloorParser.parseFloor(
          floorEntry,
          this.playerDeaths,
          this.playerDebts,
          this.playerAggregates,
          this.squatRatio
        );
        allReports.push(...floorReports);
        latestFloorNum = floorEntry.floor_num;
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

  public resolveReps(payload: ResolveRepsPayload): { success: boolean; updatedDebt: number; updatedPushups: number; updatedSquats: number } {
    const idx = payload.player_index;
    const currentDebt = this.playerDebts.get(idx) || 0;
    const aggs = this.playerAggregates.get(idx) || { accrued: 0, pushups: 0, squats: 0 };
    const ratio = payload.applied_ratio || this.squatRatio;
    const currentRemainder = this.playerSquatRemainders.get(idx) || 0;

    let debtDeduction = 0;
    let pushupsAdded = 0;
    let squatsAdded = 0;

    switch (payload.action_type) {
      case 'CUSTOM_ENTRY':
        const reps = payload.reps || 0;
        if (payload.exercise === 'pushups') {
          debtDeduction = Math.min(reps, currentDebt);
          pushupsAdded = reps;
        } else if (payload.exercise === 'squats') {
          const totalSquats = currentRemainder + reps;
          debtDeduction = Math.min(Math.floor(totalSquats / ratio), currentDebt);
          const newRemainder = totalSquats % ratio;
          this.playerSquatRemainders.set(idx, newRemainder);
          squatsAdded = reps;
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

    return {
      success: true,
      updatedDebt: newDebt,
      updatedPushups: aggs.pushups,
      updatedSquats: aggs.squats
    };
  }

  public setSquatRatio(ratio: number): void {
    if (ratio >= 1) {
      this.squatRatio = ratio;
      this.persistCurrentState();
    }
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

    this.playerDebts.forEach((val, key) => (debtsObj[key] = val));
    this.playerDeaths.forEach((val, key) => (deathsObj[key] = val));
    this.playerAggregates.forEach((val, key) => (aggsObj[key] = val));
    this.playerSquatRemainders.forEach((val, key) => (remaindersObj[key] = val));

    return {
      run_id: this.runId,
      is_multiplayer: this.isMultiplayer,
      player_count: this.playerCount,
      squat_ratio: this.squatRatio,
      opt_in: this.optIn,
      last_processed_floor: this.lastProcessedFloor,
      player_debts: debtsObj,
      player_deaths: deathsObj,
      player_aggregates: aggsObj,
      player_squat_remainders: remaindersObj,
      run_status: this.runStatus,
      jog_penalty: {
        active: this.jogPenaltyActive,
        deadline_timestamp: this.jogPenaltyDeadline
      }
    };
  }

  public getPlayers(): PlayerInfo[] {
    return this.players;
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

    this.playerDebts.clear();
    this.playerDeaths.clear();
    this.playerAggregates.clear();
    this.playerSquatRemainders.clear();

    for (const p of this.players) {
      const idx = typeof p.index === 'number' ? p.index : 0;
      this.playerDebts.set(idx, 0);
      this.playerDeaths.set(idx, 0);
      this.playerAggregates.set(idx, { accrued: 0, pushups: 0, squats: 0 });
      this.playerSquatRemainders.set(idx, 0);
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

    let totalAccrued = 0;
    let totalPushups = 0;
    let totalSquats = 0;
    this.playerAggregates.forEach((aggs) => {
      totalAccrued += aggs.accrued;
      totalPushups += aggs.pushups;
      totalSquats += aggs.squats;
    });

    // Save to historical ledger
    this.persistence.appendHistory({
      run_id: this.runId,
      completed_at: Date.now(),
      outcome,
      floors_reached: this.lastProcessedFloor,
      total_counters_accrued: totalAccrued,
      total_pushups: totalPushups,
      total_squats: totalSquats,
      jog_penalty_applied: isDefeat
    });

    this.activeSessionsMap.delete(this.runId);

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

    this.playerDebts.clear();
    this.playerDeaths.clear();
    this.playerAggregates.clear();
    this.playerSquatRemainders.clear();

    Object.entries(saved.player_debts || {}).forEach(([k, v]) => this.playerDebts.set(Number(k), v));
    Object.entries(saved.player_deaths || {}).forEach(([k, v]) => this.playerDeaths.set(Number(k), v));
    Object.entries(saved.player_aggregates || {}).forEach(([k, v]) => this.playerAggregates.set(Number(k), v));
    if (saved.player_squat_remainders) {
      Object.entries(saved.player_squat_remainders).forEach(([k, v]) => this.playerSquatRemainders.set(Number(k), v));
    }
  }
}
