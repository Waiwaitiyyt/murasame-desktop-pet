/* 渲染进程：丛雨桌面宠物交互逻辑 */

const { ipcRenderer } = require('electron');
const path = require('path');

// ---- 图层路径配置 ----
// 从主进程获取 fgimages 目录路径
const fgPath = ipcRenderer.sendSync('get-fgimages-path');
const platform = ipcRenderer.sendSync('get-platform');

function imgSrc(filename) {
  // 转换为 file:// URL 并处理日文文件名
  const fullPath = path.join(fgPath, filename);
  return 'file:///' + fullPath.replace(/\\/g, '/').replace(/^\//, '');
}

// 图层文件映射（ID → 文件名）
const LAYER_FILES = {
  'body-normal':    'ムラサメa_1950.png',
  'body-arm':       'ムラサメa_1951.png',
  'face-base':      'ムラサメa_1292.png',
  'face-smile':     'ムラサメa_1316.png',
  'face-puzzled':   'ムラサメa_1337.png',
  'face-surprised': 'ムラサメa_1368.png',
  'face-flustered': 'ムラサメa_1399.png',
  'face-shy':       'ムラサメa_1455.png',
  'face-serious':   'ムラサメa_1548.png',
  'face-troubled':  'ムラサメa_1596.png',
  'face-angry':     'ムラサメa_1620.png',
  'face-smirk':     'ムラサメa_1644.png',
  'face-hehe':      'ムラサメa_1904.png',
  'blush':          'ムラサメa_1958.png',
  'hair-overlay':   'ムラサメa_1273.png',
};

// 初始化：设置所有图片的 src
function initLayers() {
  for (const [id, filename] of Object.entries(LAYER_FILES)) {
    const el = document.getElementById(id);
    if (el) el.src = imgSrc(filename);
  }
}

// ---- 独白台词库（基于原著角色设定） ----
// 丛雨：孤高剑士 / 傲娇 / 重责任感 / 偷偷嘴馋
const MONOLOGUE_LINES = [
  { text: 'むむ……修行が\n足りぬな',          face: 'face-serious'   },
  { text: '……何を\n見ておる',                 face: 'face-serious'   },
  { text: '今日もご御奉公を\n果たすのみじゃ',   face: 'face-base'      },
  { text: '刀の手入れを\nせねばな',            face: 'face-serious'   },
  { text: '少し休んでも…\n罰は当たるまい',    face: 'face-troubled'  },
  { text: 'ご主人…\n',                      face: 'face-smile'     },
  { text: '甘いものが…\n食べたい',             face: 'face-shy'       },
  { text: 'ふん、油断は\n大敵じゃ',            face: 'face-smirk'     },
  { text: 'もっと強く\nならねば',              face: 'face-serious'   },
  { text: 'べ、別に退屈で\nはないのじゃ',     face: 'face-flustered' },
  { text: '天霞の誇りに\nかけて……！',         face: 'face-serious'   },
  { text: '……少し、眠い',                    face: 'face-troubled'  },
  { text: '剣の道は\n孤独じゃな',              face: 'face-troubled'  },
  { text: '…見られておる\n気がするが',         face: 'face-puzzled'   },
  { text: 'そなた、また\n余を見ておろう',      face: 'face-smirk'     },
  { text: '怠けては\nなりませぬぞ',            face: 'face-serious'   },
  { text: '腹が……い、\nいや、なんでもない',   face: 'face-flustered' },
  { text: '余は天霞の\n剣士じゃ、忘れるな',   face: 'face-serious'   },
];

// ---- 状态机 ----

class PetStateMachine {
  constructor() {
    this.currentState = 'idle';
    this.locked = false;           // 动画播放中不响应新触发
    this._lockTimer = null;
    this._idleTimer = null;        // 无操作超时 → sleep
    this._randomTimer = null;      // 随机事件定时器
    this._monologueTimer = null;   // 独白定时器
    this._blinkTimer = null;       // 随机眨眼
    this._currentMonologueLine = null;

    this.wrapper = document.getElementById('pet-wrapper');
  }

  // 切换到新状态，duration(ms) > 0 时自动回到 idle
  transition(newState, duration = 0) {
    if (this.locked && duration > 0) return;

    if (this._lockTimer) clearTimeout(this._lockTimer);

    this.locked = duration > 0;
    this.currentState = newState;

    // 更新 CSS 状态类
    this.wrapper.className = 'state-' + newState;

    // 更新图层可见性
    this._updateLayers(newState);

    if (duration > 0) {
      this._lockTimer = setTimeout(() => {
        this.locked = false;
        this.transition('idle');
      }, duration);
    }

    // 非 sleep/drag 状态时重置无操作计时器
    if (newState !== 'sleep' && newState !== 'drag') {
      this._resetIdleTimer();
    }
  }

  _updateLayers(state) {
    const bodyNormal = document.getElementById('body-normal');
    const bodyArm    = document.getElementById('body-arm');

    // 隐藏所有表情层
    document.querySelectorAll('.face-layer').forEach(el => {
      el.style.display = 'none';
    });
    document.getElementById('blush').style.display = 'none';
    document.getElementById('speech-bubble').style.display = 'none';
    document.getElementById('speech-arrow').style.display = 'none';
    document.getElementById('zzz-container').style.display = 'none';
    document.getElementById('exclamation').style.display = 'none';

    // 默认：普通身体
    bodyNormal.style.display = 'block';
    bodyArm.style.display = 'none';

    switch (state) {
      case 'idle':
        document.getElementById('face-base').style.display = 'block';
        this._startBlink();
        break;

      case 'happy':
        document.getElementById('face-hehe').style.display = 'block';
        this._stopBlink();
        break;

      case 'shy':
        document.getElementById('face-shy').style.display = 'block';
        document.getElementById('blush').style.display = 'block';
        this._stopBlink();
        break;

      case 'angry':
        document.getElementById('face-angry').style.display = 'block';
        this._stopBlink();
        break;

      case 'surprised':
        document.getElementById('face-surprised').style.display = 'block';
        document.getElementById('exclamation').style.display = 'block';
        this._stopBlink();
        // 感叹号1秒后消失
        setTimeout(() => {
          const ex = document.getElementById('exclamation');
          if (ex) ex.style.display = 'none';
        }, 1000);
        break;

      case 'drag':
        bodyNormal.style.display = 'none';
        bodyArm.style.display = 'block';
        document.getElementById('face-flustered').style.display = 'block';
        this._stopBlink();
        break;

      case 'sleep':
        document.getElementById('face-troubled').style.display = 'block';
        document.getElementById('zzz-container').style.display = 'block';
        this._stopBlink();
        break;

      case 'call_master': {
        document.getElementById('face-smile').style.display = 'block';
        const bubbleCM = document.getElementById('speech-bubble');
        bubbleCM.textContent = 'ご主人～';
        bubbleCM.style.display = 'block';
        bubbleCM.style.animation = 'none';
        bubbleCM.offsetHeight;
        bubbleCM.style.animation = '';
        document.getElementById('speech-arrow').style.display = 'block';
        this._stopBlink();
        break;
      }

      case 'monologue': {
        const line = this._currentMonologueLine;
        if (line) {
          document.getElementById(line.face).style.display = 'block';
          if (line.face === 'face-shy') {
            document.getElementById('blush').style.display = 'block';
          }
          const bubbleMono = document.getElementById('speech-bubble');
          bubbleMono.textContent = line.text;
          bubbleMono.style.display = 'block';
          bubbleMono.style.animation = 'none';
          bubbleMono.offsetHeight;
          bubbleMono.style.animation = '';
          document.getElementById('speech-arrow').style.display = 'block';
        }
        this._stopBlink();
        break;
      }

      case 'sword':
        document.getElementById('face-serious').style.display = 'block';
        this._stopBlink();
        break;
    }
  }

  // 随机眨眼（仅在 idle 状态下）
  _startBlink() {
    this._stopBlink();
    const scheduleNextBlink = () => {
      const delay = 3000 + Math.random() * 4000; // 3~7 秒随机间隔
      this._blinkTimer = setTimeout(() => {
        if (this.currentState === 'idle') {
          this._doBlink();
          scheduleNextBlink();
        }
      }, delay);
    };
    scheduleNextBlink();
  }

  _stopBlink() {
    if (this._blinkTimer) {
      clearTimeout(this._blinkTimer);
      this._blinkTimer = null;
    }
  }

  _doBlink() {
    // 短暂切换到困惑表情模拟眨眼（眼睛变细）
    const faceBase = document.getElementById('face-base');
    const facePuzzled = document.getElementById('face-puzzled');
    if (!faceBase || !facePuzzled) return;
    faceBase.style.display = 'none';
    facePuzzled.style.display = 'block';
    setTimeout(() => {
      if (this.currentState === 'idle') {
        facePuzzled.style.display = 'none';
        faceBase.style.display = 'block';
      }
    }, 120);
  }

  // 无操作5分钟后进入睡眠
  _resetIdleTimer() {
    if (this._idleTimer) clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => {
      if (!this.locked) this.transition('sleep');
    }, 5 * 60 * 1000);
  }

  // 随机事件：每5~15分钟触发一次
  startRandomEvents() {
    const scheduleNext = () => {
      const delay = (5 + Math.random() * 10) * 60 * 1000;
      this._randomTimer = setTimeout(() => {
        if (!this.locked && this.currentState === 'idle') {
          const events = ['call_master', 'happy'];
          const picked = events[Math.floor(Math.random() * events.length)];
          this.transition(picked, 3000);
        }
        scheduleNext();
      }, delay);
    };
    scheduleNext();
  }

  showMonologue() {
    if (this.locked || this.currentState !== 'idle') return;
    this._currentMonologueLine =
      MONOLOGUE_LINES[Math.floor(Math.random() * MONOLOGUE_LINES.length)];
    this.transition('monologue', 3500);
  }

  // 每 2~5 分钟自言自语一次
  startMonologueTimer() {
    const schedule = () => {
      const delay = (0.2 + Math.random() * 3) * 60 * 1000;
      this._monologueTimer = setTimeout(() => {
        this.showMonologue();
        schedule();
      }, delay);
    };
    schedule();
  }

  stopRandomEvents() {
    if (this._randomTimer)   clearTimeout(this._randomTimer);
    if (this._monologueTimer) clearTimeout(this._monologueTimer);
  }
}

