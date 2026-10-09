import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

let windowA: BrowserWindow | null = null;
let windowB: BrowserWindow | null = null;
let isClickThrough: boolean = false;

function createWindows() {
  const commonWebPreferences = {
    nodeIntegration: true,
    contextIsolation: false
  };

  const htmlPath = path.join(__dirname, 'index.html');

  // Window A: Panel A (Remainder Resolver & Workout Reps)
  windowA = new BrowserWindow({
    width: 380,
    height: 320,
    minWidth: 220,
    minHeight: 140,
    x: 50,
    y: 50,
    frame: false,
    transparent: true,
    alwaysOnTop: process.env.ELECTRON_ALWAYS_ON_TOP !== 'false',
    resizable: true,
    hasShadow: false,
    webPreferences: commonWebPreferences
  });
  windowA.loadFile(htmlPath, { query: { panel: 'a' } });

  // Window B: Panel B (Aggregate Ledger & Squat Ratio)
  windowB = new BrowserWindow({
    width: 380,
    height: 220,
    minWidth: 220,
    minHeight: 120,
    x: 50,
    y: 390,
    frame: false,
    transparent: true,
    alwaysOnTop: process.env.ELECTRON_ALWAYS_ON_TOP !== 'false',
    resizable: true,
    hasShadow: false,
    webPreferences: commonWebPreferences
  });
  windowB.loadFile(htmlPath, { query: { panel: 'b' } });

  windowA.on('closed', () => { windowA = null; });
  windowB.on('closed', () => { windowB = null; });

  // Register Global Hotkey to toggle Click-Through Mode for both windows (Ctrl+Shift+X)
  globalShortcut.register('CommandOrControl+Shift+X', () => {
    toggleClickThrough();
  });
}

function toggleClickThrough(forceState?: boolean) {
  isClickThrough = forceState !== undefined ? forceState : !isClickThrough;

  const windows = [windowA, windowB];
  windows.forEach((win) => {
    if (win && !win.isDestroyed()) {
      if (isClickThrough) {
        win.setIgnoreMouseEvents(true, { forward: true });
      } else {
        win.setIgnoreMouseEvents(false);
      }
      win.webContents.send('click-through-changed', isClickThrough);
    }
  });
}

ipcMain.on('set-click-through', (event, ignore: boolean) => {
  toggleClickThrough(ignore);
});

app.whenReady().then(() => {
  createWindows();

  app.on('activate', () => {
    if (!windowA && !windowB) {
      createWindows();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
