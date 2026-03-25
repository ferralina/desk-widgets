# desk-widgets

桌面浮层小组件 — Electron 实现的多组件桌面工具箱。

## 组件

| 组件 | 说明 |
|------|------|
| **待办** | 优先级筛选、拖拽排序、与日历联动 |
| **日历** | 月视图、添加日程、标题栏可折叠 |
| **阶段目标** | 子任务自动计算进度、进度条可拖拽 |
| **天气** | wttr.in 实时数据，深圳，10分钟自动刷新 |
| **便签** | 黄色纸张风格，600ms 防抖自动保存 |
| **桌面文件夹** | 多分类管理，拖入文件自动提取图标 |

## 全局能力

- 单实例锁（重复启动自动聚焦已有窗口）
- 无边框透明窗口，磨砂玻璃风格
- 边缘吸附 + 悬停恢复，置顶时禁用吸附
- 多屏支持
- 位置/透明度/置顶状态全部持久化
- 系统托盘菜单

## 快速开始

```bash
git clone https://github.com/ferralina/desk-widgets.git
cd desk-widgets
npm install
npm start
```

## 环境

- Node.js ≥ 18
- Electron ^41.0.3

## 项目结构

```
desk-widgets/
├── main.js              # Electron 主进程
├── preload.js           # 安全桥接层
├── package.json
├── shared/
│   ├── base.css         # 全局样式（标题栏/按钮/滑块）
│   └── widget.js        # 组件共用逻辑
├── widgets/
│   ├── todo/
│   ├── calendar/
│   ├── goals/
│   ├── weather/
│   ├── sticky/
│   └── launcher/
└── data/                # 运行时数据（不提交）
    ├── data.json
    ├── positions.json
    └── files/
```

## License

MIT
