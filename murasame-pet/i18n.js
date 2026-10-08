// 托盘 / 右键菜单的多语言文案
const messages = {
  zh: {
    appName:     '丛雨桌宠',
    sleep:       '让丛雨休息',
    hide:        '隐藏丛雨',
    summon:      '召唤丛雨',
    costume:     '外观',
    sword:       '刀服',
    uniform:     '制服',
    dress:       '私服',
    settings:    '设置',
    autostart:   '开机自启',
    alwaysOnTop: '置顶显示',
    language:    '语言 / Language',
    quit:        '退出',
  },
  en: {
    appName:     'Murasame Pet',
    sleep:       'Let Murasame Rest',
    hide:        'Hide Murasame',
    summon:      'Summon Murasame',
    costume:     'Outfit',
    sword:       'Shrine Outfit',
    uniform:     'School Uniform',
    dress:       'Casual Wear',
    settings:    'Settings',
    autostart:   'Launch at Startup',
    alwaysOnTop: 'Always on Top',
    language:    'Language',
    quit:        'Quit',
  },
  ja: {
    appName:     'ムラサメ デスクトップペット',
    sleep:       'ムラサメを休ませる',
    hide:        'ムラサメを隠す',
    summon:      'ムラサメを呼ぶ',
    costume:     '衣装',
    sword:       '巫女服',
    uniform:     '制服',
    dress:       '私服',
    settings:    '設定',
    autostart:   'ログイン時に起動',
    alwaysOnTop: '常に最前面に表示',
    language:    '言語 / Language',
    quit:        '終了',
  },
};

// 语言选择项始终用各自语言显示
const languageNames = { zh: '简体中文', en: 'English', ja: '日本語' };

// 将系统 locale（如 zh-CN、en-US、ja）映射到支持的语言，默认中文
function detectLanguage(locale) {
  const lang = (locale || '').toLowerCase().split(/[-_]/)[0];
  return messages[lang] ? lang : 'zh';
}

function translator(lang) {
  const dict = messages[lang] || messages.zh;
  return (key) => dict[key] ?? messages.zh[key] ?? key;
}

module.exports = { messages, languageNames, detectLanguage, translator };
