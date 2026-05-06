# 丛雨桌宠 (Murasame Pet)

基于 Electron 的透明桌面角色应用，使用分层 PNG 合成实现多状态动画。

---

## 技术栈

| 层次 | 技术 | 版本 | 作用 |
|------|------|------|------|
| 桌面容器 | Electron | v28 | 创建透明无边框窗口，暴露 Node.js 能力给渲染层 |
| 渲染层 | HTML5 / CSS3 / 原生 JS | — | 无框架，直接操作 DOM 和 CSS 动画 |
| 持久化 | electron-store | v8 | JSON 文件存储窗口位置、自启设置 |
| 打包 | electron-builder | v24 | 生成 Windows NSIS 安装包 / Linux AppImage |

---

## 核心原理

### 1. 透明窗口与点击穿透

`main.js` 在创建窗口时使用以下关键参数：

```js
new BrowserWindow({
  transparent: true,   // 窗口背景透明
  frame: false,        // 无系统标题栏
  alwaysOnTop: true,   // 始终置顶
  skipTaskbar: true,   // 不显示在任务栏
})
```

**点击穿透（Windows 专属）：** Electron 本身不能做到"悬停可交互、其他区域穿透"，因此通过 IPC 消息动态切换：

- 鼠标悬停时 → `win.setIgnoreMouseEvents(false)` → 可接收点击
- 鼠标离开时 → `win.setIgnoreMouseEvents(true, { forward: true })` → 事件穿透到桌面

`{ forward: true }` 表示穿透的同时仍将鼠标坐标转发给渲染进程，使悬停检测得以工作。

---

### 2. 分层 PNG 合成系统

角色由 **15 张独立 PNG 层**叠加构成，全部使用 `position: absolute` 堆叠在同一个容器中：

```
身体层 (body)          ← z-index 低
  └─ 抬手身体 (body-arm-up)
表情层 (face-*)        ← 按需显示其中一张
效果层 (blush / hair)  ← z-index 高
```

每个状态对应一组"哪些层可见"的配置，由 `PetStateMachine.updateLayers()` 统一管理。切换状态本质上是切换各层的 `display: none / block`。

**图片路径解析：** 运行时区分开发/生产环境：

```js
// 开发：从项目上级目录读取
path.join(__dirname, '../fgimages')

// 生产（打包后）：从 asar 外的资源目录读取
path.join(process.resourcesPath, 'fgimages')
```

打包时需将 `fgimages/` 目录放在 `extraResources` 中，否则生产包找不到图片。

---

### 3. 状态机（PetStateMachine）

状态机是整个行为逻辑的核心，定义在 `renderer.js`。

**8 个状态：**

| 状态 | 触发方式 | 持续时长 | 返回状态 |
|------|----------|----------|----------|
| `idle` | 默认 / 计时器到期 | — | — |
| `happy` | 单击（50%） | 2s | idle |
| `shy` | 单击（50%） | 2s | idle |
| `angry` | — | 2s | idle |
| `surprised` | — | 2s | idle |
| `drag` | 拖拽中 | 持续 | idle（落地后） |
| `sleep` | 空闲 5 分钟 | 持续 | idle（点击唤醒） |
| `call_master` | 双击 / 随机事件 | 3s | idle |
| `sword` | 快速点击 5 次 | 2s | idle |

**状态切换流程：**

```
setState(newState)
  → 清除当前计时器
  → 调用 updateLayers(newState)  // 更新图层可见性
  → 触发对应 CSS 动画类
  → 设置 autoReturnTimer 自动回到 idle
```

**三个后台计时器（互相独立）：**

- `idleTimer`：5 分钟无交互 → 进入 sleep
- `randomEventTimer`：5~15 分钟触发一次随机事件（call_master 或 happy）
- `blinkTimer`：3~7 秒随机眨眼

---

### 4. 动画系统

