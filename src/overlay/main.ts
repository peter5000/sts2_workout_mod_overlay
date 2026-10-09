import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

let mainWindow: BrowserWindow | null = null;
let isClickThrough: boolean = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 720,
    x: 50,
    y: 50,
    frame: false,
    transparent: true,
    alwaysOnTop: process.env.ELECTRON_ALWAYS_ON_TOP !== 'false',
    resizable: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const htmlPath = path.join(__dirname, 'index.html');
  mainWindow.loadFile(htmlPath);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Global hotkey to toggle Click-Through Mode (Ctrl+Shift+X)
  globalShortcut.register('CommandOrControl+Shift+X', () => {
    toggleClickThrough();
  });
}

function toggleClickThrough(forceState?: boolean) {
  if (!mainWindow) return;

  isClickThrough = forceState !== undefined ? forceState : !isClickThrough;

  if (isClickThrough) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    mainWindow.setIgnoreMouseEvents(false);
  }

  mainWindow.webContents.send('click-through-changed', isClickThrough);
}

ipcMain.on('set-click-through', (event, ignore: boolean) => {
  toggleClickThrough(ignore);
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
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