// ---- 拖拽逻辑 ----

let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

function initDrag(container, stateMachine) {
  container.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isDragging = true;
    // 记录鼠标在窗口内的偏移（screenX/Y - 窗口位置）
    dragOffsetX = e.screenX - window.screenX;
    dragOffsetY = e.screenY - window.screenY;
    stateMachine.transition('drag');
    if (platform === 'win32') {
      ipcRenderer.send('toggle-click-through', false);
    }
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const newX = e.screenX - dragOffsetX;
    const newY = e.screenY - dragOffsetY;
    ipcRenderer.send('move-window', { x: newX, y: newY });
  });

  document.addEventListener('mouseup', (e) => {
    if (!isDragging) return;
    isDragging = false;

    // 落地弹跳动画
    const wrapper = document.getElementById('pet-wrapper');
    wrapper.classList.add('landing');
    setTimeout(() => wrapper.classList.remove('landing'), 600);

    stateMachine.transition('idle');

    if (platform === 'win32') {
      // 只有鼠标已离开容器才重开穿透；若仍在容器上，mouseleave 会负责重开
      const rect = container.getBoundingClientRect();
      const overContainer = e.clientX >= rect.left && e.clientX <= rect.right &&
                            e.clientY >= rect.top  && e.clientY <= rect.bottom;
      if (!overContainer) {
        ipcRenderer.send('toggle-click-through', true);
      }
    }
  });
}

