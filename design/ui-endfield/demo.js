/* ==========================================================================
   demo.js · O.M.V 帝江号 · 全域广播（甲套）
   --------------------------------------------------------------------------
   静态演示用的交互脚本：不依赖框架、不加载外部资源，file:// 直接打开可用。
   覆盖：深浅主题（记住本机选择）、对话框与确认、线程展开、引用与发送、
   素材筛选 / 拖拽归档 / 上传进度、灵感墙换列（拖拽 + 按钮）、
   投票提交与结果条、任务状态流转与指派、作品墙大图预览与赞、
   邀请码生成 / 复制 / 撤销、成员角色与移出、设置（免打扰 / 主题）。
   动效遵守 prefers-reduced-motion：系统要求减少动态时全部瞬时完成。
   ========================================================================== */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;

  function $(sel, el) { return (el || doc).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || doc).querySelectorAll(sel)); }
  function closest(el, sel) { return el && el.closest ? el.closest(sel) : null; }
  function setText(sel, value, el) { var n = $(sel, el); if (n) { n.textContent = value; return n; } return null; }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  var mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reduced() { return !!(mqReduce && mqReduce.matches); }

  /* ---------- 读屏与提示条 ---------- */

  function live(msg) { setText('[data-live]', msg); }

  var toastEl = null;
  var toastTimer = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = doc.createElement('div');
      toastEl.className = 'ef-toast';
      toastEl.setAttribute('role', 'status');
      doc.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.hidden = false;
    toastEl.classList.remove('is-closing');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.add('is-closing');
      setTimeout(function () {
        toastEl.hidden = true;
        toastEl.classList.remove('is-closing');
      }, reduced() ? 0 : 200);
    }, 2200);
  }

  /* ---------- 主题：浅色 / 深色 / 跟随系统 ---------- */

  var THEME_KEY = 'dj-theme';
  var THEME_LABEL = { light: '浅色', dark: '深色', system: '跟随系统' };

  function storedMode() {
    try {
      var v = localStorage.getItem(THEME_KEY);
      return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
    } catch (e) {
      return 'system';
    }
  }

  function systemDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function effectiveDark() {
    var t = root.getAttribute('data-theme');
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return systemDark();
  }

  function applyTheme(mode, remember) {
    if (mode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
    if (remember !== false) {
      try { localStorage.setItem(THEME_KEY, mode); } catch (e) {}
    }
    var dark = effectiveDark();
    $$('[data-theme-toggle]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(dark));
      btn.textContent = dark ? '浅色' : '深色';
      btn.setAttribute('aria-label', dark ? '切换到浅色主题' : '切换到深色主题');
    });
    $$('input[name="theme"]').forEach(function (r) { r.checked = r.value === mode; });
    setText('[data-theme-state]', THEME_LABEL[mode]);
    setText('[data-sum-theme]', THEME_LABEL[mode]);
  }

  function wireTheme() {
    // 页面打开时把本机选择补到界面上（head 里的内联脚本已经先写好主题）
    var mode = storedMode();
    applyTheme(mode, false);
    $$('[data-theme-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        mode = effectiveDark() ? 'light' : 'dark';
        applyTheme(mode, true);
        live('外观已切换到' + THEME_LABEL[mode]);
      });
    });
    $$('input[name="theme"]').forEach(function (r) {
      r.addEventListener('change', function () {
        applyTheme(r.value, true);
        live('外观已切换到' + THEME_LABEL[r.value]);
        toast('外观已切换到' + THEME_LABEL[r.value] + '。');
      });
    });
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onSystem = function () { if (storedMode() === 'system') applyTheme('system', false); };
      if (mq.addEventListener) mq.addEventListener('change', onSystem);
      else if (mq.addListener) mq.addListener(onSystem);
    }
  }

  function wireMotionState() {
    var el = $('[data-motion-state]');
    if (!el) return;
    var paint = function () { el.textContent = reduced() ? '已开启（系统设置）' : '未开启（系统设置）'; };
    paint();
    if (mqReduce && mqReduce.addEventListener) mqReduce.addEventListener('change', paint);
    else if (mqReduce && mqReduce.addListener) mqReduce.addListener(paint);
  }

  /* ---------- 对话框与确认 ---------- */

  var pendingScope = null;
  var pendingAction = null;

  function openDialog(d) {
    if (!d || d.open) return;
    if (d.showModal) d.showModal();
    else d.setAttribute('open', '');
  }

  function closeDialog(d) {
    if (!d || !d.open) return;
    d.classList.add('is-closing');
    setTimeout(function () {
      d.classList.remove('is-closing');
      if (d.close) d.close();
      else d.removeAttribute('open');
    }, reduced() ? 0 : 200);
  }

  function wipeRemove(el) {
    if (!el) return;
    el.classList.add('ef-out-wipe');
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, reduced() ? 0 : 200);
  }

  var ACTIONS = {
    'delete-message': function (el) {
      wipeRemove(el);
      live('信号已删除。');
      toast('信号已删除。');
    },
    'delete-material': function (el) {
      var name = el ? el.getAttribute('data-name-full') : '';
      wipeRemove(el);
      setTimeout(function () {
        refreshArchiveCounts();
        applyArchive();
      }, reduced() ? 0 : 220);
      live('素材已删除。');
      toast('素材已删除' + (name ? '：' + name : '') + '。');
      closeDialog($('#dlg-material'));
    },
    'remove-member': function (el) {
      if (!el) return;
      var nameNode = $('.dj-membername', el);
      var name = nameNode ? nameNode.childNodes[0].textContent.trim() : '成员';
      wipeRemove(el);
      setTimeout(function () {
        var left = $$('.dj-memberrow').length;
        setText('[data-member-count]', left + ' 位成员');
      }, reduced() ? 0 : 220);
      live(name + ' 已移出频道。');
      toast(name + ' 已移出频道。');
    },
    'revoke-invite': function (el) {
      if (!el) return;
      var chip = $('.ef-state', el);
      if (chip) { chip.className = 'ef-state is-hidden'; chip.textContent = '已撤销'; }
      var btn = $('.ef-btn', el);
      if (btn) btn.disabled = true;
      live('邀请码已撤销。');
      toast('邀请码已撤销，立刻失效。');
    },
    'revoke-new-code': function () {
      var block = $('[data-invite-new]');
      if (block) block.hidden = true;
      toast('新邀请码已撤销。');
      live('新邀请码已撤销。');
    }
  };

  function wireDialogs() {
    $$('dialog').forEach(function (d) {
      d.addEventListener('cancel', function (e) {
        if (reduced()) return;
        e.preventDefault();
        closeDialog(d);
      });
      d.addEventListener('click', function (e) {
        if (e.target === d) closeDialog(d);
      });
    });

    doc.addEventListener('click', function (e) {
      var opener = closest(e.target, '[data-open]');
      if (opener) {
        var d = doc.getElementById(opener.getAttribute('data-open'));
        var scopeSel = opener.getAttribute('data-scope');
        pendingScope = scopeSel ? closest(opener, scopeSel) : null;
        pendingAction = opener.getAttribute('data-action');
        openDialog(d);
        return;
      }

      var closer = closest(e.target, '[data-close]');
      if (closer) {
        pendingAction = null;
        pendingScope = null;
        closeDialog(closest(closer, 'dialog'));
        return;
      }

      var confirmBtn = closest(e.target, '[data-confirm]');
      if (confirmBtn) {
        var actionName = pendingAction || confirmBtn.getAttribute('data-confirm');
        var action = ACTIONS[actionName];
        if (action) action(pendingScope);
        if (actionName !== 'delete-material') closeDialog(closest(confirmBtn, 'dialog'));
        pendingAction = null;
        pendingScope = null;
        return;
      }

      var copyBtn = closest(e.target, '[data-copy-target]');
      if (copyBtn) {
        var target = $(copyBtn.getAttribute('data-copy-target'));
        if (target) copyText(target.textContent.trim(), '邀请码已复制。');
        return;
      }

      var copyCur = closest(e.target, '[data-copy-current]');
      if (copyCur) {
        var tile = pendingScope;
        var nm = tile ? tile.getAttribute('data-name-full') : '素材';
        copyText('https://dijiang.local/f/' + encodeURIComponent(nm || 'material'), '素材链接已复制。');
      }
    });
  }

  function copyText(text, okMsg) {
    var done = function () { toast(okMsg || '已复制。'); live(okMsg || '已复制。'); };
    var fail = function () { toast('复制没成功，请手动选中再复制。'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text) ? done() : fail(); });
    } else {
      legacyCopy(text) ? done() : fail();
    }
  }

  function legacyCopy(text) {
    try {
      var ta = doc.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-100px';
      doc.body.appendChild(ta);
      ta.select();
      var ok = doc.execCommand('copy');
      doc.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  /* ---------- 01 频道：线程、引用、发送、反应 ---------- */

  function wireChat() {
    var composer = $('[data-composer]');
    if (!composer) return;

    var input = $('.dj-input', composer);
    var err = $('[data-composer-error]', composer);
    var quoteBar = $('[data-quote-bar]', composer);
    var quoteText = $('[data-quote-text]', composer);
    var quote = null;

    $$('[data-quote]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var parts = String(btn.getAttribute('data-quote')).split('|');
        quote = { name: parts[0], text: parts.slice(1).join('|') };
        if (quoteText) quoteText.textContent = quote.name + '：' + quote.text;
        if (quoteBar) quoteBar.hidden = false;
        if (input) input.focus();
      });
    });

    var cancelQuote = $('[data-quote-cancel]', composer);
    if (cancelQuote) {
      cancelQuote.addEventListener('click', function () {
        quote = null;
        if (quoteBar) quoteBar.hidden = true;
        if (input) input.focus();
      });
    }

    function send() {
      var text = input ? input.value.trim() : '';
      if (!text) {
        if (err) {
          err.textContent = '先写点内容，再发送信号。';
          err.hidden = false;
        }
        if (input) input.focus();
        return;
      }
      if (err) err.hidden = true;
      var stream = $('.dj-stream');
      if (!stream) return;
      var li = doc.createElement('li');
      li.className = 'dj-msg ef-in-wipe';
      var quoted = quote
        ? '<div class="dj-quote"><span class="ef-field">引用 ' + esc(quote.name) + '</span><span>' + esc(quote.text) + '</span></div>'
        : '';
      li.innerHTML =
        '<span class="dj-avatar" aria-hidden="true">岑</span>' +
        '<div class="dj-msg-main">' +
        '<div class="dj-msg-head"><span class="dj-name">岑野</span><span class="ef-field">@cenye │ 建立者 │ 21:48</span></div>' +
        quoted +
        '<p class="dj-msg-text">' + esc(text) + '</p>' +
        '<div class="dj-msg-acts"><button class="dj-actlink" type="button" data-react aria-pressed="false">反应 0</button></div>' +
        '</div>';
      stream.appendChild(li);
      wireReact(li);
      if (input) input.value = '';
      quote = null;
      if (quoteBar) quoteBar.hidden = true;
      toast('信号已发送。');
      live('信号已发送。');
      if (li.scrollIntoView) li.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
    }

    var sendBtn = $('[data-send]', composer);
    if (sendBtn) sendBtn.addEventListener('click', send);
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          send();
        }
      });
    }

    $$('[data-thread-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var thread = doc.getElementById(btn.getAttribute('aria-controls'));
        if (!thread) return;
        var open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!open));
        thread.hidden = open;
        var n = $$('.dj-msg', thread).length;
        btn.textContent = (open ? '展开 ' : '收起 ') + n + ' 条回复';
        live((open ? '已收起 ' : '已展开 ') + n + ' 条回复');
      });
    });

    wireReact(composer);
  }

  function wireReact(scope) {
    $$('[data-react]', scope).forEach(function (btn) {
      if (btn.getAttribute('data-wired') === '1') return;
      btn.setAttribute('data-wired', '1');
      btn.addEventListener('click', function () {
        var m = btn.textContent.match(/(\d+)/);
        var n = m ? parseInt(m[1], 10) : 0;
        var on = btn.getAttribute('aria-pressed') === 'true';
        btn.setAttribute('aria-pressed', String(!on));
        btn.textContent = '反应 ' + (on ? n - 1 : n + 1);
      });
    });
  }

  /* ---------- 02 素材库：筛选、拖拽归档、上传进度 ---------- */

  var archiveState = { type: 'all', tag: 'all' };

  function chipLabel(group, value) {
    var btn = $('[data-filter="' + group + '"][data-value="' + value + '"]');
    if (!btn) return value;
    return btn.textContent.replace(/\d+$/, '').trim();
  }

  function refreshArchiveCounts() {
    var tiles = $$('[data-filterable]');
    var total = tiles.length;
    var size = 0;
    var kinds = {};
    var tags = {};
    tiles.forEach(function (t) {
      size += parseFloat(t.getAttribute('data-size-mb') || '0');
      var k = t.getAttribute('data-kind');
      kinds[k] = (kinds[k] || 0) + 1;
      (t.getAttribute('data-tags') || '').split(/\s+/).forEach(function (tg) {
        if (tg) tags[tg] = (tags[tg] || 0) + 1;
      });
    });
    $$('[data-archive-count]').forEach(function (el) { el.textContent = total; });
    $$('[data-archive-size]').forEach(function (el) { el.textContent = size.toFixed(1) + ' MB'; });
    $$('[data-count-kind]').forEach(function (el) {
      var k = el.getAttribute('data-count-kind');
      el.textContent = k === 'all' ? total : (kinds[k] || 0);
    });
    $$('[data-count-tag]').forEach(function (el) {
      el.textContent = tags[el.getAttribute('data-count-tag')] || 0;
    });
  }

  function applyArchive() {
    var qEl = $('[data-archive-q]');
    var q = qEl ? qEl.value.trim().toLowerCase() : '';
    var shown = 0;
    $$('[data-filterable]').forEach(function (t) {
      var okType = archiveState.type === 'all' || t.getAttribute('data-kind') === archiveState.type;
      var tagList = (t.getAttribute('data-tags') || '').split(/\s+/);
      var okTag = archiveState.tag === 'all' || tagList.indexOf(archiveState.tag) >= 0;
      var name = (t.getAttribute('data-name') || '').toLowerCase();
      var okQ = !q || name.indexOf(q) >= 0;
      var show = okType && okTag && okQ;
      t.hidden = !show;
      if (show) shown += 1;
    });
    setText('[data-visible-count]', shown);
    var empty = $('[data-empty]');
    if (empty) {
      empty.hidden = shown > 0;
      if (!shown) {
        setText('[data-empty-note]',
          '当前筛选：' + chipLabel('type', archiveState.type) + ' │ ' +
          chipLabel('tag', archiveState.tag) + (q ? ' │ 搜索「' + q + '」' : '') + ' │ 0 份');
      }
    }
  }

  function wireArchiveFilters() {
    if (!$('[data-archive-grid]')) return;
    $$('[data-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var group = btn.getAttribute('data-filter');
        var value = btn.getAttribute('data-value');
        var groupBtns = $$('[data-filter="' + group + '"]');
        if (btn.getAttribute('aria-pressed') === 'true' && value !== 'all') {
          // 再点一次回到「全部」
          value = 'all';
        }
        groupBtns.forEach(function (b) {
          b.setAttribute('aria-pressed', String(b.getAttribute('data-value') === value));
        });
        archiveState[group] = value;
        applyArchive();
        live('筛选：' + chipLabel('type', archiveState.type) + '，' + chipLabel('tag', archiveState.tag));
      });
    });
    var qEl = $('[data-archive-q]');
    if (qEl) qEl.addEventListener('input', applyArchive);
    var clear = $('[data-clear-filters]');
    if (clear) {
      clear.addEventListener('click', function () {
        archiveState = { type: 'all', tag: 'all' };
        $$('[data-filter]').forEach(function (b) {
          b.setAttribute('aria-pressed', String(b.getAttribute('data-value') === 'all'));
        });
        if (qEl) qEl.value = '';
        applyArchive();
        live('筛选已清空。');
      });
    }
    refreshArchiveCounts();
    applyArchive();
  }

  function kindOf(name) {
    var ext = String(name).split('.').pop().toLowerCase();
    if (['png', 'jpg', 'jpeg', 'webp', 'avif', 'heic'].indexOf(ext) >= 0) return 'image';
    if (['pdf', 'zip', 'md', 'txt'].indexOf(ext) >= 0) return ext === 'zip' ? 'archive' : 'document';
    if (['wav', 'mp3', 'm4a', 'ogg'].indexOf(ext) >= 0) return 'audio';
    return 'other';
  }

  var THUMBS = {
    image:
      '<svg viewBox="0 0 400 250" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1">' +
      '<path d="M30 26h340v198H30z"/><path d="M30 168h340" opacity=".4"/><circle cx="272" cy="96" r="38"/>' +
      '<path d="M58 152l46-46 34 36 24-22 42 32" opacity=".8"/></g></svg>',
    audio:
      '<svg viewBox="0 0 400 250" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1">' +
      '<path d="M44 125h312" opacity=".35"/><path d="M60 100v50M76 84v82M92 112v26M108 72v106M124 94v62M140 108v34M156 66v118M172 86v78M188 100v50M204 78v94M220 96v58M236 110v30M252 72v106M268 92v66M284 106v38M300 84v82M316 100v50M332 114v22M348 90v70" opacity=".8"/></g></svg>',
    document:
      '<svg viewBox="0 0 400 250" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1">' +
      '<path d="M132 26h98l44 42v156H132z"/><path d="M230 26v42h44"/><path d="M158 104h100M158 122h100M158 140h62" opacity=".55"/></g></svg>',
    archive:
      '<svg viewBox="0 0 400 250" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1">' +
      '<path d="M112 62h176v132H112z"/><path d="M112 84h176" opacity=".5"/><path d="M192 62v22h16V62M192 106v22h16v-22M192 150v22h16v-22" opacity=".7"/></g></svg>',
    other:
      '<svg viewBox="0 0 400 250" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1">' +
      '<path d="M120 40h160v170H120z"/><path d="M120 90h160M120 140h160M120 190h160" opacity=".35"/></g></svg>'
  };

  var KIND_LABEL = { image: '图片', document: '文档', archive: '压缩包', audio: '音频', other: '其他' };

  function fmtMB(mb) {
    return mb >= 1 ? mb.toFixed(1) + ' MB' : Math.round(mb * 1024) + ' KB';
  }

  function tileHtml(f) {
    var kind = f.kind || kindOf(f.name);
    var mb = f.mb || f.size / (1024 * 1024);
    var ext = String(f.name).split('.').pop().toUpperCase();
    return (
      '<button class="dj-tile" type="button" data-filterable data-kind="' + kind + '" data-tags="" ' +
      'data-name="' + esc(f.name) + '" data-size-mb="' + mb.toFixed(1) + '" data-material ' +
      'data-name-full="' + esc(f.name) + '" data-kind-label="' + KIND_LABEL[kind] + ' · ' + esc(ext) + '" ' +
      'data-dims="—" data-owner="岑野" data-date="2026.10.22 21:48" data-tags-label="未标注">' +
      '<span class="dj-thumb"><span class="dj-kindtag">' + esc(ext) + '</span>' + (THUMBS[kind] || THUMBS.other) + '</span>' +
      '<span class="dj-tile-name">' + esc(f.name) + '</span>' +
      '<span class="dj-tile-fields"><span>' + KIND_LABEL[kind] + '</span><span>' + fmtMB(mb) + '</span></span>' +
      '<span class="dj-tile-fields"><span>岑野</span><span>2026.10.22 21:48</span></span>' +
      '</button>'
    );
  }

  function startUpload(files) {
    var list = $('[data-progress-list]');
    var grid = $('[data-archive-grid]');
    if (!list || !grid) return;
    if (!files || !files.length) {
      files = [
        { name: '外景夜景_1041.jpg', size: 4.8 * 1024 * 1024, kind: 'image' },
        { name: '雾海采样_08.wav', size: 21.6 * 1024 * 1024, kind: 'audio' }
      ];
    }
    list.hidden = false;
    files.forEach(function (f) {
      var mb = (f.size || 0) / (1024 * 1024);
      var row = doc.createElement('div');
      row.className = 'dj-progrow';
      row.innerHTML =
        '<div class="h"><b>' + esc(f.name) + '</b><span class="ef-field">' + fmtMB(mb) + ' │ 0%</span></div>' +
        '<div class="ef-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" style="--p:0">' +
        '<span class="ef-eyebrow">Archive / 归档中</span><span class="ef-field" data-pct>000%</span><i></i></div>';
      list.appendChild(row);

      var bar = $('.ef-progress', row);
      var pct = $('[data-pct]', row);
      var readout = $('.h .ef-field', row);

      var finish = function () {
        bar.setAttribute('aria-valuenow', '100');
        bar.style.setProperty('--p', '1');
        if (pct) pct.textContent = '100%';
        if (readout) readout.textContent = fmtMB(mb) + ' │ 已归档';
        setTimeout(function () {
          var wrap = doc.createElement('div');
          wrap.innerHTML = tileHtml({ name: f.name, size: f.size, kind: f.kind });
          var tile = wrap.firstChild;
          grid.appendChild(tile);
          refreshArchiveCounts();
          applyArchive();
          if (row.parentNode) row.parentNode.removeChild(row);
          if (!list.children.length) list.hidden = true;
        }, reduced() ? 0 : 320);
      };

      if (reduced()) {
        finish();
        return;
      }

      var p = 0;
      var timer = setInterval(function () {
        p += 0.083 * (1 + Math.random() * 0.5);
        if (p >= 1) {
          p = 1;
          clearInterval(timer);
        }
        bar.style.setProperty('--p', p.toFixed(3));
        bar.setAttribute('aria-valuenow', String(Math.round(p * 100)));
        if (pct) pct.textContent = ('00' + Math.round(p * 100)).slice(-3) + '%';
        if (readout) readout.textContent = fmtMB(mb) + ' │ ' + Math.round(p * 100) + '%';
        if (p >= 1) finish();
      }, 130);
    });
    toast('开始归档 ' + files.length + ' 个文件。');
    live('开始归档 ' + files.length + ' 个文件。');
  }

  function wireUpload() {
    var drop = $('[data-drop]');
    if (!drop) return;
    var fileInput = $('[data-file-input]');
    var browse = $('[data-browse]');
    if (browse && fileInput) {
      browse.addEventListener('click', function () { fileInput.click(); });
    }
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        var files = Array.prototype.map.call(fileInput.files || [], function (f) {
          return { name: f.name, size: f.size, kind: kindOf(f.name) };
        });
        startUpload(files);
        fileInput.value = '';
      });
    }
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        drop.classList.add('is-over');
      });
    });
    ['dragleave', 'dragend'].forEach(function (ev) {
      drop.addEventListener(ev, function () {
        drop.classList.remove('is-over');
      });
    });
    drop.addEventListener('drop', function (e) {
      e.preventDefault();
      drop.classList.remove('is-over');
      var files = Array.prototype.map.call(e.dataTransfer ? e.dataTransfer.files || [] : [], function (f) {
        return { name: f.name, size: f.size, kind: kindOf(f.name) };
      });
      startUpload(files);
    });
  }

  function wireMaterialDialog() {
    $$('[data-material]').forEach(function (tile) {
      tile.addEventListener('click', function () {
        var d = $('#dlg-material');
        if (!d) return;
        pendingScope = tile;
        pendingAction = null;
        setText('[data-dlg-name]', tile.getAttribute('data-name-full'), d);
        setText('[data-dlg-kind]', tile.getAttribute('data-kind-label'), d);
        setText('[data-dlg-dims]', tile.getAttribute('data-dims'), d);
        setText('[data-dlg-size]', (tile.getAttribute('data-size-mb') || '—') + ' MB', d);
        setText('[data-dlg-owner]', tile.getAttribute('data-owner'), d);
        setText('[data-dlg-date]', tile.getAttribute('data-date'), d);
        setText('[data-dlg-tags]', tile.getAttribute('data-tags-label'), d);
        openDialog(d);
        live('打开素材：' + tile.getAttribute('data-name-full'));
      });
    });
  }

  /* ---------- 03 灵感墙：拖拽换列 + 移列按钮 ---------- */

  function wireBoard() {
    var board = $('[data-board]');
    if (!board) return;
    var dragging = null;

    $$('[data-idea]', board).forEach(function (card) {
      card.addEventListener('dragstart', function (e) {
        dragging = card;
        card.classList.add('is-dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', 'idea'); } catch (err) {}
        }
      });
      card.addEventListener('dragend', function () {
        card.classList.remove('is-dragging');
        dragging = null;
        syncCols();
      });
    });

    function colTitle(col) {
      var t = $('.dj-col-title', col);
      return t ? t.textContent.trim() : '';
    }

    function cardNo(card) {
      var f = $('.ef-field', card);
      return f ? f.textContent.trim() : '这条灵感';
    }

    $$('[data-col]', board).forEach(function (col) {
      col.addEventListener('dragover', function (e) {
        e.preventDefault();
        col.classList.add('is-over');
      });
      col.addEventListener('dragleave', function (e) {
        if (!col.contains(e.relatedTarget)) col.classList.remove('is-over');
      });
      col.addEventListener('drop', function (e) {
        e.preventDefault();
        col.classList.remove('is-over');
        if (!dragging) return;
        var body = $('[data-col-body]', col);
        if (body) body.appendChild(dragging);
        var no = cardNo(dragging);
        dragging = null;
        syncCols();
        live(no + ' 已移到' + colTitle(col));
        toast('已把 ' + no + ' 移到「' + colTitle(col) + '」。');
      });
    });

    $$('[data-move]', board).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var card = closest(btn, '[data-idea]');
        var cols = $$('[data-col]', board);
        var cur = closest(card, '[data-col]');
        var i = cols.indexOf(cur);
        var j = i + parseInt(btn.getAttribute('data-move'), 10);
        if (j < 0 || j >= cols.length) {
          toast('已经是最' + (j < 0 ? '左' : '右') + '边一列了。');
          return;
        }
        var body = $('[data-col-body]', cols[j]);
        if (body) body.appendChild(card);
        syncCols();
        live(cardNo(card) + ' 已移到' + colTitle(cols[j]));
        toast('已把 ' + cardNo(card) + ' 移到「' + colTitle(cols[j]) + '」。');
      });
    });

    function syncCols() {
      $$('[data-col]', board).forEach(function (col) {
        setText('[data-col-count]', String($$('[data-idea]', col).length), col);
      });
    }
    syncCols();
  }

  /* ---------- 04 投票：提交、结果条 ---------- */

  function wireVotes() {
    $$('[data-vote]').forEach(function (card) {
      var reveal = card.getAttribute('data-reveal') || 'always';
      var options = $$('.dj-opt', card);
      var submit = $('[data-vote-submit]', card);
      var stateEl = $('[data-vote-state]', card);
      var votersEl = $('[data-voters]', card);
      var results = $('[data-results]', card);
      var voted = false;
      var prev = [];
      var voters = parseInt(card.getAttribute('data-voters'), 10) || 0;

      function inputs() { return options.map(function (o) { return $('input', o); }); }
      function picked() {
        return options.filter(function (o) {
          var inp = $('input', o);
          return inp && inp.checked;
        }).map(function (o) { return $('input', o).value; });
      }

      function render() {
        var vals = options.map(function (o) { var i = $('input', o); return i ? i.value : ''; });
        var counts = options.map(function (o) { return parseInt(o.getAttribute('data-base') || '0', 10); });
        var picks = picked();

        prev.forEach(function (v) {
          var i = vals.indexOf(v);
          if (i >= 0) counts[i] = Math.max(0, counts[i] - 1);
        });
        picks.forEach(function (v) {
          var i = vals.indexOf(v);
          if (i >= 0) counts[i] += 1;
        });
        var max = Math.max.apply(null, counts.concat([1]));

        options.forEach(function (o, i) {
          var countEl = $('[data-count]', o);
          var barEl = $('[data-bar]', o);
          var barWrap = $('.dj-bar', o);
          var showResult = reveal === 'always' || voted;
          if (countEl) {
            countEl.hidden = !showResult;
            countEl.textContent = counts[i] + ' 票';
          }
          if (barEl) barEl.style.width = showResult ? Math.round((counts[i] / max) * 100) + '%' : '0';
          if (barWrap) barWrap.hidden = !showResult;
        });

        if (votersEl) votersEl.textContent = String(voted ? voters + 1 : voters);
        if (results) results.hidden = !(reveal === 'always' || voted);
      }

      if (submit) {
        submit.addEventListener('click', function () {
          if (!picked().length) {
            toast('先选一项，再提交投票。');
            live('先选一项，再提交投票。');
            return;
          }
          voted = true;
          render();
          prev = picked();
          var votersList = $('.dj-voters', card);
          if (votersList && votersList.textContent.indexOf('岑野') < 0) {
            votersList.textContent = '参与人：' + votersList.textContent.replace(/^参与人：/, '') + '、岑野';
          }
          if (stateEl) stateEl.textContent = '你已投票 · 截止前可以改选';
          toast('投票已提交。');
          live('投票已提交，结果已更新。');
        });
      }

      options.forEach(function (o) {
        var inp = $('input', o);
        if (!inp) return;
        inp.addEventListener('change', function () {
          if (voted) {
            render();
            prev = picked();
            if (stateEl) stateEl.textContent = '你已投票 · 截止前可以改选';
            live('改选已记录，票数已更新。');
          }
        });
      });

      render();
    });
  }

  /* ---------- 05 任务：状态流转、指派 ---------- */

  var TASK_LABEL = { todo: '待办', doing: '进行中', done: '已完成' };

  function wireTasks() {
    var list = $('[data-task-list]');
    if (!list) return;
    var filter = 'all';

    function syncCounts() {
      var n = { all: 0, todo: 0, doing: 0, done: 0 };
      $$('[data-task]', list).forEach(function (li) {
        n.all += 1;
        var s = li.getAttribute('data-status');
        n[s] = (n[s] || 0) + 1;
      });
      $$('[data-task-count]').forEach(function (el) {
        el.textContent = n[el.getAttribute('data-task-count')] || 0;
      });
    }

    function applyFilter() {
      var shown = 0;
      $$('[data-task]', list).forEach(function (li) {
        var ok = filter === 'all' || li.getAttribute('data-status') === filter;
        li.hidden = !ok;
        if (ok) shown += 1;
      });
      var empty = $('[data-task-empty]');
      if (empty) empty.hidden = shown > 0;
    }

    function setStatus(li, status) {
      if (!li || !TASK_LABEL[status]) return;
      li.setAttribute('data-status', status);
      var chip = $('[data-task-state]', li);
      if (chip) {
        chip.className = 'ef-state' + (status === 'todo' ? ' is-draft' : status === 'done' ? ' is-done' : '');
        chip.textContent = TASK_LABEL[status];
      }
      var acts = $('.acts', li);
      if (acts) {
        var html = '';
        if (status !== 'done') {
          html += '<button class="ef-btn small" type="button" data-open="dlg-assign" data-scope="[data-task]">指派</button>';
        }
        if (status === 'todo') {
          html += '<button class="ef-btn small go" type="button" data-task-set="doing">开始处理</button>';
        } else if (status === 'doing') {
          html += '<button class="ef-btn small go" type="button" data-task-set="done">标记完成</button>';
        } else {
          html += '<button class="ef-btn small" type="button" data-task-set="todo">重新打开</button>';
        }
        acts.innerHTML = html;
      }
      var meta = $('.meta', li);
      var doneEl = $('[data-task-done]', li);
      if (status === 'done' && !doneEl && meta) {
        var span = doc.createElement('span');
        span.setAttribute('data-task-done', '');
        span.textContent = '完成于 2026.10.22 21:48';
        meta.appendChild(span);
      } else if (status !== 'done' && doneEl) {
        doneEl.parentNode.removeChild(doneEl);
      }
      syncCounts();
      applyFilter();
      toast('任务已标记为「' + TASK_LABEL[status] + '」。');
      live('任务已标记为' + TASK_LABEL[status]);
    }

    list.addEventListener('click', function (e) {
      var btn = closest(e.target, '[data-task-set]');
      if (!btn) return;
      setStatus(closest(btn, '[data-task]'), btn.getAttribute('data-task-set'));
    });

    $$('[data-task-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        filter = btn.getAttribute('data-task-filter');
        $$('[data-task-filter]').forEach(function (b) {
          b.setAttribute('aria-pressed', String(b === btn));
        });
        applyFilter();
        live('任务筛选：' + btn.textContent.replace(/\d+$/, '').trim());
      });
    });

    var assignConfirm = $('[data-assign-confirm]');
    if (assignConfirm) {
      assignConfirm.addEventListener('click', function () {
        var checked = $('input[name="assignee"]:checked');
        var name = checked ? checked.value : '';
        if (pendingScope) {
          var slot = $('[data-assignee]', pendingScope);
          if (slot) slot.textContent = name;
          var title = $('.dj-task-title', pendingScope);
          var label = title ? title.textContent.replace(/\S+\s*$/, '').trim() : '任务';
          toast('已把任务指派给' + name + '。');
          live('已把任务指派给' + name);
        }
        closeDialog($('#dlg-assign'));
      });
    }

    syncCounts();
    applyFilter();
  }

  /* ---------- 06 作品墙：大图预览、赞 ---------- */

  function wireShowcase() {
    var preview = $('#dlg-preview');
    var tiles = $$('.dj-art');
    if (!preview || !tiles.length) return;
    var index = 0;

    function capText(tile) {
      var cap = $('.dj-art-cap > span:first-child', tile);
      if (!cap) return '';
      return cap.textContent.replace(/^\s*\d+\s*\/\s*/, '').trim();
    }

    function setArt(n) {
      index = ((n % tiles.length) + tiles.length) % tiles.length;
      var tile = tiles[index];
      var stage = $('[data-preview-stage]', preview);
      var svg = $('.dj-art-canvas svg', tile);
      if (stage && svg) {
        stage.innerHTML = '';
        stage.appendChild(svg.cloneNode(true));
      }
      setText('[data-preview-eyebrow]', 'Works / 0' + (index + 1) + ' of 0' + tiles.length, preview);
      setText('[data-preview-title]', '雾海信号塔 · ' + capText(tile), preview);
      setText('[data-preview-caption]', '3840 × 2160 │ 归档 2026.10.21 19:40 │ 白棠 │ 第 ' + (index + 1) + ' / ' + tiles.length + ' 张', preview);
      live('大图预览：第 ' + (index + 1) + ' 张，共 ' + tiles.length + ' 张。');
    }

    $$('[data-art]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setArt(parseInt(btn.getAttribute('data-art'), 10) || 0);
        openDialog(preview);
      });
    });

    $$('[data-preview-nav]', preview).forEach(function (btn) {
      btn.addEventListener('click', function () {
        setArt(index + parseInt(btn.getAttribute('data-preview-nav'), 10));
      });
    });

    doc.addEventListener('keydown', function (e) {
      if (!preview.open) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); setArt(index - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); setArt(index + 1); }
    });

    var liked = false;
    var base = 12;
    $$('[data-like]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        liked = !liked;
        $$('[data-like]').forEach(function (b) { b.setAttribute('aria-pressed', String(liked)); });
        $$('[data-like-label]').forEach(function (el) { el.textContent = '赞 ' + (base + (liked ? 1 : 0)); });
        $$('[data-like-count]').forEach(function (el) { el.textContent = String(base + (liked ? 1 : 0)); });
        var st = $('[data-like-state]');
        if (st) st.textContent = liked ? '你赞过这组作品。' : '你还没赞过这组作品。';
        toast(liked ? '已赞。' : '已取消赞。');
        live(liked ? '已赞。' : '已取消赞。');
      });
    });
  }

  /* ---------- 07 成员与邀请 ---------- */

  function wireMembers() {
    $$('[data-role-select]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var name = sel.getAttribute('data-member');
        var row = closest(sel, '.dj-memberrow');
        var role = row ? $('.dj-role', row) : null;
        if (role) role.textContent = sel.value;
        toast(name + ' 的角色已改为' + sel.value + '。');
        live(name + ' 的角色已改为' + sel.value);
      });
    });

    var genBtn = $('[data-invite-generate]');
    if (!genBtn) return;

    function seg(n) {
      var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      var out = '';
      for (var i = 0; i < n; i += 1) out += chars.charAt(Math.floor(Math.random() * chars.length));
      return out;
    }

    genBtn.addEventListener('click', function () {
      var block = $('[data-invite-new]');
      if (!block) return;
      var code = 'DJNG-' + seg(4) + '-' + seg(4);
      block.hidden = false;
      $$('[data-invite-code]', block).forEach(function (el) { el.textContent = code; });
      var role = $('input[name="invite-role"]:checked');
      var days = $('input[name="invite-days"]:checked');
      setText('[data-invite-meta]',
        (role && role.value === 'admin' ? '协议官' : '成员') + ' │ ' +
        (days ? days.value : '7') + ' 天有效 │ 1 次 │ 创建 2026.10.22', block);
      var note = $('#invite-note');
      if (note) note.value = '';
      toast('邀请码已生成，只显示这一次。');
      live('邀请码已生成：' + code);
      if (block.scrollIntoView) block.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
    });
  }

  /* ---------- 08 设置 ---------- */

  function wireSettings() {
    var dnd = $('[data-dnd]');
    var times = $$('[data-dnd-time]');

    function syncDnd() {
      times.forEach(function (t) { t.disabled = !(dnd && dnd.checked); });
      var sum = $('[data-sum-dnd]');
      if (sum) {
        sum.textContent = dnd && dnd.checked
          ? (times[0] ? times[0].value : '22:00') + ' 至 ' + (times[1] ? times[1].value : '08:00')
          : '已关闭';
      }
    }
    if (dnd) {
      dnd.addEventListener('change', function () {
        syncDnd();
        toast(dnd.checked ? '免打扰已开启。' : '免打扰已关闭。');
      });
      syncDnd();
    }
    times.forEach(function (t) { t.addEventListener('change', syncDnd); });

    $$('input[name="notify"]').forEach(function (r) {
      r.addEventListener('change', function () {
        var label = r.parentElement.textContent.trim();
        setText('[data-sum-notify]', label);
        live('通知级别已改为' + label);
      });
    });

    var save = $('[data-save-settings]');
    if (save) {
      save.addEventListener('click', function () {
        toast('设置已保存。');
        live('设置已保存。');
      });
    }

    var reset = $('[data-reset-settings]');
    if (reset) {
      reset.addEventListener('click', function () {
        var notify = $('input[name="notify"][value="all"]');
        if (notify) notify.checked = true;
        if (dnd) dnd.checked = true;
        if (times[0]) times[0].value = '22:00';
        if (times[1]) times[1].value = '08:00';
        syncDnd();
        setText('[data-sum-notify]', '全部');
        applyTheme('system', true);
        toast('已恢复默认设置。');
        live('已恢复默认设置。');
      });
    }
  }

  /* ---------- 小屏：把命令栏里当前分区滚进视野 ---------- */

  function scrollCurrentNav() {
    var cur = $('.dj-cmdbar nav a[aria-current]');
    if (!cur || !cur.scrollIntoView) return;
    if (cur.parentNode && cur.parentNode.scrollWidth > cur.parentNode.clientWidth + 4) {
      try { cur.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (e) {}
    }
  }

  /* ---------- 启动 ---------- */

  function init() {
    wireTheme();
    wireMotionState();
    wireDialogs();
    wireChat();
    wireArchiveFilters();
    wireUpload();
    wireMaterialDialog();
    wireBoard();
    wireVotes();
    wireTasks();
    wireShowcase();
    wireMembers();
    wireSettings();
    scrollCurrentNav();
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();
