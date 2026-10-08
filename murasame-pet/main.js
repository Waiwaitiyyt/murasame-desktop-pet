const { app, BrowserWindow, Menu, Tray, screen, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Store = require('electron-store');
const { languageNames, detectLanguage, translator } = require('./i18n');

const store = new Store();
const isWindows = process.platform === 'win32';
const isLinux   = process.platform === 'linux';
const isMac     = process.platform === 'darwin';

// 避免 Windows 上 GPU 缓存目录权限报错
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

let mainWindow = null;
let tray = null;


function createWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const defaultX = sw - 150 - 20;
  const defaultY = sh - 340 - 20;
  const winX = store.get('windowX', defaultX);
  const winY = store.get('windowY', defaultY);

  const opts = {
    width: 150,
    height: 340,
    x: winX,
    y: winY,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false, // 允许加载上级目录的本地PNG文件
    },
  };

  if (isLinux) opts.type = 'toolbar'; // Linux：避免显示在任务栏

  mainWindow = new BrowserWindow(opts);
  mainWindow.loadFile('index.html');

  // Windows：初始启用鼠标穿透，鼠标进入角色时由渲染进程关闭
  if (isWindows) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  }

  mainWindow.on('moved', () => {
    const [x, y] = mainWindow.getPosition();
    store.set('windowX', x);
    store.set('windowY', y);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function changeCostume(key) {
  store.set('costume', key);
  if (mainWindow) mainWindow.webContents.send('pet-action', 'costume:' + key);
}

function getLanguage() {
  return store.get('language', detectLanguage(app.getLocale()));
}

function changeLanguage(lang) {
  store.set('language', lang);
  refreshTray();
}

function buildMenu() {
  const costume = store.get('costume', 'sword');
  const lang = getLanguage();
  const t = translator(lang);
  return Menu.buildFromTemplate([
    {
      label: t('sleep'),
      click: () => { if (mainWindow) mainWindow.webContents.send('pet-action', 'sleep'); },
    },
    {
      label: t('hide'),
      click: () => { if (mainWindow) mainWindow.hide(); },
    },
    {
      label: t('summon'),
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.webContents.send('pet-action', 'idle'); }
        else createWindow();
      },
    },
    { type: 'separator' },
    {
      label: t('costume'),
      submenu: [
        { label: t('sword'),   type: 'radio', checked: costume === 'sword',   click: () => changeCostume('sword') },
        { label: t('uniform'), type: 'radio', checked: costume === 'uniform', click: () => changeCostume('uniform') },
        { label: t('dress'),   type: 'radio', checked: costume === 'dress',   click: () => changeCostume('dress') },
      ],
    },
    {
      label: t('settings'),
      submenu: [
        {
          label: t('autostart'),
          type: 'checkbox',
          checked: getAutostart(),
          click: (item) => setAutostart(item.checked),
        },
        {
          label: t('alwaysOnTop'),
          type: 'checkbox',
          checked: mainWindow ? mainWindow.isAlwaysOnTop() : true,
          click: (item) => { if (mainWindow) mainWindow.setAlwaysOnTop(item.checked); },
        },
        {
          label: t('language'),
          submenu: Object.entries(languageNames).map(([key, name]) => ({
            label: name,
            type: 'radio',
            checked: lang === key,
            click: () => changeLanguage(key),
          })),
        },
      ],
    },
    { type: 'separator' },
    { label: t('quit'), click: () => app.quit() },
  ]);
}

// 语言切换后刷新托盘提示与菜单（Windows 每次右键都会重建，无需 setContextMenu）
function refreshTray() {
  if (!tray) return;
  tray.setToolTip(translator(getLanguage())('appName'));
  if (!isWindows) tray.setContextMenu(buildMenu());
}

function setupTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(isLinux ? icon.resize({ width: 22, height: 22 }) : icon);

  if (isWindows) {
    // Windows 每次右键重建菜单，确保 checkbox 状态最新
    tray.on('right-click', () => {
      tray.popUpContextMenu(buildMenu());
    });
  }
  refreshTray();

  tray.on('click', () => {
    if (mainWindow) mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

// ---- 自启动 ----

function getAutostart() {
  if (isWindows || isMac) return app.getLoginItemSettings().openAtLogin;
  if (isLinux) return fs.existsSync(path.join(os.homedir(), '.config', 'autostart', 'murasame-pet.desktop'));
  return false;
}

function setAutostart(enable) {
  if (isWindows || isMac) { app.setLoginItemSettings({ openAtLogin: enable }); return; }
  if (isLinux) {
    const dir  = path.join(os.homedir(), '.config', 'autostart');
    const file = path.join(dir, 'murasame-pet.desktop');
    if (enable) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file,
        `[Desktop Entry]\nType=Application\nName=丛雨桌宠\nExec=${process.execPath} ${__dirname}\nHidden=false\nNoDisplay=false\nX-GNOME-Autostart-enabled=true\n`
      );
    } else if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

// ---- IPC ----

ipcMain.on('toggle-click-through', (event, enable) => {
  if (isWindows && mainWindow) mainWindow.setIgnoreMouseEvents(enable, { forward: true });
});

ipcMain.on('get-platform', (event) => { event.returnValue = process.platform; });

ipcMain.on('get-costume', (event) => { event.returnValue = store.get('costume', 'sword'); });

ipcMain.on('get-fgimages-path', (event) => {
  const devPath  = path.join(__dirname, '..', 'fgimages');
  const prodPath = path.join(process.resourcesPath || '', 'fgimages');
  event.returnValue = fs.existsSync(devPath) ? devPath : prodPath;
});

ipcMain.on('move-window', (event, { x, y }) => {
  if (mainWindow) mainWindow.setPosition(Math.round(x), Math.round(y));
});

ipcMain.on('show-context-menu', () => {
  if (!mainWindow) return;
  buildMenu().popup({ window: mainWindow });
});

// ---- 应用生命周期 ----

app.whenReady().then(() => {
  createWindow();
  setupTray();
});

app.on('window-all-closed', () => { /* 保持后台托盘运行 */ });
app.on('activate', () => { if (!mainWindow) createWindow(); });
