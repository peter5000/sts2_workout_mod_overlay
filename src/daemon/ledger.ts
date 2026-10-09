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

    // Check if this is a new run
    if (this.runId !== runData.run_id) {
      this.initNewRun(runData);
      isNewRun = true;
    } else {
      this.players = runData.players;
      this.isMultiplayer = runData.is_multiplayer;
      this.playerCount = runData.player_count;
    }

    let commitData: FloorCommitData | null = null;

    // Parse unprocessed floors sequentially
    const sortedFloors = [...runData.floors].sort((a, b) => a.floor_num - b.floor_num);
    const newFloors = sortedFloors.filter((f) => f.floor_num > this.lastProcessedFloor);

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

    let debtDeduction = 0;
    let pushupsAdded = 0;
    let squatsAdded = 0;

    switch (payload.action_type) {
      case 'CUSTOM_ENTRY':
        const reps = payload.reps || 0;
        if (payload.exercise === 'pushups') {
          debtDeduction = reps;
          pushupsAdded = reps;
        } else if (payload.exercise === 'squats') {
          debtDeduction = Math.floor(reps / ratio);
          squatsAdded = reps;
        }
        break;

      case 'ALL_PUSHUPS':
        debtDeduction = currentDebt;
        pushupsAdded = currentDebt;
        break;

      case 'ALL_SQUATS':
        debtDeduction = currentDebt;
        squatsAdded = currentDebt * ratio;
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

    this.playerDebts.forEach((val, key) => (debtsObj[key] = val));
    this.playerDeaths.forEach((val, key) => (deathsObj[key] = val));
    this.playerAggregates.forEach((val, key) => (aggsObj[key] = val));

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
    this.runId = runData.run_id;
    this.isMultiplayer = runData.is_multiplayer;
    this.playerCount = runData.player_count;
    this.players = runData.players;
    this.lastProcessedFloor = 0;
    this.runStatus = 'ACTIVE';

    this.playerDebts.clear();
    this.playerDeaths.clear();
    this.playerAggregates.clear();

    for (const p of runData.players) {
      this.playerDebts.set(p.index, 0);
      this.playerDeaths.set(p.index, 0);
      this.playerAggregates.set(p.index, { accrued: 0, pushups: 0, squats: 0 });
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
    this.persistence.saveActiveSession(this.getFullState());
  }

  private restoreFromPersistence(): void {
    const saved = this.persistence.loadActiveSession();
    if (saved) {
      this.runId = saved.run_id;
      this.isMultiplayer = saved.is_multiplayer;
      this.playerCount = saved.player_count;
      this.squatRatio = saved.squat_ratio;
      this.optIn = saved.opt_in;
      this.lastProcessedFloor = saved.last_processed_floor;
      this.runStatus = saved.run_status;
      this.jogPenaltyActive = saved.jog_penalty.active;
      this.jogPenaltyDeadline = saved.jog_penalty.deadline_timestamp;

      Object.entries(saved.player_debts).forEach(([k, v]) => this.playerDebts.set(Number(k), v));
      Object.entries(saved.player_deaths).forEach(([k, v]) => this.playerDeaths.set(Number(k), v));
      Object.entries(saved.player_aggregates).forEach(([k, v]) => this.playerAggregates.set(Number(k), v));
    }
  }
}
