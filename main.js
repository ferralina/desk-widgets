const { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const { exec } = require('child_process')

const DATA_DIR = path.join(require('os').homedir(), '.desk-widgets')
const DATA_FILE = path.join(DATA_DIR, 'data.json')
const POSITIONS_FILE = path.join(DATA_DIR, 'positions.json')
const FILES_DIR = path.join(DATA_DIR, 'files')  // 存放复制过来的文件

if (!fs.existsSync(DATA_DIR))  fs.mkdirSync(DATA_DIR,  { recursive: true })
if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true })

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) { app.quit() }

function todayKey() {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`
}

const DEFAULT_DATA = {
  todos: [
    { id: '1', text: 'Q1 季度报告',       done: false, priority: 'high',   dateKey: todayKey() },
    { id: '2', text: 'Review PR #117',    done: false, priority: 'normal', dateKey: todayKey() },
    { id: '3', text: '同步代码到 GitHub', done: true,  priority: 'normal', dateKey: todayKey() },
  ],
  schedules: {},
  sticky: '周一 14:00 会议\n买猫粮\n回复小明邮件\n学习 Cursor AI',
  goals: [
    { id: '1', text: '副业月入1万', progress: 60 },
    { id: '2', text: '发布至少一个产品', progress: 35 },
    { id: '3', text: '发布第一个产品', progress: 80 },
  ],
  folders: [
    { id: 'work',  name: '工作',  open: true,  items: [] },
    { id: 'tools', name: '工具',  open: true,  items: [] },
    { id: 'fun',   name: '娱乐',  open: false, items: [] },
  ],
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2))
      return JSON.parse(JSON.stringify(DEFAULT_DATA))
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'))
  } catch (e) { return JSON.parse(JSON.stringify(DEFAULT_DATA)) }
}

function saveData(data) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); return true }
  catch (e) { return false }
}

function loadPositions() {
  try {
    if (fs.existsSync(POSITIONS_FILE)) return JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf-8'))
  } catch {}
  return {}
}

function savePositions(p) {
  try { fs.writeFileSync(POSITIONS_FILE, JSON.stringify(p, null, 2)) } catch {}
}

const WIDGET_DEFAULTS = {
  launcher: { x: 30,   y: 30,   width: 240, height: 320 },
  todo:     { x: null, y: 30,   width: 270, height: 300 },
  calendar: { x: null, y: 340,  width: 270, height: 300 },
  sticky:   { x: 20,   y: null, width: 190, height: 175 },
  goals:    { x: null, y: null, width: 250, height: 210 },
  weather:  { x: null, y: null, width: 170, height: 165 },
}

const SNAP_THRESHOLD = 30   // 距边缘多少 px 内触发吸附
const SNAP_TITLEBAR  = 36   // 吸附后折叠到的高度（标题栏高度）

const expandedHeights = {}
const snapState  = {}  // { [id]: edge | null }
const snapTimers = {}
const windows    = {}
const isSnapping = {}  // 防止 snapToEdge 的 setPosition 触发 moved 事件

function getWA() { return screen.getPrimaryDisplay().workArea }

// 根据窗口当前位置获取所在屏幕的 workArea（支持多屏）
function getWAForWin(win) {
  const [wx, wy] = win.getPosition()
  const [ww, wh] = win.getSize()
  const cx = wx + ww / 2, cy = wy + wh / 2
  const displays = screen.getAllDisplays()
  const found = displays.find(d => {
    const b = d.bounds
    return cx >= b.x && cx < b.x + b.width && cy >= b.y && cy < b.y + b.height
  })
  return (found || screen.getPrimaryDisplay()).workArea
}

// 把窗口贴到对应边缘，并折叠到标题栏高度
function snapToEdge(id, win, edge) {
  const [ww, wh] = win.getSize()
  const wa = getWAForWin(win)
  let x, y
  const [cx, cy] = win.getPosition()
  if (edge === 'left')   { x = wa.x;                  y = cy }
  if (edge === 'right')  { x = wa.x + wa.width - ww;  y = cy }
  if (edge === 'top')    { x = cx;                     y = wa.y }
  if (edge === 'bottom') { x = cx;                     y = wa.y + wa.height - SNAP_TITLEBAR }

  // 记录展开高度
  expandedHeights[id] = wh

  isSnapping[id] = true
  win.setPosition(Math.round(x), Math.round(y), false)
  // 折叠到标题栏高度，保持完全不透明（避免透明度穿透问题）
  win.setSize(ww, SNAP_TITLEBAR, true)
  win.setOpacity(1)
  win.setIgnoreMouseEvents(false)
  setTimeout(() => { isSnapping[id] = false }, 200)
  snapState[id] = edge

  const p = loadPositions()
  p[id] = { ...p[id], x: Math.round(x), y: Math.round(y), snapped: edge }
  savePositions(p)

  win.webContents.send('snap-changed', edge)
}

function unsnapWindow(id, win) {
  if (!snapState[id]) return
  snapState[id] = null
  // 恢复展开高度
  const [ww] = win.getSize()
  const h = expandedHeights[id] || WIDGET_DEFAULTS[id]?.height || 260
  win.setSize(ww, h, true)
  win.setOpacity(1)
  win.webContents.send('snap-changed', null)
  const p = loadPositions()
  if (p[id]) delete p[id].snapped
  savePositions(p)
}

function checkSnap(id, win) {
  if (win.isAlwaysOnTop() || snapState[id]) return
  const [wx, wy] = win.getPosition()
  const [ww, wh] = win.getSize()
  const wa = getWAForWin(win)

  let edge = null
  if (wx <= wa.x + SNAP_THRESHOLD)                       edge = 'left'
  else if (wx + ww >= wa.x + wa.width - SNAP_THRESHOLD)  edge = 'right'
  else if (wy <= wa.y + SNAP_THRESHOLD)                   edge = 'top'
  else if (wy + wh >= wa.y + wa.height - SNAP_THRESHOLD) edge = 'bottom'

  if (edge) snapToEdge(id, win, edge)
}

function createWidget(id, htmlFile) {
  const positions = loadPositions()
  const defaults  = WIDGET_DEFAULTS[id]
  const wa = getWA()
  const ww = positions[id]?.width  ?? defaults.width
  const wh = positions[id]?.height ?? defaults.height

  let x = positions[id]?.x ?? (defaults.x !== null ? defaults.x : wa.width  - ww - 20)
  let y = positions[id]?.y ?? (defaults.y !== null ? defaults.y : wa.height - wh - 20)

  // 修正越界坐标：允许副屏坐标，只在完全不在任何屏幕上时才回退到主屏
  const allDisplays = screen.getAllDisplays()
  const onAnyScreen = allDisplays.some(d =>
    x < d.bounds.x + d.bounds.width  && x + ww > d.bounds.x &&
    y < d.bounds.y + d.bounds.height && y + wh > d.bounds.y
  )
  if (!onAnyScreen) {
    x = Math.max(wa.x, Math.min(x, wa.x + wa.width  - ww))
    y = Math.max(wa.y, Math.min(y, wa.y + wa.height - wh))
  }

  const pinned = positions[id]?.pinned ?? false

  const win = new BrowserWindow({
    x, y,
    width:  ww,
    height: wh,
    transparent: true,
    frame: false,
    alwaysOnTop: pinned,
    resizable: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    }
  })

  win.loadFile(htmlFile)
  win.setVisibleOnAllWorkspaces(true)
  expandedHeights[id] = positions[id]?.height ?? defaults.height

  // 页面加载完成后，发送初始化数据
  win.webContents.once('did-finish-load', () => {
    // 恢复透明度
    const savedAlpha = positions[id]?.alpha ?? 0.72
    win.webContents.send('init-opacity', savedAlpha)
    // 恢复吸附状态
    if (snapState[id]) {
      win.webContents.send('snap-changed', snapState[id])
    }
  })

  // 恢复上次吸附状态：折叠到标题栏高度
  if (positions[id]?.snapped) {
    snapState[id] = positions[id].snapped
    win.setSize(ww, SNAP_TITLEBAR)
    win.setOpacity(1)
  }

  win.on('moved', () => {
    // 程序调用 setPosition（如 snapToEdge）触发的 moved，直接忽略
    if (isSnapping[id]) return
    // 拖动时先取消吸附（恢复透明度）
    if (snapState[id]) {
      unsnapWindow(id, win)
      return
    }
    // 停止拖动 350ms 后检测是否靠近边缘
    clearTimeout(snapTimers[id])
    snapTimers[id] = setTimeout(() => checkSnap(id, win), 350)

    let [wx, wy] = win.getPosition()
    const [ww, wh] = win.getSize()
    const wa = getWAForWin(win)

    // 防止窗口被拖到当前屏幕 workArea 之外（任务栏下方等）
    let clamped = false
    if (wx < wa.x)                        { wx = wa.x;                        clamped = true }
    if (wy < wa.y)                        { wy = wa.y;                        clamped = true }
    if (wx + ww > wa.x + wa.width)        { wx = wa.x + wa.width  - ww;       clamped = true }
    if (wy + wh > wa.y + wa.height)       { wy = wa.y + wa.height - wh;       clamped = true }
    if (clamped) win.setPosition(Math.round(wx), Math.round(wy), false)

    const p = loadPositions()
    p[id] = { ...p[id], x: Math.round(wx), y: Math.round(wy), width: ww, height: wh }
    savePositions(p)
  })

  win.on('resized', () => {
    const [ww, wh] = win.getSize()
    if (wh > 40) expandedHeights[id] = wh
    const [wx, wy] = win.getPosition()
    const p = loadPositions()
    p[id] = { ...p[id], x: wx, y: wy, width: ww, height: wh }
    savePositions(p)
  })

  // 折叠方案下 focus/blur 不再控制透明度，由轮询统一管理折叠状态

  win.webContents.on('will-navigate', (e) => e.preventDefault())
  windows[id] = win
  return win
}

app.whenReady().then(() => {
  ipcMain.handle('get-data',  () => loadData())
  ipcMain.handle('save-data', (_, data) => saveData(data))

  ipcMain.handle('get-opacity', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return 0.72
    const id = Object.keys(windows).find(k => windows[k] === win)
    const p = loadPositions()
    return p[id]?.alpha ?? 0.72
  })

  ipcMain.handle('set-opacity', (event, alpha) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const id = Object.keys(windows).find(k => windows[k] === win)
    if (!id) return
    const p = loadPositions()
    p[id] = { ...p[id], alpha }
    savePositions(p)
  })

  ipcMain.handle('get-pinned', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win ? win.isAlwaysOnTop() : false
  })

  ipcMain.handle('toggle-pin', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    const next = !win.isAlwaysOnTop()
    win.setAlwaysOnTop(next)
    const id = Object.keys(windows).find(k => windows[k] === win)
    if (id) {
      if (next && snapState[id]) unsnapWindow(id, win)
      const p = loadPositions()
      p[id] = { ...p[id], pinned: next }
      savePositions(p)
    }
    return next
  })

  ipcMain.handle('collapse-window', (event, titlebarH) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return 'expanded'
    const id = Object.keys(windows).find(k => windows[k] === win)
    const [ww, wh] = win.getSize()
    if (wh > titlebarH + 10) {
      expandedHeights[id] = wh
      win.setSize(ww, Math.round(titlebarH), true)
      return 'collapsed'
    } else {
      win.setSize(ww, expandedHeights[id] || WIDGET_DEFAULTS[id]?.height || 260, true)
      return 'expanded'
    }
  })

  // 渲染层 IPC（保留接口兼容性，折叠方案下不再用透明度）
  ipcMain.on('snap-mouse-enter', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const id = Object.keys(windows).find(k => windows[k] === win)
    if (snapState[id]) snapExpand(id, win)
  })

  ipcMain.on('snap-mouse-leave', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const id = Object.keys(windows).find(k => windows[k] === win)
    if (snapState[id]) scheduleCollapse(id, win)
  })

  // 主进程轮询：检测鼠标是否在吸附窗口上，控制折叠/展开
  const snapHoverState = {}
  const collapseTimers = {}

  function snapExpand(id, win) {
    clearTimeout(collapseTimers[id])
    collapseTimers[id] = null
    if (snapHoverState[id]) return  // 已展开
    snapHoverState[id] = true
    const [ww] = win.getSize()
    const h = expandedHeights[id] || WIDGET_DEFAULTS[id]?.height || 260
    isSnapping[id] = true
    win.setSize(ww, h, true)
    setTimeout(() => { isSnapping[id] = false }, 200)
  }

  function scheduleCollapse(id, win) {
    if (collapseTimers[id]) return
    collapseTimers[id] = setTimeout(() => {
      collapseTimers[id] = null
      if (!snapState[id] || snapHoverState[id]) return
      const [ww] = win.getSize()
      isSnapping[id] = true
      win.setSize(ww, SNAP_TITLEBAR, true)
      setTimeout(() => { isSnapping[id] = false }, 200)
    }, 1200)
  }

  setInterval(() => {
    const cursor = screen.getCursorScreenPoint()
    Object.keys(windows).forEach(id => {
      if (!snapState[id]) return
      const win = windows[id]
      const [wx, wy] = win.getPosition()
      const [ww, wh] = win.getSize()
      const inside = cursor.x >= wx && cursor.x < wx + ww && cursor.y >= wy && cursor.y < wy + wh
      if (inside) {
        snapExpand(id, win)
      } else {
        if (snapHoverState[id]) {
          snapHoverState[id] = false
          scheduleCollapse(id, win)
        }
      }
    })
  }, 80)

  ipcMain.on('snap-release', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const id = Object.keys(windows).find(k => windows[k] === win)
    unsnapWindow(id, win)
  })

  ipcMain.on('window-close',    (event) => { BrowserWindow.fromWebContents(event.sender)?.hide() })
  ipcMain.on('window-minimize', (event) => { BrowserWindow.fromWebContents(event.sender)?.minimize() })
  // 递归复制目录
  function copyDirSync(src, dest) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, entry.name)
      const d = path.join(dest, entry.name)
      if (entry.isDirectory()) copyDirSync(s, d)
      else fs.copyFileSync(s, d)
    }
  }

  // 拖入文件/文件夹：复制到本地 files/ 目录，返回本地路径 + 图标
  ipcMain.handle('copy-file-in', async (_, srcPath) => {
    try {
      const resolved = resolveFilePath(srcPath)
      if (!resolved || !fs.existsSync(resolved)) {
        return { error: '文件不存在: ' + srcPath }
      }

      const isDir  = fs.statSync(resolved).isDirectory()
      const name   = path.basename(resolved)
      let destPath = path.join(FILES_DIR, name)

      // 同名时加时间戳
      if (fs.existsSync(destPath)) {
        const ext  = isDir ? '' : path.extname(name)
        const base = isDir ? name : path.basename(name, ext)
        destPath = path.join(FILES_DIR, `${base}_${Date.now()}${ext}`)
      }

      if (isDir) {
        copyDirSync(resolved, destPath)
      } else {
        fs.copyFileSync(resolved, destPath)
      }

      // 获取图标
      let iconTarget = isDir ? destPath : destPath
      if (!isDir && destPath.toLowerCase().endsWith('.lnk')) {
        try {
          const info = shell.readShortcutLink(resolved)
          if (info && info.target) iconTarget = info.target
        } catch {}
      }

      let dataUrl = null
      try {
        const icon = await app.getFileIcon(iconTarget, { size: 'large' })
        dataUrl = icon.toDataURL()
      } catch {}

      return { localPath: destPath, dataUrl }
    } catch (e) {
      console.error('[copy-file-in]', e.message)
      return { error: e.message }
    }
  })

  // 解析文件路径：如果是相对路径/只有文件名，在常见目录里搜索完整路径
  function resolveFilePath(p) {
    if (!p) return null
    // 已经是完整路径
    if (/^[A-Za-z]:\\/.test(p)) return p
    // 搜索目录：桌面、公共桌面
    const searchDirs = [
      path.join(require('os').homedir(), 'Desktop'),
      'C:\\Users\\Public\\Desktop',
    ]
    for (const dir of searchDirs) {
      const full = path.join(dir, p)
      if (fs.existsSync(full)) return full
    }
    return p  // 找不到就原样返回
  }

  // 只获取图标（不复制文件），用于已有本地路径的条目刷新图标
  ipcMain.handle('get-file-icon', async (_, filePath) => {
    try {
      let targetPath = filePath
      if (filePath && filePath.toLowerCase().endsWith('.lnk')) {
        try {
          const info = shell.readShortcutLink(filePath)
          if (info && info.target) targetPath = info.target
        } catch {}
      }
      const icon = await app.getFileIcon(targetPath, { size: 'large' })
      return icon.toDataURL()
    } catch (e) {
      return null
    }
  })

  ipcMain.on('open-app', (_, p) => {
    if (!p) return
    const resolved = resolveFilePath(p)
    console.log('[open-app]', p, '->', resolved)
    shell.openPath(resolved).then(err => {
      if (err) {
        console.warn('[open-app] openPath failed, fallback to exec:', err)
        exec(`start "" "${resolved}"`, { shell: true })
      }
    })
  })
  ipcMain.on('open-url',        (_, u)  => { shell.openExternal(u) })

  createWidget('launcher', path.join(__dirname, 'widgets/launcher/index.html'))
  createWidget('todo',     path.join(__dirname, 'widgets/todo/index.html'))
  createWidget('calendar', path.join(__dirname, 'widgets/calendar/index.html'))
  createWidget('sticky',   path.join(__dirname, 'widgets/sticky/index.html'))
  createWidget('goals',    path.join(__dirname, 'widgets/goals/index.html'))
  createWidget('weather',  path.join(__dirname, 'widgets/weather/index.html'))

  // ── 系统托盘 ──
  let allVisible = true
  const trayIcon = nativeImage.createFromPath(path.join(__dirname, 'assets/tray.png'))
  const tray = new Tray(trayIcon)
  tray.setToolTip('桌面组件')

  function buildTrayMenu() {
    return Menu.buildFromTemplate([
      {
        label: allVisible ? '隐藏所有组件' : '显示所有组件',
        click: () => {
          allVisible = !allVisible
          Object.values(windows).forEach(win => {
            if (allVisible) win.show()
            else win.hide()
          })
          tray.setContextMenu(buildTrayMenu())
        }
      },
      { type: 'separator' },
      {
        label: '今日待办',
        click: () => { windows.todo?.show(); windows.todo?.focus() }
      },
      {
        label: '日历',
        click: () => { windows.calendar?.show(); windows.calendar?.focus() }
      },
      {
        label: '阶段目标',
        click: () => { windows.goals?.show(); windows.goals?.focus() }
      },
      {
        label: '便签',
        click: () => { windows.sticky?.show(); windows.sticky?.focus() }
      },
      {
        label: '天气',
        click: () => { windows.weather?.show(); windows.weather?.focus() }
      },
      {
        label: '桌面文件夹',
        click: () => { windows.launcher?.show(); windows.launcher?.focus() }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => app.quit()
      }
    ])
  }

  tray.setContextMenu(buildTrayMenu())
  // 左键单击也弹出菜单
  tray.on('click', () => tray.popUpContextMenu())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