动画全部用 **纯 CSS `@keyframes`** 实现，定义在 `styles/animations.css`。

渲染层通过给容器 div 添加/移除 CSS 类来切换动画：

```js
container.classList.remove('state-idle', 'state-happy', ...)
container.classList.add(`state-${newState}`)
```

**缩放原理：** 原图尺寸约 3600×5100px，窗口为 150×280px，通过 CSS `transform: scale(0.0944)` 整体缩小，使用 `transform-origin: top left` 锚定基准点。

---

### 5. IPC 通信架构

Electron 强制隔离主进程（Node.js）和渲染进程（浏览器），两者通过 `ipcMain` / `ipcRenderer` 传消息：

| 频道 | 方向 | 功能 |
|------|------|------|
| `toggle-click-through` | 渲染 → 主 | 开关鼠标穿透 |
| `get-platform` | 渲染 → 主 | 获取操作系统类型 |
| `get-fgimages-path` | 渲染 → 主 | 获取图片目录绝对路径 |
| `move-window` | 渲染 → 主 | 拖拽时更新窗口位置 |
| `show-context-menu` | 渲染 → 主 | 显示右键菜单 |

---

### 6. 数据持久化

使用 `electron-store` 存储用户偏好，数据保存在系统 AppData 目录的 JSON 文件中：

```js
const store = new Store()
store.set('windowPosition', { x, y })  // 保存位置
store.get('windowPosition')            // 读取位置
```

---

## 目录结构

```
murasame-pet/
├── main.js            # 主进程：窗口、托盘、IPC、自启
├── renderer.js        # 渲染进程：状态机、交互逻辑、图层控制
├── index.html         # 窗口 HTML：图层容器、气泡、ZZZ 等 UI 元素
├── styles/
│   └── animations.css # 所有状态的 CSS 关键帧动画
├── assets/            # 应用图标（icon.ico / icon.png）
└── package.json       # 依赖、构建配置
```

图片资源（独立目录，不在项目内）：

```
../fgimages/           # 开发时位于项目上级目录
  ├── 体_通常.png      # 正常身体
  ├── 体_腕上げ.png    # 抬手身体
  ├── 顔_通常.png      # 默认表情
  ├── 顔_笑い.png      # 微笑
  └── ...              # 其他表情和效果层
```

---

## 开发流程

```bash
# 安装依赖
npm install

# 开发运行（需要 ../fgimages 目录存在）
npm start

# 打包 Windows 安装包
npm run build:win

# 打包 Linux AppImage
npm run build:linux
```

---

## 扩展指南

### 添加新状态

1. 在 `renderer.js` 的 `PetStateMachine` 中新增状态名
2. 在 `updateLayers()` 中定义该状态显示哪些图层
3. 在 `animations.css` 中添加对应的 `@keyframes` 和 `.state-xxx` 类
4. 在 `setState()` 的触发逻辑中加入切换条件

### 添加新表情层

1. 将新 PNG 放入 `fgimages/` 目录
2. 在 `index.html` 中添加对应 `<img>` 元素
3. 在 `renderer.js` 的图层初始化中注册该层的 ID
4. 在需要显示该层的状态的 `updateLayers()` 分支中设置 `display: block`

### 修改窗口尺寸

窗口尺寸在 `main.js` 中定义（`width: 150, height: 280`），修改后需同步调整 `renderer.js` 中的缩放比例（当前约 `0.0944`，计算公式为 `窗口宽度 / 角色原图身体宽度`）。

---

## 已知平台差异

| 功能 | Windows | macOS | Linux |
|------|---------|-------|-------|
| 点击穿透 | `setIgnoreMouseEvents` + forward | 同左 | 同左（效果存疑） |
| 自动开机启动 | 写注册表 `HKCU\...Run` | `loginItems` API | 写 `~/.config/autostart/*.desktop` |
| 托盘图标 | `.ico` 文件 | `.png` 文件 | `.png` 文件 |
