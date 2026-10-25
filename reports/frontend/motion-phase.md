# Motion 动效验收报告（task-36）

日期：2026-10-24　｜　范围：`web/**`、`docs/18-前端.md`、`reports/frontend/`　｜　按 Lead 要求只 build，不重启 3100

> 参考：`references/motion.md`、`assets/fx.js`；复用现有 endfield token/类。`motion-*.png` 待 Lead 重启 3100 后补；未改后端、未新增依赖。

## 1. 构建

`cd web && pnpm build` → **exit 0**（`reports/frontend/build.log`）：

```text
▲ Next.js 15.5.28
- Environments: .env.local
✓ Compiled successfully
✓ Generating static pages (7/7)

Route (app)                                 Size  First Load JS
┌ ○ /                                     257 kB         367 kB
├ ○ /_not-found                            993 B         103 kB
├ ƒ /api/ai/[kind]                         122 B         102 kB
├ ○ /icon.svg                                0 B            0 B
├ ○ /login                               4.98 kB         107 kB
└ ○ /settings                            9.02 kB         119 kB
+ First Load JS shared by all             102 kB
```

## 2. 登录（login/page.tsx + motion.css）

| 动效 | 时长/曲线 | 实现 |
| --- | --- | --- |
| 三色条扫过 | 600ms ease | `.motion-tri i` + `motion-sweep`（3 条，延迟 0/40/80ms） |
| 标题 clip-path 推入 | 620ms mech | `.motion-login-title` + `motion-drive` |
| 表单 3 段 stagger | 320ms snap，120/220/320ms 延迟 | `.motion-login-form > *` + `motion-come`；总时长 < 900ms |
| 背景 hatch / 等高线 | 60s / 40s linear（低透明） | `.motion-login-bg` + `::after` |
| 真实时间 | 每分钟更新 | `now.toLocaleTimeString`，客户端时间不造假 |
| 输入 focus 描边 | 240ms mech | 底部黄线 `background-size: 0→100% 1px` |
| 登录按钮 | 280ms mech / 100ms active | 全站按钮黄擦入 + `translateY(1px)` |
| 成功过场 | 420ms mech | `ACCESS GRANTED / 链路已建立` 黄条，随后 `router.replace('/')`；失败不播放 |
| 登录→主界面 wipe | 360ms mech | sessionStorage `dj-login-wipe`，`LoginWipe` 全屏斜切快门 |

## 3. 界面切换

- 聊天/朋友圈/档案室：`main key={view}` + `.motion-view` 180ms 淡入上移 2px；无布局位移。
- Settings 页面：`.motion-settings-in` 240ms 两段（页面 + 内容）入场；5 Tab 按钮 `.motion-tab` 180ms 顶部细线扫过（active）。
- 侧栏频道/私聊/群聊：`.motion-channel-row` hover 左黄条（scaleY）+ 右移 2px；当前项保留黄条。
- 通知/详情/搜索弹层沿用现有 Modal/Drawer；未额外重写。

## 4. 悬停/按压（全站）

- 按钮：`button:not(:disabled)` 黄色从左擦入（background-size 280ms mech）；active 下沉 1px；disabled 不响应。
- 频道行：左黄条 + 右移 2px。
- 消息行：hover 左侧 2px 墨线 + 2% 背景；图片 hover scale(1.015) 160ms；不裁切文字。
- 卡片：`.motion-card` hover 上移 1px + 右上 hatch 显影，不做阴影。
- Header 图标：hover 1px 细线框（outline）。

## 5. 动态元素

- ChatHeader：真实 HH:MM（每分钟）；标题扫描线 6s；在线点呼吸 2s。
- HUD 雷达：`.motion-radar-ticks` 8s 慢旋转刻度，低透明，`mask` 只保留外环。
- 未读角标：`.motion-badge` 240ms scale 1→1.08→1 一次。
- 新消息：`.motion-message-in` 160ms 从下 4px 淡入。
- 公告 banner：`.motion-banner-in` 240ms 从上方 8px 推入。
- 页面背景：仅 login 的 `.motion-login-bg`；IM 主界面未加背景层，避免盖内容。

## 6. 可访问性 / 降级

- 所有新增 animation/transition 均在 `@media (prefers-reduced-motion: no-preference)` 内。
- `prefers-reduced-motion: reduce`：关闭登录/页面/消息/公告/Tab/呼吸/扫描线/雷达刻度/wipe；直接最终态；隐藏 granted/wipe 遮罩。
- 只动 transform/opacity/clip-path/background-size/background-position；未用 will-change；未引入依赖。

## 7. 新增/修改

- 新 `web/src/styles/motion.css`（layout.tsx import）
- 新 `web/src/components/im/LoginWipe.tsx`
- login/page.tsx、ChatHeader.tsx、WorkspaceView.tsx、MessageItem.tsx、Sidebar.tsx、ActivityRadar.tsx、AnnouncementBanner.tsx、RichCard.tsx、settings/page.tsx

## 8. 未验证 / 待补

1. 未重启 3100，`motion-login-*.png`、`motion-chat-*.png`、`motion-settings-*.png` 未生成。
2. Playwright 动效中帧、Console 0 未抓取。
3. reduced-motion 真机/浏览器媒体模拟未跑（CSS 已按规范包裹）。
4. 登录成功过场后的主界面 wipe 跨路由实际观感未验。
5. 全站按钮黄擦入对已有黑底按钮的对比度/文字颜色需在联调时确认。
6. 未跑全量回归；未改后端。

## 实机验证（Lead 重启 3100 后）

| 项 | 结果 |
| --- | --- |
| 登录入场动画 | document.getAnimations() 检测到 hatch / contour / sweep / drive / come，均在运行或完成 |
| 登录成功过场 | .motion-granted 文案 ACCESS GRANTED / 链路已建立，黄色全屏，420ms 后 replace('/') |
| 登录→主界面 wipe | 实测 480ms 时 .motion-wipe 已挂载，url=http://localhost:3100/ |
| 登录按钮 hover | 输入有效后 hover：背景变黄色渐变、文字墨色；disabled 时不响应（预期） |
| 主界面动态 | Header 显示真实 HH:MM 与在线状态；消息 hover 出现 👍🔥✅👀/置顶/回复/引用 |
| 设置页 | 5 Tab 存在，进入动画；/settings 可滚动 |
| Reduced motion | emulateMedia({reducedMotion:'reduce'}) 下 document.getAnimations().length=0，页面可正常登录 |
| Console | 无新增动画错误；仍有既有 React #418 hydration 警告（非本次新增） |

### 截图

motion-login-final-1440.png、motion-login-enter-1440.png、motion-login-granted-mid-1440.png、motion-wipe-1440.png、motion-button-hover-1440.png、motion-main-1440.png、motion-channel-hover-1440.png、motion-message-hover-1440.png、motion-settings-enter-1440.png、motion-settings-tab-1440.png、motion-reduced-1440.png。

### 未验证

- 全站每个按钮/卡片 hover 的逐项截图（仅抽验登录按钮、频道行、消息行）。
- 动效帧率/长列表滚动性能；移动端 390 下动画观感。
- React #418 仍存在，需单独修 hydration。
