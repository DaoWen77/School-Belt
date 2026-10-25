/* ==========================================================================
   O.M.V 帝江号 · 全域广播 — 乙套 UI「航测档案 / Chart & Log」
   demo.js · 共用演示数据 + 交互（无依赖、无网络请求）
   --------------------------------------------------------------------------
   数据基线：2026-10-22（与契约 §12 / 甲套演示数据一致）
   交互：主题切换、档案抽屉、印章状态、票据核验、台账筛选、信号发送、
         素材索引、灵感看板、作品切换、邀请开具/撤销、设置保存。
   ========================================================================== */
(function () {
  'use strict';

  /* 0. 主题要在首帧前落地（本文件在 <head> 中同步加载） ------------------- */
  var THEME_KEY = 'dijiang2-theme';
  var THEME_LABEL = { light: '纸本 · 浅色', dark: '夜航 · 深色', system: '跟随系统' };
  var THEME_ORDER = ['light', 'dark', 'system'];

  function readTheme() {
    try {
      var t = window.localStorage.getItem(THEME_KEY);
      return THEME_ORDER.indexOf(t) > -1 ? t : 'system';
    } catch (e) {
      return 'system';
    }
  }
  document.documentElement.setAttribute('data-theme', readTheme());

  /* 1. 共用演示数据 ------------------------------------------------------- */
  var DATA = {
    baseline: '2026-10-22',
    me: { id: 'cenye', name: '岑野', handle: 'cenye', role: '建立者', channelRole: '协议官' },
    members: [
      { name: '岑野', handle: 'cenye', role: '建立者', out: '建', online: true },
      { name: '陆见深', handle: 'lujianshen', role: '协议官', out: '陆', online: true },
      { name: '白棠', handle: 'baitang', role: '档案员', out: '棠', online: true },
      { name: '祁雾', handle: 'qiwu', role: '成员', out: '雾', online: true },
      { name: '沈迟', handle: 'shenchi', role: '成员', out: '迟', online: false },
      { name: '洛因', handle: 'luoyin', role: '成员', out: '因', online: true },
      { name: '唐隼', handle: 'tangsun', role: '成员', out: '隼', online: false },
      { name: '闻溪', handle: 'wenxi', role: '成员', out: '溪', online: true }
    ],
    channels: [
      { slug: 'general', name: '全域播报', visibility: 'public', members: 8, unread: 3, topic: '全域调度与例行播报' },
      { slug: 'archive', name: '素材工坊', visibility: 'public', members: 8, unread: 0, topic: '素材归档与版本' },
      { slug: 'protocol', name: '第三协议', visibility: 'private', members: 2, unread: 1, topic: '协议层 · 仅成员可读' }
    ],
    materials: [
      { id: 'm1', name: '《终末地工业·第三协议》封面.png', kind: 'image', ext: 'PNG', size: '4.8 MB', owner: '白棠', date: '10.21', dims: '4096 × 2160', tag: '协议', code: 'IMG-1021', status: '已就绪' },
      { id: 'm2', name: '帝江号外景_0412.jpg', kind: 'image', ext: 'JPG', size: '9.2 MB', owner: '沈迟', date: '10.20', dims: '6000 × 4000', tag: '外景', code: 'IMG-1020', status: '已就绪' },
      { id: 'm3', name: '信号塔草图_v3.pdf', kind: 'document', ext: 'PDF', size: '1.6 MB', owner: '祁雾', date: '10.19', dims: '24 页', tag: '草图', code: 'DOC-1019', status: '已就绪' },
      { id: 'm4', name: 'Saira 字体样张.zip', kind: 'archive', ext: 'ZIP', size: '22.4 MB', owner: '洛因', date: '10.18', dims: '12 个字重', tag: '字体', code: 'PKG-1018', status: '已就绪' },
      { id: 'm5', name: '雾海采样_07.wav', kind: 'audio', ext: 'WAV', size: '8.1 MB', owner: '闻溪', date: '10.17', dims: '48 kHz / 24 bit', tag: '采样', code: 'AUD-1017', status: '已就绪' }
    ],
    vote: {
      serial: 'CW-1025-07',
      title: '本轮主题：雾海 / 锈带 / 静默轨道',
      multi: true,
      closes: '10.25',
      voters: 6,
      totalMembers: 8,
      options: [
        { label: '雾海', votes: 4 },
        { label: '锈带', votes: 3 },
        { label: '静默轨道', votes: 2 }
      ]
    },
    tasks: [
      { id: 't1', title: '素材归档至素材工坊', status: 'doing', owner: '白棠', due: '10.24', dueISO: '2026-10-24', rel: '3 份素材', note: '第三协议封面终稿 + 草图 v3 + 外景 0412' },
      { id: 't2', title: '第三协议封面重绘', status: 'todo', owner: '祁雾', due: '10.27', dueISO: '2026-10-27', rel: '封面.png', note: '按协议官批注重绘主视觉' },
      { id: 't3', title: '外景调色交付', status: 'done', owner: '沈迟', due: '10.20', dueISO: '2026-10-20', rel: '外景_0412.jpg', note: '已归档至素材工坊' }
    ],
    artworks: {
      title: '《雾海信号塔》组图',
      author: '祁雾',
      count: 3,
      likes: 12,
      serial: 'AW-0412',
      archived: '10.21'
    },
    invites: [
      { prefix: 'DJ9K', role: '成员', note: '第三协议 · 观察员', expires: '10.29', uses: '1 / 1', status: 'pending' },
      { prefix: 'DJ4M', role: '协议官', note: '外景组 · 补位', expires: '10.26', uses: '1 / 1', status: 'used' },
      { prefix: 'DJ7Q', role: '成员', note: '雾海采样协作', expires: '10.20', uses: '0 / 1', status: 'expired' }
    ]
  };
  window.DIJIANG_DEMO = DATA;

  /* 2. 小工具 ------------------------------------------------------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function setText(sel, value, root) {
    $$(sel, root).forEach(function (el) { el.textContent = value; });
  }
  function on(el, type, fn, opts) { if (el) { el.addEventListener(type, fn, opts); } }
  function labelOfTheme(t) { return THEME_LABEL[t] || THEME_LABEL.system; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function clockHM() {
    var d = new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function prefersReduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var toastTimer = null;
  function toast(message, label) {
    var el = $('[data-toast]');
    if (!el) { return; }
    el.innerHTML =
      '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 9.5 17 19 7"/></svg>' +
      '<span><span class="toast-label">' + escapeHTML(label || '调度记录') + '</span>' +
      escapeHTML(message) + '</span>';
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-visible'); }, 3800);
  }

  function announce(el, text) {
    var live = $('[data-live]');
    if (live) { live.textContent = text; }
  }

  function copyText(text, label) {
    var done = function () { toast(label || '已复制到剪贴板', '抄录完成'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallback(); });
    } else {
      fallback();
    }
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done();
      } catch (e) {
        toast('当前环境不允许写入剪贴板 · 请手动抄录', '抄录失败');
      }
    }
  }

  /* 3. 主题 --------------------------------------------------------------- */
  function syncThemeUI() {
    var t = document.documentElement.getAttribute('data-theme') || 'system';
    $$('[data-set-theme]').forEach(function (radio) {
      radio.checked = radio.value === t;
    });
    $$('[data-theme-toggle]').forEach(function (btn) {
      btn.setAttribute('aria-label', '当前主题：' + labelOfTheme(t) + '，点击切换');
      btn.setAttribute('title', '主题：' + labelOfTheme(t));
    });
    $$('[data-current-theme]').forEach(function (el) {
      el.textContent = labelOfTheme(t);
    });
  }

  function setTheme(theme, announceChange) {
    var t = THEME_ORDER.indexOf(theme) > -1 ? theme : 'system';
    document.documentElement.setAttribute('data-theme', t);
    try { window.localStorage.setItem(THEME_KEY, t); } catch (e) { /* file:// 下忽略 */ }
    syncThemeUI();
    if (announceChange) {
      toast('外观已切换：' + labelOfTheme(t), '外观设置');
    }
  }

  function cycleTheme() {
    var cur = document.documentElement.getAttribute('data-theme') || 'system';
    var next = THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length];
    setTheme(next, true);
  }

  /* 4. 抽屉 --------------------------------------------------------------- */
  var mqDrawer = window.matchMedia ? window.matchMedia('(max-width: 1160px)') : { matches: false };
  var appEl = null;
  var lastDrawerTrigger = null;

  function drawerIsOpen() {
    if (!appEl) { return false; }
    return mqDrawer.matches
      ? appEl.classList.contains('is-drawer-open')
      : !appEl.classList.contains('is-drawer-closed');
  }

  function syncDrawer(open) {
    if (!appEl) { return; }
    $$('[data-drawer-toggle]').forEach(function (b) {
      b.setAttribute('aria-expanded', String(open));
    });
    var aside = $('#drawer');
    if (aside) {
      aside.setAttribute('aria-hidden', mqDrawer.matches && !open ? 'true' : 'false');
    }
  }

  function openDrawer(trigger) {
    if (!appEl) { return; }
    lastDrawerTrigger = trigger || null;
    if (mqDrawer.matches) {
      appEl.classList.add('is-drawer-open');
      syncDrawer(true);
      var closeBtn = $('[data-drawer-close]', $('#drawer'));
      if (closeBtn) { closeBtn.focus(); }
    } else {
      appEl.classList.remove('is-drawer-closed');
      syncDrawer(true);
    }
  }

  function closeDrawer(silent) {
    if (!appEl) { return; }
    if (mqDrawer.matches) {
      appEl.classList.remove('is-drawer-open');
      syncDrawer(false);
      if (!silent && lastDrawerTrigger && lastDrawerTrigger.focus) { lastDrawerTrigger.focus(); }
    } else {
      appEl.classList.add('is-drawer-closed');
      syncDrawer(false);
    }
  }

  function toggleDrawer(trigger) {
    if (drawerIsOpen()) { closeDrawer(); } else { openDrawer(trigger); }
  }

  /* 5. 页面初始化 --------------------------------------------------------- */
  function init() {
    appEl = $('.app');
    syncThemeUI();

    /* 5.1 主题按钮 / 设置里的主题单选 */
    $$('[data-theme-toggle]').forEach(function (btn) {
      on(btn, 'click', function () { cycleTheme(); });
    });
    $$('[data-set-theme]').forEach(function (radio) {
      on(radio, 'change', function () { setTheme(radio.value, true); });
    });

    /* 5.2 抽屉 */
    $$('[data-drawer-toggle]').forEach(function (btn) {
      on(btn, 'click', function () { toggleDrawer(btn); });
    });
    $$('[data-drawer-close]').forEach(function (btn) {
      on(btn, 'click', function () { closeDrawer(); });
    });
    syncDrawer(drawerIsOpen());
    on(document, 'keydown', function (e) {
      if (e.key !== 'Escape') { return; }
      if (mqDrawer.matches && appEl && appEl.classList.contains('is-drawer-open')) {
        closeDrawer();
      }
    });
    on(document, 'keydown', function (e) {
      if (e.key !== 'Tab' || !mqDrawer.matches || !appEl || !appEl.classList.contains('is-drawer-open')) { return; }
      var drawer = $('#drawer');
      if (!drawer) { return; }
      var focusables = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', drawer)
        .filter(function (el) { return el.offsetParent !== null; });
      if (!focusables.length) { return; }
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });
    if (mqDrawer.addEventListener) { mqDrawer.addEventListener('change', function () { closeDrawer(true); }); }

    /* 5.3 私密频道：权限口吻的拦截 */
    $$('[data-private]').forEach(function (a) {
      on(a, 'click', function (e) {
        e.preventDefault();
        toast('私密频道 · 仅频道成员可读（第三协议现有 2 名成员）', '权限守卫');
      });
    });

    /* 5.4 通用演示操作：带 data-toast 的元素 */
    $$('[data-toast]').forEach(function (el) {
      on(el, 'click', function (e) {
        if (el.tagName === 'A') { e.preventDefault(); }
        toast(el.getAttribute('data-toast'), el.getAttribute('data-toast-label') || '演示操作');
      });
    });

    /* 5.5 复制 / 聚焦 / 通用快捷操作 */
    $$('[data-copy-target]').forEach(function (btn) {
      on(btn, 'click', function () {
        var target = $(btn.getAttribute('data-copy-target'));
        var text = target ? target.textContent.trim() : '';
        copyText(text, btn.getAttribute('data-copy-label'));
      });
    });
    $$('[data-focus-target]').forEach(function (btn) {
      on(btn, 'click', function () {
        var target = $(btn.getAttribute('data-focus-target'));
        if (!target) { return; }
        if (mqDrawer.matches) { openDrawer(btn); }
        window.setTimeout(function () { target.focus(); target.select && target.select(); }, mqDrawer.matches ? 300 : 0);
      });
    });
    $$('[data-quick]').forEach(function (btn) {
      on(btn, 'click', function () {
        toast(btn.getAttribute('data-quick'), '快捷操作');
      });
    });
    $$('[data-quick-settings]').forEach(function (btn) {
      on(btn, 'click', function () {
        toast(btn.getAttribute('data-quick-settings'), '设置');
      });
    });

    /* 5.6 成员下拉 / 成员列表 */
    $$('[data-member-select]').forEach(function (sel) {
      DATA.members.forEach(function (m) {
        var o = document.createElement('option');
        o.value = m.name;
        o.textContent = m.name + ' · ' + m.role;
        sel.appendChild(o);
      });
    });
    $$('[data-member-list]').forEach(function (list) {
      DATA.members.forEach(function (m) {
        var li = document.createElement('li');
        li.className = 'member';
        li.innerHTML =
          '<span class="avatar avatar--xs" aria-hidden="true">' + escapeHTML(m.out) + '</span>' +
          '<span class="member-name">' + escapeHTML(m.name) + '</span>' +
          '<span class="online-dot' + (m.online ? '' : ' online-dot--off') + '" aria-label="' + (m.online ? '在线' : '离线') + '"></span>' +
          '<span class="member-role">' + escapeHTML(m.role) + '</span>';
        list.appendChild(li);
      });
    });

    initChat();
    initArchive();
    initBoard();
    initVote();
    initTasks();
    initGallery();
    initInvites();
    initSettings();
  }

  /* 6. 频道聊天 ----------------------------------------------------------- */
  function initChat() {
    var stream = $('[data-stream]');
    if (!stream) { return; }

    var input = $('[data-composer]');
    var sendBtn = $('[data-send]');
    var counter = $('[data-char-count]');
    var max = 8000;

    function updateCount() {
      if (!input || !counter) { return; }
      counter.textContent = input.value.length + ' / ' + max;
    }
    on(input, 'input', updateCount);
    updateCount();

    function sendSignal() {
      if (!input) { return; }
      var text = input.value.trim();
      if (!text) {
        toast('信号为空 · 未发送', '发送信号');
        input.focus();
        return;
      }
      if (text.length > max) {
        toast('信号超出 ' + max + ' 字符上限', '发送信号');
        return;
      }
      var msg = document.createElement('article');
      msg.className = 'msg msg--me is-new';
      msg.setAttribute('data-sender', DATA.me.name);
      msg.setAttribute('data-signal-id', '0411');
      msg.setAttribute('data-time', clockHM());
      msg.setAttribute('data-thread', '0');
      msg.innerHTML =
        '<div class="msg-avatar"><span class="avatar avatar--teal" aria-hidden="true">岑</span></div>' +
        '<div class="msg-main">' +
          '<div class="msg-head">' +
            '<span class="msg-name">' + escapeHTML(DATA.me.name) + '</span>' +
            '<span class="msg-role">' + escapeHTML(DATA.me.role) + '</span>' +
            '<span class="msg-handle">@' + escapeHTML(DATA.me.handle) + '</span>' +
            '<span class="msg-time">' + clockHM() + '</span>' +
          '</div>' +
          '<div class="msg-body"></div>' +
          '<div class="msg-foot"><span class="hint">信号已入队 · 持久化后回执</span></div>' +
        '</div>';
      msg.querySelector('.msg-body').textContent = text;
      stream.appendChild(msg);
      input.value = '';
      updateCount();
      msg.scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth', block: 'nearest' });
      toast('信号已发送：' + (text.length > 24 ? text.slice(0, 24) + '…' : text), '发送信号');
      announce(msg, '信号已发送');
    }

    on(sendBtn, 'click', sendSignal);
    on(input, 'keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        sendSignal();
      }
    });

    /* 选中信号 → 档案抽屉（注意：消息自身也带 data-signal-id，查询必须限定在抽屉内） */
    function selectSignal(msg) {
      $$('.msg.is-active', stream).forEach(function (m) { m.classList.remove('is-active'); });
      msg.classList.add('is-active');
      var d = msg.dataset;
      var aside = $('#drawer');
      var set = function (sel, val) { var el = $(sel, aside); if (el) { el.textContent = val; } };
      set('[data-signal-id]', '#' + (d.signalId || '0402'));
      set('[data-signal-from]', d.sender || '陆见深');
      set('[data-signal-time]', '2026.10.22 ' + (d.time || '09:12'));
      set('[data-signal-channel]', '#全域播报');
      set('[data-signal-thread]', (d.thread || '0') + ' 条线程记录');
      set('[data-signal-reactions]', (d.reactions || '0') + ' 次反应');
      var aside = $('#drawer');
      if (mqDrawer.matches && aside) { openDrawer($('.drawer-toggle')); }
    }
    $$('.msg[data-signal-id]', stream).forEach(function (msg) {
      on(msg, 'click', function (e) {
        if (e.target.closest('.reaction') || e.target.closest('a') || e.target.closest('button')) { return; }
        selectSignal(msg);
      });
      on(msg, 'keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectSignal(msg);
        }
      });
      msg.setAttribute('tabindex', '0');
      msg.setAttribute('role', 'button');
      msg.setAttribute('aria-label', '查看信号 ' + (msg.dataset.signalId || '') + ' 的档案详情');
    });

    /* 反应 */
    $$('.reaction', stream).forEach(function (btn) {
      on(btn, 'click', function (e) {
        e.stopPropagation();
        var countEl = btn.querySelector('.reaction-count');
        var n = parseInt((countEl && countEl.textContent) || '0', 10);
        var mine = btn.classList.toggle('is-mine');
        if (countEl) { countEl.textContent = String(n + (mine ? 1 : -1)); }
        toast(mine ? '已记录反应' : '已撤销反应', '反应');
      });
    });

    /* 线程跳转 */
    $$('[data-thread-jump]', stream).forEach(function (link) {
      on(link, 'click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toast('线程记录 · 2 条已展开至档案抽屉（演示）', '线程');
      });
    });
  }

  /* 7. 素材档案 ----------------------------------------------------------- */
  function initArchive() {
    var rows = $$('[data-file-row]');
    if (!rows.length) { return; }

    function selectFile(row) {
      rows.forEach(function (r) { r.classList.remove('is-active'); });
      row.classList.add('is-active');
      var d = row.dataset;
      var set = function (sel, val) { var el = $(sel); if (el) { el.textContent = val; } };
      set('[data-file-name]', d.fileTitle || '');
      set('[data-file-code]', d.fileCode || '');
      set('[data-file-kind]', d.fileKindLabel || '图像');
      set('[data-file-size]', d.fileSize || '');
      set('[data-file-owner]', d.fileOwner || '');
      set('[data-file-date]', '2026.' + (d.fileDate || '10.21'));
      set('[data-file-dims]', d.fileDims || '');
      set('[data-file-status]', d.fileStatus || '已就绪');
      set('[data-file-tag]', d.fileTag || '');
      var thumb = $('[data-file-preview]');
      if (thumb) { thumb.setAttribute('data-kind', d.fileKind || 'image'); }
    }

    rows.forEach(function (row) {
      on(row, 'click', function () { selectFile(row); });
    });

    var tabs = $$('[data-file-kind]');
    tabs.forEach(function (tab) {
      on(tab, 'click', function () {
        tabs.forEach(function (t) {
          t.classList.remove('is-active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('is-active');
        tab.setAttribute('aria-selected', 'true');
        var kind = tab.getAttribute('data-file-kind');
        var firstVisible = null;
        rows.forEach(function (row) {
          var show = kind === 'all' || row.dataset.kind === kind;
          row.hidden = !show;
          if (show && !firstVisible) { firstVisible = row; }
        });
        var active = rows.filter(function (r) { return r.classList.contains('is-active') && !r.hidden; })[0];
        if (!active && firstVisible) { selectFile(firstVisible); }
        toast('索引已切换：' + tab.textContent.trim(), '素材索引');
      });
    });

    var copy = $('[data-copy-file]');
    on(copy, 'click', function () {
      var name = $('[data-file-name]');
      copyText(name ? name.textContent : '素材', '素材名已抄录');
    });
  }

  /* 8. 灵感看板 ----------------------------------------------------------- */
  function initBoard() {
    var notes = $$('.note[data-note-title]');
    if (!notes.length) { return; }
    notes.forEach(function (note) {
      var activate = function () {
        notes.forEach(function (n) { n.classList.remove('is-active'); });
        note.classList.add('is-active');
        var d = note.dataset;
        var set = function (sel, val) { var el = $(sel); if (el) { el.textContent = val; } };
        set('[data-idea-title]', d.noteTitle || '');
        set('[data-idea-no]', d.noteNo || '');
        set('[data-idea-author]', d.noteAuthor || '');
        set('[data-idea-date]', '2026.' + (d.noteDate || '10.21'));
        set('[data-idea-tag]', d.noteTagLabel || '青');
        set('[data-idea-status]', d.noteStatus || '草案');
        var statusEl = $('[data-idea-status]');
        if (statusEl) {
          var map = { '草案': 'stamp--square stamp--todo', '论证': 'stamp--round stamp--doing', '入档': 'stamp--done' };
          statusEl.className = 'stamp ' + (map[d.noteStatus] || map['草案']);
        }
        var body = $('[data-idea-body]');
        if (body) { body.textContent = d.noteBody || ''; }
      };
      on(note, 'click', activate);
      on(note, 'keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
      });
      if (!note.hasAttribute('tabindex')) { note.setAttribute('tabindex', '0'); }
    });
  }

  /* 9. 票根投票 ----------------------------------------------------------- */
  function initVote() {
    var ticket = $('[data-vote-ticket]');
    if (!ticket) { return; }

    var options = $$('.opt[data-vote-option]', ticket);
    var inputEls = $$('.opt-input', ticket);
    var state = { voted: false };
    var serial = DATA.vote.serial;

    function updateSelectedUI() {
      var n = 0;
      options.forEach(function (opt) {
        var checked = !!opt.querySelector('.opt-input').checked;
        opt.classList.toggle('is-checked', checked);
        if (checked) { n += 1; }
      });
      var label = $('[data-vote-selected]');
      if (label) {
        label.textContent = state.voted ? '选票已封存' : (n ? '已选 ' + n + ' 项' : '尚未选择');
      }
      announce(label, label ? label.textContent : '');
    }

    options.forEach(function (opt) {
      var input = opt.querySelector('.opt-input');
      on(input, 'change', updateSelectedUI);
    });

    function recalc(selectedLabels) {
      var voterTotal = state.voted ? DATA.vote.voters + 1 : DATA.vote.voters;
      options.forEach(function (opt) {
        var optLabel = opt.getAttribute('data-vote-option');
        var base = parseInt(opt.getAttribute('data-base-votes'), 10) || 0;
        var votes = base + (selectedLabels.indexOf(optLabel) > -1 ? 1 : 0);
        var pct = Math.round((votes / voterTotal) * 100);
        var countEl = opt.querySelector('.opt-count');
        if (countEl) { countEl.textContent = votes + ' 票 · ' + pct + '%'; }
        var bar = opt.querySelector('.opt-bar span');
        if (bar) { bar.style.setProperty('--w', pct + '%'); }
      });
    }

    function submitVote() {
      if (state.voted) {
        toast('选票已封存 · 同一票据不可重复提交', '投票');
        return;
      }
      var selected = options.filter(function (opt) {
        return !!opt.querySelector('.opt-input').checked;
      }).map(function (opt) { return opt.getAttribute('data-vote-option'); });
      if (!selected.length) {
        toast('未选择任何主题 · 选票未提交', '投票');
        return;
      }
      state.voted = true;
      ticket.classList.add('is-voted');
      inputEls.forEach(function (i) { i.disabled = true; });
      selected.forEach(function (label) {
        var opt = options.filter(function (o) { return o.getAttribute('data-vote-option') === label; })[0];
        if (opt) { opt.classList.add('is-voted'); }
      });
      updateSelectedUI();
      recalc(selected);

      var voters = $('[data-vote-voters]');
      if (voters) { setText('[data-vote-voters]', String(DATA.vote.voters + 1)); }
      var metaVoters = $('[data-vote-meta-voters]');
      if (metaVoters) { metaVoters.textContent = String(DATA.vote.voters + 1); }
      var metaBallots = $('[data-vote-meta-ballots]');
      if (metaBallots) { metaBallots.textContent = String(9 + selected.length); }

      var avatars = $('[data-voter-avatars]');
      if (avatars && !avatars.querySelector('[data-me-vote]')) {
        var mine = document.createElement('span');
        mine.className = 'avatar avatar--xs avatar--copper';
        mine.setAttribute('data-me-vote', '1');
        mine.setAttribute('aria-label', '岑野 已投票');
        mine.textContent = '岑';
        avatars.appendChild(mine);
      }

      var result = $('[data-vote-result]');
      if (result) {
        result.hidden = false;
        var seal = result.querySelector('.seal');
        if (seal) {
          seal.hidden = false;
          seal.classList.add('is-stamping');
          var serialEl = result.querySelector('[data-result-serial]');
          if (serialEl) { serialEl.textContent = serial; }
        }
      }
      toast('选票已封存 · 票号 ' + serial + ' · 10.25 开票', '投票');
      announce(ticket, '选票已提交，票号 ' + serial);
    }

    on($('[data-vote-submit]'), 'click', submitVote);
    on($('[data-vote-save]'), 'click', function () {
      toast('存根联已抄录：' + serial, '票根');
    });

    updateSelectedUI();
    recalc([]);

    /* 票据核验 */
    var form = $('[data-verify-form]');
    if (!form) { return; }
    var input = $('[data-verify-input]', form);
    var resultBox = $('[data-verify-result]');
    var okSeal = $('[data-verify-ok]');
    var failSeal = $('[data-verify-fail]');
    var detail = $('[data-verify-detail]');
    var reason = $('[data-verify-reason]');

    on(form, 'submit', function (e) {
      e.preventDefault();
      var value = (input && input.value || '').trim().toUpperCase();
      if (!value) {
        toast('请输入存根联上的票号', '票据核验');
        if (input) { input.focus(); }
        return;
      }
      var valid = /^CW-\d{4}-\d{2,3}$/.test(value);
      if (resultBox) {
        resultBox.hidden = false;
        resultBox.classList.toggle('is-error', !valid);
      }
      if (valid) {
        if (okSeal) { okSeal.hidden = false; okSeal.classList.add('is-stamping'); }
        if (failSeal) { failSeal.hidden = true; }
        if (detail) { detail.hidden = false; }
        if (reason) { reason.hidden = true; }
        var set = function (sel, val) {
          var el = $(sel, resultBox);
          if (el) { el.textContent = val; }
        };
        set('[data-verify-code]', value);
        set('[data-verify-vote]', '本轮主题：雾海 / 锈带 / 静默轨道');
        set('[data-verify-type]', '多选 · 截止 10.25');
        set('[data-verify-time]', '2026.10.22 11:02');
        set('[data-verify-state]', '有效 · 未开票');
        toast('票据核验通过 · ' + value, '票据核验');
      } else {
        if (okSeal) { okSeal.hidden = true; }
        if (failSeal) { failSeal.hidden = false; failSeal.classList.add('is-stamping'); }
        if (detail) { detail.hidden = true; }
        if (reason) {
          reason.hidden = false;
          reason.textContent = '票号无法对上 · 请核对存根联（示例：CW-1025-07）';
        }
        toast('票据核验未通过 · 请核对存根联', '票据核验');
      }
    });
  }

  /* 10. 任务台账 ---------------------------------------------------------- */
  function initTasks() {
    var rows = $$('[data-task-row]');
    if (!rows.length) { return; }

    var statusBtns = $$('[data-filter-status]');
    var ownerSel = $('[data-filter-owner]');
    var dueCheck = $('[data-filter-due]');
    var emptyEl = $('[data-ledger-empty]');
    var visibleCount = $('[data-visible-count]');
    var state = { status: 'all', owner: 'all', dueOnly: false };
    var STATUS_ORDER = ['todo', 'doing', 'done'];
    var STATUS_LABEL = { todo: '待办', doing: '进行中', done: '已完成' };

    function applyFilters() {
      var count = 0;
      rows.forEach(function (row) {
        var status = row.getAttribute('data-status');
        var owner = row.getAttribute('data-owner');
        var due = row.getAttribute('data-due') || '';
        var show = (state.status === 'all' || status === state.status)
          && (state.owner === 'all' || owner === state.owner)
          && (!state.dueOnly || (status !== 'done' && due <= '2026-10-25'));
        row.classList.toggle('is-hidden', !show);
        if (show) { count += 1; }
      });
      if (emptyEl) { emptyEl.hidden = count > 0; }
      if (visibleCount) { visibleCount.textContent = String(count); }
    }

    statusBtns.forEach(function (btn) {
      on(btn, 'click', function () {
        state.status = btn.getAttribute('data-filter-status');
        statusBtns.forEach(function (b) {
          b.classList.toggle('is-active', b === btn);
          b.setAttribute('aria-pressed', String(b === btn));
        });
        applyFilters();
      });
    });
    on(ownerSel, 'change', function () {
      state.owner = ownerSel.value;
      applyFilters();
    });
    on(dueCheck, 'change', function () {
      state.dueOnly = dueCheck.checked;
      applyFilters();
    });

    function updateSummary() {
      var counts = { todo: 0, doing: 0, done: 0 };
      rows.forEach(function (row) {
        var s = row.getAttribute('data-status');
        if (counts[s] != null) { counts[s] += 1; }
      });
      var set = function (sel, val) { var el = $(sel); if (el) { el.textContent = val; } };
      set('[data-count-todo]', String(counts.todo));
      set('[data-count-doing]', String(counts.doing));
      set('[data-count-done]', String(counts.done));
      statusBtns.forEach(function (btn) {
        var key = btn.getAttribute('data-filter-status');
        var countEl = btn.querySelector('.seg-count');
        if (countEl) {
          countEl.textContent = key === 'all' ? String(rows.length) : String(counts[key] || 0);
        }
      });
    }

    $$('[data-cycle-state]').forEach(function (btn) {
      on(btn, 'click', function (e) {
        e.stopPropagation();
        var row = btn.closest('[data-task-row]');
        if (!row) { return; }
        var current = row.getAttribute('data-status');
        var next = STATUS_ORDER[(STATUS_ORDER.indexOf(current) + 1) % STATUS_ORDER.length];
        row.setAttribute('data-status', next);
        btn.classList.remove('stamp--todo', 'stamp--doing', 'stamp--done', 'stamp--round', 'stamp--square');
        btn.classList.add('stamp--' + next);
        btn.classList.add(next === 'todo' ? 'stamp--square' : 'stamp--round');
        btn.textContent = STATUS_LABEL[next];
        updateSummary();
        applyFilters();
        toast('状态已记录：' + STATUS_LABEL[next], '任务台账');
      });
    });

    function selectTask(row) {
      rows.forEach(function (r) { r.classList.remove('is-active'); });
      row.classList.add('is-active');
      var set = function (sel, val) { var el = $(sel); if (el) { el.textContent = val; } };
      set('[data-task-detail-title]', row.querySelector('.task-title') ? row.querySelector('.task-title').textContent : '');
      set('[data-task-detail-owner]', row.getAttribute('data-owner') || '');
      set('[data-task-detail-status]', STATUS_LABEL[row.getAttribute('data-status')] || '');
      set('[data-task-detail-due]', row.getAttribute('data-due') || '');
      set('[data-task-detail-rel]', row.getAttribute('data-rel') || '—');
      set('[data-task-detail-note]', row.getAttribute('data-note') || '');
      var seal = $('[data-task-detail-seal]');
      if (seal) {
        seal.className = 'seal seal--' + (row.getAttribute('data-status') || 'todo');
        seal.querySelector('b').textContent = STATUS_LABEL[row.getAttribute('data-status')] || '待办';
      }
      if (mqDrawer.matches) { openDrawer($('.drawer-toggle')); }
    }
    rows.forEach(function (row) {
      on(row, 'click', function (e) {
        if (e.target.closest('button')) { return; }
        selectTask(row);
      });
      on(row, 'keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.target.closest('button')) { return; }
          e.preventDefault(); selectTask(row);
        }
      });
    });

    updateSummary();
    applyFilters();
  }

  /* 11. 作品画廊 ---------------------------------------------------------- */
  function initGallery() {
    var thumbs = $$('[data-art-thumb]');
    if (!thumbs.length) { return; }
    var slides = $$('[data-art-slide]');
    var likeBtn = $('[data-like]');
    var liked = false;

    function selectArt(thumb) {
      thumbs.forEach(function (t) {
        var active = t === thumb;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-pressed', String(active));
      });
      var index = thumb.getAttribute('data-art-thumb');
      slides.forEach(function (s) {
        s.hidden = s.getAttribute('data-art-slide') !== index;
      });
      setText('[data-art-title]', thumb.getAttribute('data-art-title') || '');
      setText('[data-art-sub]', thumb.getAttribute('data-art-sub') || '');
      setText('[data-art-no]', thumb.getAttribute('data-art-no') || '');
      setText('[data-art-phase]', thumb.getAttribute('data-art-phase') || '');
    }

    thumbs.forEach(function (thumb) {
      on(thumb, 'click', function () { selectArt(thumb); });
    });

    on(likeBtn, 'click', function () {
      liked = !liked;
      likeBtn.classList.toggle('is-liked', liked);
      likeBtn.setAttribute('aria-pressed', String(liked));
      var n = DATA.artworks.likes + (liked ? 1 : 0);
      setText('[data-like-count]', String(n));
      toast(liked ? '已记入作品赞数：' + n : '已撤回赞：' + n, '作品档案');
    });
  }

  /* 12. 邀请簿 ------------------------------------------------------------ */
  function initInvites() {
    var form = $('[data-invite-form]');
    if (!form) { return; }
    var result = $('[data-invite-result]');
    var codeEl = $('[data-invite-code]');
    var rowsBox = $('[data-invite-rows]');
    var roleSel = $('[data-invite-role]');
    var expiresSel = $('[data-invite-expires]');
    var noteInput = $('[data-invite-note]');
    var usesSel = $('[data-invite-uses]');

    function randomCode() {
      var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      var out = '';
      for (var i = 0; i < 8; i += 1) {
        out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
      }
      return out.slice(0, 4) + '-' + out.slice(4);
    }

    function addInviteRow(record) {
      if (!rowsBox) { return; }
      var row = document.createElement('div');
      row.className = 'invite-row';
      row.setAttribute('data-invite-row', '1');
      row.setAttribute('data-status', 'pending');
      row.innerHTML =
        '<span class="invite-prefix">' + escapeHTML(record.prefix) + '</span>' +
        '<span class="invite-cell invite-role">' + escapeHTML(record.role) + '</span>' +
        '<span class="invite-note">' + escapeHTML(record.note) + '</span>' +
        '<span class="invite-cell invite-expires">' + escapeHTML(record.expires) + '</span>' +
        '<span class="invite-cell invite-cell--uses">' + escapeHTML(record.uses) + '</span>' +
        '<span class="cell cell--state"><span class="stamp stamp--round stamp--doing">待领取</span></span>' +
        '<span class="cell cell--act"><button class="btn btn--quiet btn--sm" type="button" data-revoke>撤销</button></span>';
      rowsBox.insertBefore(row, rowsBox.firstChild);
      bindRevoke(row);
    }

    function bindRevoke(row) {
      var btn = $('[data-revoke]', row);
      on(btn, 'click', function () {
        var stamp = row.querySelector('.stamp');
        if (stamp) {
          stamp.className = 'stamp stamp--square stamp--closed';
          stamp.textContent = '已撤销';
        }
        var stateCell = row.querySelector('.cell--state');
        if (stateCell) { stateCell.innerHTML = '<span class="stamp stamp--square stamp--closed">已撤销</span>'; }
        row.setAttribute('data-status', 'revoked');
        if (btn) { btn.disabled = true; }
        toast('邀请已撤销 · 立即生效', '邀请簿');
      });
    }

    $$('[data-invite-row]').forEach(bindRevoke);

    on(form, 'submit', function (e) {
      e.preventDefault();
      var note = (noteInput && noteInput.value.trim()) || '未注明用途';
      var role = roleSel ? roleSel.value : '成员';
      var expires = expiresSel ? expiresSel.value : '10.29';
      var uses = usesSel ? usesSel.value : '1';
      var code = randomCode();
      var prefix = code.slice(0, 4);
      if (codeEl) { codeEl.textContent = code; }
      if (result) {
        result.hidden = false;
        result.classList.remove('is-new');
        void result.offsetWidth;
        result.classList.add('is-new');
      }
      var noteOut = $('[data-invite-note-out]');
      if (noteOut) { noteOut.textContent = role + ' · ' + note + ' · ' + expires + ' 到期'; }
      addInviteRow({ prefix: prefix, role: role, note: note, expires: expires, uses: '0 / ' + uses, status: 'pending' });
      toast('邀请已开具 · 明文仅显示一次', '邀请簿');
      announce(form, '邀请已开具');
    });

    $$('[data-copy-invite]').forEach(function (btn) {
      on(btn, 'click', function () {
        var code = codeEl ? codeEl.textContent.trim() : '';
        if (!code || code.indexOf('·') > -1 || code === '—') {
          toast('请先开具一份邀请', '邀请簿');
          return;
        }
        copyText(code, '邀请码已复制 · 明文仅显示一次');
      });
    });
  }

  /* 13. 设置 -------------------------------------------------------------- */
  function initSettings() {
    var paperGrid = $('[data-paper-grid]');
    if (paperGrid) {
      on(paperGrid, 'change', function () {
        document.documentElement.classList.toggle('no-grid', !paperGrid.checked);
        toast(paperGrid.checked ? '细格纸底纹：已启用' : '细格纸底纹：已关闭（保留纸噪）', '外观设置');
      });
    }

    var dnd = $('[data-dnd]');
    if (dnd) {
      var times = $$('[data-dnd-time]');
      var syncDnd = function () {
        times.forEach(function (t) { t.disabled = !dnd.checked; });
      };
      on(dnd, 'change', function () {
        syncDnd();
        toast(dnd.checked ? '免打扰已启用 · 22:00–08:00' : '免打扰已关闭', '通知设置');
      });
      syncDnd();
    }

    $$('[data-switch]').forEach(function (input) {
      on(input, 'change', function () {
        var label = input.getAttribute('data-switch-label') || '通知设置';
        toast(label + (input.checked ? '：已启用' : '：已关闭'), '通知设置');
      });
    });

    $$('[data-save-settings]').forEach(function (btn) {
      on(btn, 'click', function () {
        toast('设置已归档 · 2026.10.22 ' + clockHM(), '设置');
        announce(document.body, '设置已保存');
      });
    });
    $$('[data-password]').forEach(function (btn) {
      on(btn, 'click', function () {
        toast('修改密码 · 需通过身份校验（演示稿不执行）', '安全');
      });
    });
    $$('[data-signout-device]').forEach(function (btn) {
      on(btn, 'click', function () {
        toast('已撤销一台设备的会话（演示）', '安全');
      });
    });
  }

  /* 14. 启动 -------------------------------------------------------------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
