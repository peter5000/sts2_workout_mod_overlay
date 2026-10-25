import fs from 'fs';
import path from 'path';
import { ActiveSessionStore, PartyMemberSummary } from '../shared/types';

export interface FloorPlayerWorkoutLog {
  player_index: number;
  player_name: string;
  squat_ratio: number;
  counters_accrued: number;
  unresolved_debt: number;
  cumulative_pushups: number;
  cumulative_squats: number;
  deaths: number;
  hp_loss: number;
  turns_taken: number;
}

export interface FloorWorkoutLog {
  floor_num: number;
  room_type: string;
  timestamp: number;
  players: FloorPlayerWorkoutLog[];
}

export interface RunWorkoutHistoryEntry {
  run_id: string;
  start_time?: number;
  completed_at?: number;
  outcome?: 'VICTORY' | 'DEFEAT' | 'ACTIVE';
  floors_reached: number;
  total_counters_accrued: number;
  total_pushups: number;
  total_squats: number;
  jog_penalty_applied: boolean;
  party_summary?: PartyMemberSummary[];
  stage_history?: FloorWorkoutLog[];
}

export interface WorkoutHistoryStore {
  completed_runs: RunWorkoutHistoryEntry[];
}

export interface ActiveSessionsMapStore {
  current_run_id: string;
  sessions: Record<string, ActiveSessionStore>;
}

export class PersistenceManager {
  private activeSessionPath: string;
  private historyPath: string;

  constructor(baseDir?: string) {
    const dir = baseDir || process.cwd();
    this.activeSessionPath = path.join(dir, 'active_session.json');
    this.historyPath = path.join(dir, 'workout_history.json');
  }

  public saveActiveSession(data: ActiveSessionStore): void {
    this.saveActiveSessions(data.run_id, { [data.run_id]: data });
  }

  public saveActiveSessions(currentRunId: string, sessions: Record<string, ActiveSessionStore>): void {
    const data: ActiveSessionsMapStore = {
      current_run_id: currentRunId,
      sessions
    };
    this.atomicWrite(this.activeSessionPath, JSON.stringify(data, null, 2));
  }

  public loadActiveSession(): ActiveSessionStore | null {
    const mapStore = this.loadActiveSessions();
    if (!mapStore || !mapStore.current_run_id) return null;
    return mapStore.sessions[mapStore.current_run_id] || null;
  }

  public loadActiveSessions(): ActiveSessionsMapStore | null {
    if (!fs.existsSync(this.activeSessionPath)) {
      return null;
    }
    try {
      const content = fs.readFileSync(this.activeSessionPath, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed.run_id === 'string' && !parsed.sessions) {
        const single = parsed as ActiveSessionStore;
        return {
          current_run_id: single.run_id,
          sessions: { [single.run_id]: single }
        };
      }
      return parsed as ActiveSessionsMapStore;
    } catch (err) {
      console.error('[PERSISTENCE ERROR] Failed to parse active_session.json', err);
      return null;
    }
  }

  public clearActiveSession(): void {
    if (fs.existsSync(this.activeSessionPath)) {
      fs.unlinkSync(this.activeSessionPath);
    }
  }

  public saveWorkoutHistory(history: WorkoutHistoryStore): void {
    this.atomicWrite(this.historyPath, JSON.stringify(history, null, 2));
  }

  public getHistoryStore(): WorkoutHistoryStore {
    if (!fs.existsSync(this.historyPath)) {
      return { completed_runs: [] };
    }
    try {
      const content = fs.readFileSync(this.historyPath, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed && Array.isArray(parsed.completed_runs)) {
        return parsed as WorkoutHistoryStore;
      }
      return { completed_runs: [] };
    } catch (e) {
      return { completed_runs: [] };
    }
  }

