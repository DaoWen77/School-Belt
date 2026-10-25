# 环带版块论坛化布局重构

日期：2026-10-25  
范围：仅前端 UI / 组件拆解；未改后端 API、数据库、权限与 WS 逻辑。

## 变更

### 环带帖子版块

- 移除快报 / 悬赏 / 日常 / 电文页面上常驻的发帖表单。
- 新增右侧发布入口：`+ 发布新信号 / NEW POST`，带微弱荧光黄光晕。
- 发布表单抽离为 `BeltPostComposer`，从右侧滑出，提交成功自动关闭并调用列表 `load()`。
- 新增极简控制栏：
  - `排序：最新 / 头条`
  - `筛选：全部 / 官方 / 开放 / 今日`（按版块语义）
- 快报第一条官方/置顶帖升级为报纸头条：大字号标题、摘要、作者与回波/认同信息。
- 列表改为紧凑台账：行距缩小、摘要两行截断，一屏可看更多。
- 悬赏条目增加档案袋式左侧信号线、放大的赏金金额与截止日期。

### 内部朋友圈

- 移除常驻 textarea 发帖框。
- 改为顶部 `+ 发布动态` 入口。
- 发帖体抽离为 `MomentsComposer`，从右侧抽屉发布；成功后关闭并刷新。
- 抽屉通过 portal 挂到 `body`，避免被 `.im-scroll` 的布局上下文限制。

### 共用

- 新增共享抽屉样式 [drawer.css](../../web/src/styles/drawer.css)。
- 右侧滑入 240ms，遮罩淡入，支持 `Esc` / 点击遮罩关闭。
- 两端抽屉均处理了 `.im-body button` 全局重置与主题 token 继承。
- 环带抽屉使用 portal + `.belt-root` 主题包装，避免 fixed 定位被容器偏移。

## 验证

```text
INLINE_TEXTAREAS 0
PUBLISH_BUTTONS 1
HEADLINE 1
COMPACT_ROWS 4
DRAWER_TEXTAREAS 1
MOMENTS_INLINE_TEXTAREAS 0
MOMENTS_PUBLISH_BUTTONS 1
MOMENTS_DRAWER 1

DRAWER_AFTER 0
POST_VISIBLE true
```

`web pnpm build`：通过，18 个路由。

## 截图

- [环带快报信息流](../../reports/frontend/phase-ui-belt-dispatch-1440.png)
- [环带发布抽屉](../../reports/frontend/phase-ui-belt-composer-1440.png)
- [朋友圈发布抽屉](../../reports/frontend/phase-ui-moments-composer-1440.png)

## 边界

- 后端目前没有新帖 WS 事件；发布后由前端 `load()` 刷新列表。若后续后端补 `post:new`，在同一处理函数里调用 `load()` 即可，无需再改布局。
- 筛选/排序目前是前端对已加载列表的即时操作，不新增后端查询参数。
- 快报签发仍受 Owner/Admin 权限限制，入口只对有权限用户显示。
