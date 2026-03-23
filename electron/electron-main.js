const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } = require('electron');
const path = require('path');
const { exec } = require('child_process');

// ─── Windows Focus Assist (Do Not Disturb) ────────────────────────────────────
function setFocusAssist(enable) {
  if (process.platform !== 'win32') return;
  // Disable/enable toast notifications via registry
  const value = enable ? 0 : 1;
  exec(`powershell -Command "Set-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\PushNotifications' -Name ToastEnabled -Value ${value} -Type DWord"`,
    (err) => { if (err) console.log('FocusAssist:', err.message); }
  );
}

let mainWindow = null;
let widgetWindow = null;
let tray = null;

// ─── Main Window ──────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 780,
    minWidth: 400,
    minHeight: 600,
    title: 'Flow Timer',
    icon: path.join(__dirname, 'assets', 'icon-512.png'),
    backgroundColor: '#1a1a2e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'electron-preload.js')
    },
    autoHideMenuBar: true,
    show: false
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', e => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      tray.displayBalloon({
        title: 'Flow Timer',
        content: 'Still running in the background. Click the tray icon to reopen.'
      });
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── Floating Widget ──────────────────────────────────────────────────────────
function createWidget() {
  if (widgetWindow) { widgetWindow.focus(); return; }

  widgetWindow = new BrowserWindow({
    width: 220,
    height: 280,
    resizable: false,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    title: 'Flow Timer Widget',
    icon: path.join(__dirname, 'assets', 'icon-192.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'electron-preload.js')
    }
  });

  widgetWindow.loadFile('pip.html');

  // Position: bottom-right corner
  const { screen } = require('electron');
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  widgetWindow.setPosition(width - 240, height - 300);

  widgetWindow.on('closed', () => { widgetWindow = null; });
}

// ─── System Tray ─────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon-192.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Flow Timer');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Flow Timer',
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
        else createMainWindow();
      }
    },
    {
      label: 'Float Widget',
      click: () => {
        if (widgetWindow) { widgetWindow.close(); }
        else createWidget();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    else createMainWindow();
  });
}

// ─── IPC ──────────────────────────────────────────────────────────────────────
ipcMain.on('open-widget', () => createWidget());
ipcMain.on('close-widget', () => { if (widgetWindow) widgetWindow.close(); });
ipcMain.on('focus-assist', (_, on) => setFocusAssist(on));
ipcMain.on('timer-state', (_, data) => {
  if (widgetWindow) widgetWindow.webContents.send('timer-state', data);
  // Enable Focus Assist when timer is running, disable when stopped/paused
  if (data.running) setFocusAssist(true);
  else setFocusAssist(false);
});

// ─── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createMainWindow();
  createTray();
  createWidget();

  app.on('activate', () => {
    if (!mainWindow) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
