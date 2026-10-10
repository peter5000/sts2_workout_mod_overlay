import fs from 'fs';
import path from 'path';
import { ActiveSessionStore } from '../shared/types';

export interface WorkoutHistoryStore {
  completed_runs: {
    run_id: string;
    completed_at: number;
    outcome: 'VICTORY' | 'DEFEAT';
    floors_reached: number;
    total_counters_accrued: number;
    total_pushups: number;
    total_squats: number;
    jog_penalty_applied: boolean;
  }[];
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

  public appendHistory(entry: WorkoutHistoryStore['completed_runs'][0]): void {
    let history: WorkoutHistoryStore = { completed_runs: [] };
    if (fs.existsSync(this.historyPath)) {
      try {
        const content = fs.readFileSync(this.historyPath, 'utf-8');
        history = JSON.parse(content);
      } catch (e) {
        history = { completed_runs: [] };
      }
    }
    history.completed_runs.push(entry);
    this.atomicWrite(this.historyPath, JSON.stringify(history, null, 2));
  }

  private atomicWrite(targetPath: string, dataStr: string): void {
    const tmpPath = `${targetPath}.tmp`;
    fs.writeFileSync(tmpPath, dataStr, 'utf-8');
    fs.renameSync(tmpPath, targetPath);
  }
}
