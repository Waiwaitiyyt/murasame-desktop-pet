const { app, BrowserWindow, Menu, Tray, screen, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const Store = require('electron-store');

const store = new Store();
const isWindows = process.platform === 'win32';
const isLinux   = process.platform === 'linux';
const isMac     = process.platform === 'darwin';

// 避免 Windows 上 GPU 缓存目录权限报错
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

let mainWindow = null;
let tray = null;

// 生成简单的32x32 PNG图标（纯Node.js，无外部依赖）
function createTrayIconBuffer() {
  const size = 32;

  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function chunk(type, data) {
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(td), 0);
    return Buffer.concat([lenBuf, td, crcBuf]);
  }

  // 绘制深红圆 + 白色十字（模拟刀形）
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const cx = 16, cy = 16;
      const r2 = (x - cx) ** 2 + (y - cy) ** 2;
      const offset = y * (1 + size * 4) + 1 + x * 4;
      if (r2 <= 196) {
        raw[offset] = 160; raw[offset+1] = 30; raw[offset+2] = 50; raw[offset+3] = 230;
        if ((x >= 14 && x <= 17 && y >= 8 && y <= 24) ||
            (y >= 14 && y <= 17 && x >= 8 && x <= 24)) {
          raw[offset] = 255; raw[offset+1] = 255; raw[offset+2] = 255; raw[offset+3] = 200;
        }
      } else {
        raw[offset+3] = 0;
      }
    }
  }

  const compressed = zlib.deflateSync(raw);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 位深8，RGBA颜色类型
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

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

function setupTray() {
  const iconBuf = createTrayIconBuffer();
  const icon = nativeImage.createFromBuffer(iconBuf);
  tray = new Tray(isLinux ? icon.resize({ width: 22, height: 22 }) : icon);
  tray.setToolTip('丛雨桌宠');

  const buildMenu = () => Menu.buildFromTemplate([
    {
      label: '让丛雨休息',
      click: () => { if (mainWindow) mainWindow.webContents.send('pet-action', 'sleep'); },
    },
    {
      label: '召唤丛雨',
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.webContents.send('pet-action', 'idle'); }
        else createWindow();
      },
    },
    { type: 'separator' },
    {
      label: '设置',
      submenu: [
        {
          label: '开机自启',
          type: 'checkbox',
          checked: getAutostart(),
          click: (item) => setAutostart(item.checked),
        },
        {
          label: '置顶显示',
          type: 'checkbox',
          checked: true,
          click: (item) => { if (mainWindow) mainWindow.setAlwaysOnTop(item.checked); },
        },
      ],
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);

  tray.setContextMenu(buildMenu());
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
        `[Desktop Entry]\nType=Application\nName=丛雨宠物\nExec=${process.execPath} ${__dirname}\nHidden=false\nNoDisplay=false\nX-GNOME-Autostart-enabled=true\n`
      );
    } else if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

// ---- IPC ----

ipcMain.on('toggle-click-through', (event, enable) => {
  if (isWindows && mainWindow) mainWindow.setIgnoreMouseEvents(enable, { forward: true });
});

ipcMain.on('get-platform', (event) => { event.returnValue = process.platform; });

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
  const menu = Menu.buildFromTemplate([
    {
      label: '让丛雨休息',
      click: () => mainWindow.webContents.send('pet-action', 'sleep'),
    },
    {
      label: '召唤丛雨',
      click: () => { mainWindow.show(); mainWindow.webContents.send('pet-action', 'idle'); },
    },
    { type: 'separator' },
    {
      label: '设置',
      submenu: [
        {
          label: '开机自启',
          type: 'checkbox',
          checked: getAutostart(),
          click: (item) => setAutostart(item.checked),
        },
        {
          label: '置顶显示',
          type: 'checkbox',
          checked: mainWindow.isAlwaysOnTop(),
          click: (item) => mainWindow.setAlwaysOnTop(item.checked),
        },
      ],
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);
  menu.popup({ window: mainWindow });
});

// ---- 应用生命周期 ----

app.whenReady().then(() => {
  createWindow();
  setupTray();
});

app.on('window-all-closed', () => { /* 保持后台托盘运行 */ });
app.on('activate', () => { if (!mainWindow) createWindow(); });
