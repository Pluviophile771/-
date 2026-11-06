/* ===========================================================
   反诈剧情模拟 · 网页版 —— 剧情引擎
   =========================================================== */
(function () {
  "use strict";

  var DATA = window.SCAM_SHIELD_DATA || { cases: [] };
  var CASES = DATA.cases || [];
  var SAVE_KEY = "scamshield.save.v1";

  /* ---------------- 存档 ---------------- */
  function emptySave() {
    return { version: 1, cases: {}, session: null };
  }

  function loadSave() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return emptySave();
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return emptySave();
      obj.cases = obj.cases || {};
      obj.session = obj.session || null;
      return obj;
    } catch (e) {
      return emptySave();
    }
  }

  function writeSave() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    } catch (e) { /* 隐私模式可能不可写，忽略 */ }
  }

  var save = loadSave();

  function progressOf(caseId) {
    if (!save.cases[caseId]) {
      save.cases[caseId] = { status: "new", endings: [], lastRecord: null };
    }
    var p = save.cases[caseId];
    p.endings = p.endings || [];
    return p;
  }

  /* ---------------- 运行态 ---------------- */
  var s = {
    caseObj: null,
    nodeId: null,
    risk: 0,
    decisions: 0,
    clues: 0,
    timer: null
  };

  /* ---------------- 小工具 ---------------- */
  function $(id) { return document.getElementById(id); }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function formatTime(ts) {
    if (!ts) return "—";
    var d = new Date(ts);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function ratingClass(rating) {
    if (rating === "安全") return "r-safe";
    if (rating === "警惕") return "r-warn";
    return "r-danger";
  }

  /* ---------------- 音效（WebAudio 合成，无需素材） ---------------- */
  var audioCtx = null;
  var soundOn = true;

  function tone(freq, start, dur, type, vol) {
    if (!soundOn) return;
    try {
      if (!audioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audioCtx = new AC();
      }
      var t0 = audioCtx.currentTime + start;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = type || "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol || 0.06, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    } catch (e) { /* 忽略音频错误 */ }
  }

  function sfx(type) {
    if (type === "tap") {
      tone(520, 0, 0.08, "triangle", 0.04);
    } else if (type === "choose") {
      tone(392, 0, 0.09, "triangle", 0.05);
      tone(523, 0.06, 0.1, "triangle", 0.045);
    } else if (type === "clue") {
      tone(660, 0, 0.1, "sine", 0.05);
      tone(880, 0.08, 0.14, "sine", 0.045);
    } else if (type === "safe") {
      tone(523, 0, 0.12, "sine", 0.06);
      tone(659, 0.1, 0.12, "sine", 0.055);
      tone(784, 0.2, 0.22, "sine", 0.05);
    } else if (type === "warn") {
      tone(440, 0, 0.14, "sine", 0.05);
      tone(392, 0.14, 0.18, "sine", 0.045);
    } else if (type === "danger") {
      tone(233, 0, 0.2, "sawtooth", 0.035);
      tone(196, 0.18, 0.28, "sawtooth", 0.03);
    }
  }

  /* ---------------- 屏幕切换 ---------------- */
  function showScreen(name) {
    var screens = document.querySelectorAll(".screen");
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.toggle("is-active", screens[i].id === "screen-" + name);
    }
    window.scrollTo(0, 0);
  }

  /* ---------------- 顶栏 / 底栏按钮 ---------------- */
  function initChrome() {
    $("btn-sound").addEventListener("click", function () {
      soundOn = !soundOn;
      this.textContent = soundOn ? "🔊" : "🔇";
      if (soundOn) sfx("tap");
    });

    $("btn-fullscreen").addEventListener("click", function () {
      var d = document;
      try {
        if (!d.fullscreenElement && !d.webkitFullscreenElement) {
          var el = d.documentElement;
          if (el.requestFullscreen) el.requestFullscreen();
          else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        } else {
          if (d.exitFullscreen) d.exitFullscreen();
          else if (d.webkitExitFullscreen) d.webkitExitFullscreen();
        }
      } catch (e) { /* 忽略 */ }
    });
  }

  /* ---------------- 首页 ---------------- */
  function renderHome() {
    var cleared = 0, endings = 0;
    CASES.forEach(function (c) {
      var p = save.cases[c.id];
      if (!p) return;
      if (p.status === "cleared") cleared++;
      endings += (p.endings || []).length;
    });

    $("home-stats").innerHTML =
      '<span><b>' + CASES.length + '</b>个案件</span>' +
      '<span><b>' + cleared + '</b>已通关</span>' +
      '<span><b>' + endings + '</b>个结局</span>';

    var hasSession = !!(save.session && save.session.caseId);
    $("btn-continue").hidden = !hasSession;
  }

  /* ---------------- 案件库 ---------------- */
  function statusOf(c) {
    var p = save.cases[c.id];
    if (p && p.status === "cleared") return "cleared";
    if (save.session && save.session.caseId === c.id) return "playing";
    return "new";
  }

  function renderLibrary() {
    var cleared = 0, endings = 0;
    CASES.forEach(function (c) {
      var p = save.cases[c.id];
      if (p && p.status === "cleared") cleared++;
      if (p) endings += (p.endings || []).length;
    });
    $("stat-cases").textContent = CASES.length;
    $("stat-cleared").textContent = cleared;
    $("stat-endings").textContent = endings;

    var grid = $("case-grid");
    grid.innerHTML = "";

    CASES.forEach(function (c) {
      var st = statusOf(c);
      var p = progressOf(c.id);
      var total = c.endingsTotal || 3;
      var dots = "";
      for (var i = 0; i < total; i++) {
        dots += '<span class="dot-end' + (i < p.endings.length ? " on" : "") + '"></span>';
      }

      var stText = st === "cleared" ? "已通关" : (st === "playing" ? "进行中" : "未开始");
      var stClass = st === "cleared" ? "st-cleared" : (st === "playing" ? "st-playing" : "");

      var card = document.createElement("button");
      card.className = "case-card" + (st === "cleared" ? " is-cleared" : "");
      card.type = "button";
      card.innerHTML =
        '<div class="case-icon">' + c.icon + '</div>' +
        '<div class="case-body">' +
          '<div class="case-top">' +
            '<span class="case-type">' + c.type + '</span>' +
            '<span class="case-status ' + stClass + '">' + stText + '</span>' +
          '</div>' +
          '<h3 class="case-title">' + c.title + '</h3>' +
          '<p class="case-desc">' + c.desc + '</p>' +
          '<div class="case-foot">' +
            '<span>结局 ' + p.endings.length + '/' + total + '</span>' +
            '<span class="dots">' + dots + '</span>' +
          '</div>' +
        '</div>';

      card.addEventListener("click", function () { openCase(c.id); });
      grid.appendChild(card);
    });
  }

  function openCase(id) {
    var c = null;
    for (var i = 0; i < CASES.length; i++) {
      if (CASES[i].id === id) { c = CASES[i]; break; }
    }
    if (!c) return;
    if (save.session && save.session.caseId === id) {
      resumeSession();
    } else {
      startCase(c);
    }
  }

  /* ---------------- 剧情运行 ---------------- */
  function stopTimer() {
    if (s.timer) {
      clearInterval(s.timer);
      s.timer = null;
    }
  }

  function persistSession() {
    if (!s.caseObj) return;
    save.session = {
      caseId: s.caseObj.id,
      nodeId: s.nodeId,
      risk: s.risk,
      decisions: s.decisions,
      clues: s.clues
    };
    writeSave();
  }

  function startCase(c) {
    stopTimer();
    s = {
      caseObj: c,
      nodeId: c.start,
      risk: 0,
      decisions: 0,
      clues: 0,
      timer: null
    };
    persistSession();
    $("play-case-title").textContent = c.title;
    showScreen("play");
    renderNode();
    sfx("tap");
  }

  function resumeSession() {
    var sess = save.session;
    if (!sess) return;
    var c = null;
    for (var i = 0; i < CASES.length; i++) {
      if (CASES[i].id === sess.caseId) { c = CASES[i]; break; }
    }
    if (!c) { save.session = null; writeSave(); return; }

    s = {
      caseObj: c,
      nodeId: (sess.nodeId && c.nodes[sess.nodeId]) ? sess.nodeId : c.start,
      risk: sess.risk || 0,
      decisions: sess.decisions || 0,
      clues: sess.clues || 0,
      timer: null
    };
    $("play-case-title").textContent = c.title;
    showScreen("play");
    renderNode();
  }

  function updateRisk() {
    var v = clamp(s.risk, 0, 100);
    var fill = $("risk-fill");
    fill.style.width = v + "%";
    fill.className = "risk-fill " + (v < 30 ? "lv-safe" : (v < 60 ? "lv-warn" : "lv-danger"));
    $("risk-value").textContent = v;
  }

  function renderNode() {
    var c = s.caseObj;
    if (!c) { showScreen("library"); return; }
    var node = c.nodes[s.nodeId];
    if (!node) { showScreen("library"); return; }

    updateRisk();

    var scene = $("scene");
    scene.innerHTML = "";
    scene.classList.remove("anim");
    void scene.offsetWidth;
    scene.classList.add("anim");

    if (node.type === "dialog") renderDialog(node, scene);
    else if (node.type === "choice") renderChoice(node, scene);
    else if (node.type === "clue") renderClue(node, scene);
    else if (node.type === "ending") { showEnding(node); return; }

    persistSession();
  }

  function goTo(id) {
    stopTimer();
    s.nodeId = id;
    renderNode();
  }

  function renderDialog(node, scene) {
    var wrap = document.createElement("div");
    wrap.className = "scene-dialog";
    wrap.innerHTML =
      '<div class="speaker-row"><span class="speaker-name">' + (node.speaker || "旁白") + '</span></div>' +
      '<div class="line-box"><p class="line-text">' + node.text + '</p></div>' +
      '<button class="btn btn-primary next-btn" type="button">继续 ▸</button>';

    var go = function () {
      sfx("tap");
      if (node.next) goTo(node.next);
    };
    wrap.querySelector(".next-btn").addEventListener("click", go);
    wrap.querySelector(".line-box").addEventListener("click", go);

    scene.appendChild(wrap);
  }

  function renderChoice(node, scene) {
    var wrap = document.createElement("div");
    wrap.className = "scene-choice";

    var head = document.createElement("p");
    head.className = "choice-prompt";
    head.textContent = node.prompt;
    wrap.appendChild(head);

    var list = document.createElement("div");
    list.className = "choice-list";

    var letters = "ABCDEFGH";
    node.options.forEach(function (opt, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "choice-btn";
      b.innerHTML =
        '<span class="choice-index">' + letters.charAt(i) + '</span>' +
        '<span class="choice-text">' + opt.text + '</span>' +
        (opt.tag ? '<span class="choice-tag tag-' + (opt.tone || "neutral") + '">' + opt.tag + '</span>' : '');
      b.addEventListener("click", function () { choose(node, opt); });
      list.appendChild(b);
    });
    wrap.appendChild(list);

    scene.appendChild(wrap);

    if (node.timeLimit) {
      var bar = document.createElement("div");
      bar.className = "timer-bar";
      bar.innerHTML = '<div class="timer-fill"></div><span class="timer-text"></span>';
      wrap.appendChild(bar);
      startTimer(node, bar, wrap);
    }
  }

  function startTimer(node, bar, wrap) {
    stopTimer();
    var total = node.timeLimit * 1000;
    var remain = total;
    var fill = bar.querySelector(".timer-fill");
    var text = bar.querySelector(".timer-text");

    var tick = function () {
      remain -= 100;
      var pct = Math.max(0, remain / total) * 100;
      fill.style.width = pct + "%";
      text.textContent = Math.ceil(Math.max(0, remain) / 1000) + "s";

      if (remain <= 0) {
        stopTimer();
        var btns = wrap.querySelectorAll(".choice-btn");
        for (var i = 0; i < btns.length; i++) btns[i].disabled = true;
        text.textContent = "已超时";

        if (node.timeoutNext) {
          s.risk = clamp(s.risk + (node.timeoutRisk || 10), 0, 100);
          sfx("warn");
          goTo(node.timeoutNext);
        } else if (node.options.length) {
          choose(node, node.options[node.options.length - 1]);
        }
      }
    };

    s.timer = setInterval(tick, 100);
    tick();
  }

  function choose(node, opt) {
    stopTimer();
    s.decisions++;
    s.risk = clamp(s.risk + (opt.risk || 0), 0, 100);
    sfx("choose");
    goTo(opt.next);
  }

  function renderClue(node, scene) {
    var wrap = document.createElement("div");
    wrap.className = "scene-clue";
    wrap.innerHTML =
      '<div class="clue-head">' +
        '<span class="clue-badge">线索核验</span>' +
        '<span class="clue-hint">推进前，先核实关键信息</span>' +
      '</div>' +
      '<p class="clue-action">' + node.action + '</p>' +
      '<button class="btn btn-primary clue-btn" type="button">开始核实</button>' +
      '<div class="clue-result" hidden>' +
        '<p class="clue-text">' + node.clue + '</p>' +
        '<p class="clue-ok">' + node.ok + '</p>' +
        '<button class="btn btn-primary clue-next" type="button">继续剧情 ▸</button>' +
      '</div>';

    var verifyBtn = wrap.querySelector(".clue-btn");
    verifyBtn.addEventListener("click", function () {
      s.clues++;
      sfx("clue");
      verifyBtn.style.display = "none";
      wrap.querySelector(".clue-result").hidden = false;
      persistSession();
    });

    wrap.querySelector(".clue-next").addEventListener("click", function () {
      sfx("tap");
      goTo(node.next);
    });

    scene.appendChild(wrap);
  }

  /* ---------------- 结局 ---------------- */
  function showEnding(node) {
    stopTimer();
    var c = s.caseObj;
    var p = progressOf(c.id);

    p.status = "cleared";
    if (p.endings.indexOf(s.nodeId) === -1) p.endings.push(s.nodeId);
    p.lastRecord = {
      endingId: s.nodeId,
      title: node.title,
      rating: node.rating,
      risk: clamp(s.risk, 0, 100),
      decisions: s.decisions,
      clues: s.clues,
      at: Date.now()
    };
    save.session = null;
    writeSave();

    var rating = node.rating || "安全";

    var badge = $("ending-badge");
    badge.textContent = rating;
    badge.className = "ending-badge " + ratingClass(rating);

    $("ending-title").textContent = node.title;
    $("ending-desc").textContent = node.desc;

    var total = c.endingsTotal || 3;
    $("ending-stats").innerHTML =
      '<div class="stat-cell"><b>' + clamp(s.risk, 0, 100) + '</b><span>风险指数</span></div>' +
      '<div class="stat-cell"><b>' + s.decisions + '</b><span>关键决策</span></div>' +
      '<div class="stat-cell"><b>' + s.clues + '</b><span>线索核验</span></div>' +
      '<div class="stat-cell"><b>' + p.endings.length + '/' + total + '</b><span>结局收集</span></div>';

    var ul = $("ending-advice");
    ul.innerHTML = "";
    (node.advice || []).forEach(function (t) {
      var li = document.createElement("li");
      li.textContent = t;
      ul.appendChild(li);
    });

    if (rating === "安全") sfx("safe");
    else if (rating === "警惕") sfx("warn");
    else sfx("danger");

    showScreen("ending");
  }

  /* ---------------- 记录回看 ---------------- */
  function openRecords() {
    var body = $("records-body");
    var cleared = CASES.filter(function (c) {
      var p = save.cases[c.id];
      return p && p.status === "cleared" && p.lastRecord;
    });

    if (!cleared.length) {
      body.innerHTML = '<p class="records-empty">还没有通关记录，先去推演一个案件吧。</p>';
    } else {
      body.innerHTML = cleared.map(function (c) {
        var r = save.cases[c.id].lastRecord;
        return '<div class="record-item">' +
          '<div class="record-main">' +
            '<h4>' + c.title + '</h4>' +
            '<span class="record-rating ' + ratingClass(r.rating) + '">' + r.rating + '</span>' +
          '</div>' +
          '<p class="record-line">结局：' + r.title + '</p>' +
          '<p class="record-meta">线索核验 ' + r.clues + ' 项 · 关键决策 ' + r.decisions +
            ' 次 · 风险指数 ' + r.risk + ' · ' + formatTime(r.at) + '</p>' +
        '</div>';
      }).join("");
    }

    $("modal-records").hidden = false;
  }

  function closeRecords() {
    $("modal-records").hidden = true;
  }

  function clearRecords() {
    if (!window.confirm("确定要清除全部进度、通关记录与结局收集吗？此操作不可撤销。")) return;
    save = emptySave();
    writeSave();
    closeRecords();
    renderHome();
    renderLibrary();
    showScreen("library");
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    $("btn-start").addEventListener("click", function () {
      sfx("tap");
      renderLibrary();
      showScreen("library");
    });

    $("btn-continue").addEventListener("click", function () {
      sfx("tap");
      resumeSession();
    });

    $("btn-back-home").addEventListener("click", function () {
      renderHome();
      showScreen("home");
    });

    $("btn-records").addEventListener("click", function () {
      sfx("tap");
      openRecords();
    });

    $("btn-modal-close").addEventListener("click", function () {
      closeRecords();
    });

    $("modal-records").addEventListener("click", function (e) {
      if (e.target === this) closeRecords();
    });

    $("btn-clear-records").addEventListener("click", clearRecords);

    $("btn-quit-play").addEventListener("click", function () {
      stopTimer();
      renderLibrary();
      showScreen("library");
    });

    $("btn-ending-library").addEventListener("click", function () {
      renderLibrary();
      showScreen("library");
    });

    $("btn-ending-retry").addEventListener("click", function () {
      if (s.caseObj) startCase(s.caseObj);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var play = $("screen-play");
      if (!play.classList.contains("is-active")) return;
      var btn = play.querySelector(".next-btn");
      if (btn && !btn.disabled) {
        e.preventDefault();
        btn.click();
      }
    });
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    initChrome();
    bind();
    renderHome();
    renderLibrary();

    if (save.session && save.session.caseId) {
      // 有未完成的存档，首页显示「继续」
    }
    // 默认停留在首页
    showScreen("home");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