  public recordFloorStage(
    runId: string,
    stage: FloorWorkoutLog,
    runMeta: {
      floors_reached: number;
      total_counters_accrued: number;
      total_pushups: number;
      total_squats: number;
      outcome?: 'VICTORY' | 'DEFEAT' | 'ACTIVE';
    }
  ): void {
    const history = this.getHistoryStore();
    let runEntry = history.completed_runs.find((r) => r.run_id === runId);

    if (!runEntry) {
      runEntry = {
        run_id: runId,
        outcome: runMeta.outcome || 'ACTIVE',
        floors_reached: runMeta.floors_reached,
        total_counters_accrued: runMeta.total_counters_accrued,
        total_pushups: runMeta.total_pushups,
        total_squats: runMeta.total_squats,
        jog_penalty_applied: runMeta.outcome === 'DEFEAT',
        stage_history: []
      };
      history.completed_runs.push(runEntry);
    }

    if (!runEntry.stage_history) {
      runEntry.stage_history = [];
    }

    const existingStageIdx = runEntry.stage_history.findIndex((s) => s.floor_num === stage.floor_num);
    if (existingStageIdx >= 0) {
      runEntry.stage_history[existingStageIdx] = stage;
    } else {
      runEntry.stage_history.push(stage);
      runEntry.stage_history.sort((a, b) => a.floor_num - b.floor_num);
    }

    runEntry.floors_reached = Math.max(runEntry.floors_reached || 0, runMeta.floors_reached);
    runEntry.total_counters_accrued = runMeta.total_counters_accrued;
    runEntry.total_pushups = runMeta.total_pushups;
    runEntry.total_squats = runMeta.total_squats;
    if (runMeta.outcome) {
      runEntry.outcome = runMeta.outcome;
    }

    this.atomicWrite(this.historyPath, JSON.stringify(history, null, 2));
  }

  public updateRunAggregates(
    runId: string,
    totalPushups: number,
    totalSquats: number,
    totalAccrued: number
  ): void {
    const history = this.getHistoryStore();
    const runEntry = history.completed_runs.find((r) => r.run_id === runId);
    if (runEntry) {
      runEntry.total_pushups = totalPushups;
      runEntry.total_squats = totalSquats;
      runEntry.total_counters_accrued = totalAccrued;
      this.atomicWrite(this.historyPath, JSON.stringify(history, null, 2));
    }
  }

  public updatePlayerDeaths(
    runId: string,
    playerIndex: number,
    deaths: number
  ): void {
    const history = this.getHistoryStore();
    const runEntry = history.completed_runs.find((r) => r.run_id === runId);
    if (runEntry) {
      if (runEntry.party_summary) {
        const pSummary = runEntry.party_summary.find((p) => p.player_index === playerIndex);
        if (pSummary) pSummary.deaths = deaths;
      }
      if (runEntry.stage_history && runEntry.stage_history.length > 0) {
        const lastStage = runEntry.stage_history[runEntry.stage_history.length - 1];
        const pStage = lastStage.players.find((p) => p.player_index === playerIndex);
        if (pStage) pStage.deaths = deaths;
      }
      this.atomicWrite(this.historyPath, JSON.stringify(history, null, 2));
    }
  }

  public appendHistory(entry: RunWorkoutHistoryEntry): void {
    const history = this.getHistoryStore();
    const existingIdx = history.completed_runs.findIndex((r) => r.run_id === entry.run_id);
    if (existingIdx >= 0) {
      const existing = history.completed_runs[existingIdx];
      history.completed_runs[existingIdx] = {
        ...existing,
        ...entry,
        stage_history: existing.stage_history || entry.stage_history || []
      };
    } else {
      history.completed_runs.push(entry);
    }
    this.atomicWrite(this.historyPath, JSON.stringify(history, null, 2));
  }

  private atomicWrite(targetPath: string, dataStr: string): void {
    const tmpPath = `${targetPath}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
    fs.writeFileSync(tmpPath, dataStr, 'utf-8');
    let attempts = 0;
    while (attempts < 5) {
      try {
        fs.renameSync(tmpPath, targetPath);
        return;
      } catch (err: any) {
        if (['EPERM', 'EBUSY', 'EACCES'].includes(err.code) && attempts < 4) {
          attempts++;
          const start = Date.now();
          while (Date.now() - start < 15) {}
        } else {
          try {
            fs.copyFileSync(tmpPath, targetPath);
            fs.unlinkSync(tmpPath);
            return;
          } catch {
            throw err;
          }
        }
      }
    }
  }
}
