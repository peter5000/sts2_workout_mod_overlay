import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// Disable hardware acceleration for transparent overlay windows to prevent GPU process crashes
app.disableHardwareAcceleration();

// Ignore SSL certificate errors to allow secure WebSocket & HTTPS tunnels (e.g. ngrok)
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('allow-insecure-localhost');

app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  event.preventDefault();
  callback(true);
});

// Enforce Single Instance Lock to prevent process & Alt+Tab multiplication
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let windowA: BrowserWindow | null = null;
let windowB: BrowserWindow | null = null;
let isClickThrough: boolean = false;

function reassertAlwaysOnTop() {
  if (process.env.ELECTRON_ALWAYS_ON_TOP === 'false') return;
  [windowA, windowB].forEach((win) => {
    if (win && !win.isDestroyed()) {
      win.setAlwaysOnTop(true, 'screen-saver', 1);
      win.moveTop();
    }
  });
}

let zOrderInterval: NodeJS.Timeout | null = null;
let isQuitting: boolean = false;

function cleanTeardown() {
  if (isQuitting) return;
  isQuitting = true;

  if (zOrderInterval) {
    clearInterval(zOrderInterval);
    zOrderInterval = null;
  }

  try {
    globalShortcut.unregisterAll();
  } catch {}

  [windowA, windowB].forEach((win) => {
    if (win && !win.isDestroyed()) {
      try {
        win.removeAllListeners();
        win.destroy();
      } catch {}
    }
  });
  windowA = null;
  windowB = null;

  try {
    app.quit();
  } catch {}

  // Force clean termination of all child processes (GPU, renderers, utility)
  setTimeout(() => {
    process.exit(0);
  }, 100);
}

function checkAllClosed() {
  if (!windowA && !windowB) {
    cleanTeardown();
  }
}

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
    skipTaskbar: true, // Prevents Taskbar & Alt+Tab window multiplication
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
    skipTaskbar: true, // Prevents Taskbar & Alt+Tab window multiplication
    resizable: true,
    hasShadow: false,
    webPreferences: commonWebPreferences
  });
  windowB.loadFile(htmlPath, { query: { panel: 'b' } });

  reassertAlwaysOnTop();

  windowA.on('closed', () => { 
    windowA = null; 
    checkAllClosed();
  });
  windowB.on('closed', () => { 
    windowB = null; 
    checkAllClosed();
  });

  windowA.on('blur', () => { reassertAlwaysOnTop(); });
  windowB.on('blur', () => { reassertAlwaysOnTop(); });

  // Register Global Hotkey to toggle Click-Through Mode for both windows (Ctrl+Shift+X)
  globalShortcut.register('CommandOrControl+Shift+X', () => {
    toggleClickThrough();
  });

  // Register Global Hotkey to Force Bring Overlay Windows to Top (Ctrl+Shift+Z)
  globalShortcut.register('CommandOrControl+Shift+Z', () => {
    reassertAlwaysOnTop();
  });

  // Periodic z-order enforcer loop (every 2.5s) to prevent Windows DWM / game fullscreen demotion
  if (zOrderInterval) {
    clearInterval(zOrderInterval);
  }
  zOrderInterval = setInterval(() => {
    reassertAlwaysOnTop();
  }, 2500);
  zOrderInterval.unref(); // Prevent interval from keeping the event loop alive
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

// IPC handler to close an individual overlay window
ipcMain.on('close-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    win.close();
  }
});

// IPC handler to close all overlays and terminate the application immediately
ipcMain.on('quit-app', () => {
  cleanTeardown();
});

app.on('second-instance', () => {
  if (windowA && !windowA.isDestroyed()) {
    windowA.focus();
  }
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
  cleanTeardown();
});

app.on('window-all-closed', () => {
  cleanTeardown();
});