// ---- 点击穿透管理（Windows） ----

function initClickThrough(container) {
  if (platform !== 'win32') return;

  container.addEventListener('mouseenter', () => {
    ipcRenderer.send('toggle-click-through', false);
  });
  container.addEventListener('mouseleave', () => {
    if (!isDragging) {
      ipcRenderer.send('toggle-click-through', true);
    }
  });
}

// ---- 主入口 ----

document.addEventListener('DOMContentLoaded', () => {
  initLayers();

  const stateMachine = new PetStateMachine();
  const container = document.getElementById('sprite-container');
  const wrapper = document.getElementById('pet-wrapper');

  // 启动定时器
  stateMachine._resetIdleTimer();
  stateMachine.startRandomEvents();
  stateMachine.startMonologueTimer();
  stateMachine.transition('idle');

  // 拖拽
  initDrag(container, stateMachine);

  // 点击穿透（Windows）
  initClickThrough(container);

  // 统一处理所有点击逻辑
  let clickTimer = null;
  let quickClickCount = 0;
  let quickClickTimer = null;

  container.addEventListener('click', (e) => {
    if (isDragging) return;

    // sleep 唤醒优先
    if (stateMachine.currentState === 'sleep') {
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      stateMachine.locked = false;
      stateMachine.transition('idle');
      return;
    }

    // 彩蛋：连续快速单击5次触发 sword
    quickClickCount++;
    if (quickClickTimer) clearTimeout(quickClickTimer);
    quickClickTimer = setTimeout(() => { quickClickCount = 0; }, 1000);
    if (quickClickCount >= 5) {
      quickClickCount = 0;
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      stateMachine.transition('sword', 2000);
      return;
    }

    // 延迟判断是否双击
    if (clickTimer) return;
    clickTimer = setTimeout(() => {
      clickTimer = null;
      stateMachine.transition(Math.random() < 0.5 ? 'happy' : 'shy', 2000);
    }, 220);
  });

  // 双击：call_master
  container.addEventListener('dblclick', () => {
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    stateMachine.transition('call_master', 3000);
  });

  // 右键菜单
  container.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    ipcRenderer.send('show-context-menu');
  });

  // 主进程托盘菜单指令
  ipcRenderer.on('pet-action', (event, action) => {
    switch (action) {
      case 'sleep':
        stateMachine.transition('sleep');
        break;
      case 'idle':
        stateMachine.locked = false;
        stateMachine.transition('idle');
        break;
      case 'happy':
        stateMachine.transition('happy', 2000);
        break;
    }
  });
});

