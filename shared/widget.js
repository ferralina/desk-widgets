// 所有组件共用的初始化逻辑

// ── Pin 按钮 ──
async function initPin() {
  const btn = document.getElementById('btnPin')
  if (!btn) return
  const pinned = await window.api.getPinned()
  btn.classList.toggle('pinned', pinned)
}

async function togglePin() {
  const btn = document.getElementById('btnPin')
  const pinned = await window.api.togglePin()
  if (btn) btn.classList.toggle('pinned', pinned)
}

// ── 透明度滑块 ──
function applyAlpha(alpha) {
  document.documentElement.style.setProperty('--widget-alpha', alpha)
}

function toggleOpacitySlider() {
  const wrap = document.querySelector('.opacity-slider-wrap')
  if (!wrap) return
  const visible = wrap.classList.toggle('force-visible')
  if (visible) {
    // 点击其他地方自动收起
    setTimeout(() => {
      document.addEventListener('click', function hideSlider(e) {
        if (!wrap.contains(e.target) && !e.target.classList.contains('max')) {
          wrap.classList.remove('force-visible')
          document.removeEventListener('click', hideSlider)
        }
      })
    }, 10)
  }
}

function initOpacitySlider() {
  const slider = document.getElementById('opacitySlider')
  if (!slider) return

  // 拖动时实时更新背景透明度
  slider.addEventListener('input', () => {
    applyAlpha(slider.value)
  })

  // 松开后持久化
  slider.addEventListener('change', () => {
    window.api.setWidgetOpacity(parseFloat(slider.value))
  })
}

// 接收主进程发来的初始透明度
window.api.onInitOpacity((alpha) => {
  applyAlpha(alpha)
  const slider = document.getElementById('opacitySlider')
  if (slider) slider.value = alpha
})

// ── 边缘吸附 ──
let isSnapped = false
let leaveTimer = null

window.api.onSnapChanged((edge) => {
  isSnapped = !!edge
})

window.addEventListener('DOMContentLoaded', () => {
  initPin()
  initOpacitySlider()

  const widget = document.querySelector('.widget')
  if (!widget) return

  // 吸附折叠方案：鼠标进入/离开通知主进程展开/折叠
  // 主进程轮询是主要机制，这里作为辅助（处理主进程轮询间隙）
  widget.addEventListener('mouseenter', () => {
    if (!isSnapped) return
    clearTimeout(leaveTimer)
    leaveTimer = null
    window.api.snapMouseEnter()
  })

  widget.addEventListener('mouseleave', () => {
    if (!isSnapped) return
    clearTimeout(leaveTimer)
    leaveTimer = setTimeout(() => {
      leaveTimer = null
      window.api.snapMouseLeave()
    }, 1200)
  })

  widget.addEventListener('mousedown', () => {
    if (!isSnapped) return
    clearTimeout(leaveTimer)
    leaveTimer = null
  })
})

// 双击标题栏取消吸附
document.addEventListener('dblclick', (e) => {
  if (isSnapped && e.target.closest('.titlebar')) {
    window.api.snapRelease()
  }
})
