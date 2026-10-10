import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import chokidar from 'chokidar';
import { RawRunSaveData } from '../shared/types';
import { normalizeSaveData } from './adapter';

export type SaveFileChangeCallback = (data: RawRunSaveData) => void;

export class SaveWatcher {
  private targetDir: string;
  private watcher: chokidar.FSWatcher | null = null;
  private lastSHA256: string = '';
  private debounceTimer: NodeJS.Timeout | null = null;
  private isProcessing: boolean = false;
  private callback: SaveFileChangeCallback;

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
      ignoreInitial: false,
      awaitWriteFinish: false,
      depth: 2
    });

    const triggerFileCheck = (filePath: string) => {
      const fileName = path.basename(filePath);
      const isCurrentSave = fileName === 'current_run.save' || fileName === 'current_run_mp.save';
      const isHistoryRun = (filePath.includes('history') || filePath.includes('saves')) && (fileName.endsWith('.run') || fileName.endsWith('.save')) && fileName !== 'prefs.save' && fileName !== 'progress.save';

      if (isCurrentSave || isHistoryRun) {
        this.scheduleDebouncedRead(filePath);
      }
    };

    const handleUnlink = (filePath: string) => {
      const fileName = path.basename(filePath);
      if (fileName === 'current_run.save' || fileName === 'current_run_mp.save') {
        console.log(`[SAVE WATCHER] current_run.save removed. Checking history directory for completed run...`);
        this.checkLatestHistoryRun();
      }
    };

    this.watcher.on('add', triggerFileCheck);
    this.watcher.on('change', triggerFileCheck);
    this.watcher.on('unlink', handleUnlink);
  }

  private checkLatestHistoryRun(): void {
    const historyDir = path.join(this.targetDir, 'history');
    if (!fs.existsSync(historyDir)) return;

    try {
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
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
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

    try {
      const raw = JSON.parse(content);
      const parsed = normalizeSaveData(raw);
      console.log(`[SAVE WATCHER] Parsed save checkpoint update for run_id: ${parsed.run_id}`);
      this.callback(parsed);
    } catch (err) {
      console.error(`[SAVE WATCHER ERROR] Failed to parse save file JSON:`, err);
    } finally {
      this.isProcessing = false;
    }
  }
}
