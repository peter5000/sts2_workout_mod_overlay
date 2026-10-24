import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import chokidar from 'chokidar';
import dotenv from 'dotenv';
import { RawRunSaveData } from '../shared/types';
import { normalizeSaveData } from './adapter';

export type SaveFileChangeCallback = (data: RawRunSaveData) => void;

export class SaveWatcher {
  private targetDir: string;
  private watcher: chokidar.FSWatcher | null = null;
  private envWatcher: chokidar.FSWatcher | null = null;
  private lastFilePath: string | null = null;
  private lastSHA256: string = '';
  private debounceTimer: NodeJS.Timeout | null = null;
  private isProcessing: boolean = false;
  private callback: SaveFileChangeCallback;
  private activeStartTime: number | string | null = null;
  private activeRunId: string | null = null;

  constructor(targetDir: string, callback: SaveFileChangeCallback) {
    this.targetDir = targetDir;
    this.callback = callback;
  }

  public start(): void {
    if (!fs.existsSync(this.targetDir)) {
      fs.mkdirSync(this.targetDir, { recursive: true });
    }

    console.log(`[SAVE WATCHER] Watching directory: ${this.targetDir}`);

    this.watcher = chokidar.watch(this.targetDir, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: false,
      depth: 1
    });

    const triggerFileCheck = (filePath: string) => {
      const fileName = path.basename(filePath);
      const isCurrentSave = fileName === 'current_run.save' || fileName === 'current_run_mp.save';
      if (isCurrentSave) {
        this.scheduleDebouncedRead(filePath);
      }
    };

    const handleUnlink = (filePath: string) => {
      const fileName = path.basename(filePath);
      if (fileName === 'current_run.save' || fileName === 'current_run_mp.save') {
        console.log(`[SAVE WATCHER] Active save removed (${fileName}). Checking history directory for completed run...`);
        setTimeout(() => {
          this.checkLatestHistoryRun();
        }, 150);
      }
    };

    this.watcher.on('add', triggerFileCheck);
    this.watcher.on('change', triggerFileCheck);
    this.watcher.on('unlink', handleUnlink);

    // Watch .env for live configuration / player name updates
    const envFilePath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envFilePath)) {
      this.envWatcher = chokidar.watch(envFilePath, { persistent: true });
      this.envWatcher.on('change', () => {
        console.log('[SAVE WATCHER] .env modification detected. Reloading player names...');
        try {
          dotenv.config({ override: true });
        } catch {}
        this.reloadCurrent();
      });
    }

    // Initial targeted scan for newest active save file
    this.scanInitialActiveSave();
  }

  private scanInitialActiveSave(): void {
    try {
      const spSave = path.join(this.targetDir, 'current_run.save');
      const mpSave = path.join(this.targetDir, 'current_run_mp.save');

      const spExists = fs.existsSync(spSave);
      const mpExists = fs.existsSync(mpSave);

      let targetSavePath: string | null = null;

      if (spExists && mpExists) {
        const spMtime = fs.statSync(spSave).mtimeMs;
        const mpMtime = fs.statSync(mpSave).mtimeMs;
        targetSavePath = mpMtime >= spMtime ? mpSave : spSave;
      } else if (mpExists) {
        targetSavePath = mpSave;
      } else if (spExists) {
        targetSavePath = spSave;
      }

      if (targetSavePath) {
        console.log(`[SAVE WATCHER] Initial active save detected: ${targetSavePath}`);
        this.scheduleDebouncedRead(targetSavePath);
      } else {
        console.log(`[SAVE WATCHER] No active current_run.save or current_run_mp.save found on startup.`);
      }
    } catch (err) {
      console.error(`[SAVE WATCHER ERROR] Initial save scan failed:`, err);
    }
  }

  private async checkLatestHistoryRun(): Promise<void> {
    const historyDir = path.join(this.targetDir, 'history');
    if (!fs.existsSync(historyDir)) return;

    try {
      // 1. If we know the active run's start_time, specifically look for <start_time>.run
      if (this.activeStartTime) {
        const targetedFile = path.join(historyDir, `${this.activeStartTime}.run`);
        const retryDelays = [50, 150, 300];
        for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
          if (fs.existsSync(targetedFile)) {
            console.log(`[SAVE WATCHER] Ingesting targeted run history file: ${targetedFile}`);
            this.scheduleDebouncedRead(targetedFile);
            return;
          }
          if (attempt < retryDelays.length) {
            await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
          }
        }
      }

      // 2. Fallback to newest .run file by mtime if targeted file not found
      const files = fs.readdirSync(historyDir)
        .filter((f) => f.endsWith('.run') || (f.endsWith('.save') && !f.startsWith('prefs') && !f.startsWith('progress')))
        .map((f) => path.join(historyDir, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

      if (files.length > 0) {
        const latestHistoryFile = files[0];
        console.log(`[SAVE WATCHER] Ingesting latest run history file: ${latestHistoryFile}`);
        this.scheduleDebouncedRead(latestHistoryFile);
      }
    } catch (err) {
      console.error(`[SAVE WATCHER ERROR] Failed to check history directory:`, err);
    }
  }

  public stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.envWatcher) {
      this.envWatcher.close();
      this.envWatcher = null;
    }
  }

  public reloadCurrent(): void {
    if (this.lastFilePath && fs.existsSync(this.lastFilePath)) {
      this.lastSHA256 = '';
      this.scheduleDebouncedRead(this.lastFilePath);
    }
  }

  private scheduleDebouncedRead(filePath: string): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    // 75ms debounce delay per architecture specification
    this.debounceTimer = setTimeout(() => {
      this.readSaveWithRetry(filePath);
    }, 75);
  }

  private async readSaveWithRetry(filePath: string): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    const delays = [25, 50, 100, 200];
    let content: string | null = null;

    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        content = fs.readFileSync(filePath, 'utf-8');
        break; // Read successful
      } catch (err: any) {
        if (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES') {
          if (attempt < delays.length) {
            await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
            continue;
          }
        }
        console.error(`[SAVE WATCHER ERROR] Failed to read save file after retries:`, err);
        this.isProcessing = false;
        return;
      }
    }

    if (!content) {
      this.isProcessing = false;
      return;
    }

    // Compute SHA-256 hash digest to check for payload duplication
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    if (hash === this.lastSHA256) {
      this.isProcessing = false;
      return; // Payload unchanged
    }

    this.lastSHA256 = hash;
    this.lastFilePath = filePath;

    try {
      // Pre-sanitize 64-bit integer IDs (15+ digits) into strings to prevent JavaScript IEEE 754 precision loss
      // (e.g. Steam ID 10000009900000001 getting rounded to 10000000000000003)
      const sanitized = content.replace(/"(player_id|net_id|steam_id|account_id|id)":\s*(\d{15,})/g, '"$1": "$2"');
      const raw = JSON.parse(sanitized);
      if (raw && (typeof raw.start_time === 'number' || typeof raw.start_time === 'string')) {
        this.activeStartTime = raw.start_time;
      }
      const parsed = normalizeSaveData(raw);
      this.activeRunId = parsed.run_id;
      console.log(`[SAVE WATCHER] Parsed save checkpoint update for run_id: ${parsed.run_id}`);
      this.callback(parsed);
    } catch (err) {
      console.error(`[SAVE WATCHER ERROR] Failed to parse save file JSON:`, err);
    } finally {
      this.isProcessing = false;
    }
  }
}