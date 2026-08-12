(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const STORAGE_KEY = "midnight-arcade-state-v1";
  const MAX_CREDIT = 9999999;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const PACHI_THEME_KEYS = Object.freeze(["sakura", "cyber", "mecha", "gothic"]);
  const DEFAULT_PACHI_THEME = "sakura";
  const normalizePachiTheme = (value, fallback = DEFAULT_PACHI_THEME) => PACHI_THEME_KEYS.includes(value) ? value : fallback;

  const defaultState = () => ({
    balance: 2500,
    totalPlays: 0,
    bestWin: 0,
    sound: false,
    fever: 0,
    pachiTheme: DEFAULT_PACHI_THEME,
    pachiPrealert: true,
    pachiFast: false,
    pachiRush: 0,
    pachiTotalPay: 0,
    pachiHitCount: 0,
    pachiPending: [],
    rouletteHistory: []
  });

  const safeInteger = (value, fallback, min = 0, max = MAX_CREDIT) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
  };

  function loadState() {
    const fallback = defaultState();
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved || typeof saved !== "object") return fallback;
      const savedPachiTheme = normalizePachiTheme(saved.pachiTheme);
      return {
        balance: safeInteger(saved.balance, fallback.balance),
        totalPlays: safeInteger(saved.totalPlays, 0, 0, 10000000),
        bestWin: safeInteger(saved.bestWin, 0),
        sound: saved.sound === true,
        fever: safeInteger(saved.fever, 0, 0, 5),
        pachiTheme: savedPachiTheme,
        pachiPrealert: saved.pachiPrealert !== false,
        pachiFast: saved.pachiFast === true,
        pachiRush: safeInteger(saved.pachiRush, 0, 0, 30),
        pachiTotalPay: safeInteger(saved.pachiTotalPay, 0),
        pachiHitCount: safeInteger(saved.pachiHitCount, 0, 0, 10000000),
        pachiPending: Array.isArray(saved.pachiPending)
          ? saved.pachiPending.filter((item) => item && typeof item === "object" && typeof item.id === "string")
            .slice(0, 5)
            .map((item) => ({
              id: item.id.slice(0, 80),
              theme: normalizePachiTheme(item.theme, savedPachiTheme),
              bet: [10, 25, 50, 100].includes(item.bet) ? item.bet : 10,
              mode: item.mode === "rush" ? "rush" : "normal",
              hit: item.hit === true,
              prealert: item.prealert === true,
              alerted: true,
              effect: ["instant", "normal", "sakura", "yozakura", "gold", "rainbow"].includes(item.effect) ? item.effect : "instant",
              rounds: item.rounds === 10 ? 10 : item.rounds === 4 ? 4 : 0,
              rushEntry: item.rushEntry === true,
              digits: Array.isArray(item.digits) && item.digits.length === 3
                ? item.digits.map((digit) => safeInteger(digit, 1, 1, 9))
                : [1, 2, 3],
              readyAt: 0,
              rushConsumed: item.rushConsumed === true
            }))
          : [],
        rouletteHistory: Array.isArray(saved.rouletteHistory)
          ? saved.rouletteHistory.filter((number) => Number.isInteger(number) && number >= 0 && number <= 36).slice(0, 7)
          : []
      };
    } catch {
      return fallback;
    }
  }

  const state = loadState();
  const activeRounds = new Map();

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // The game remains playable when storage is unavailable.
    }
  }

  const formatCredit = (value) => new Intl.NumberFormat("ja-JP").format(value);

  function updateDashboard() {
    $$('[data-balance]').forEach((element) => {
      element.textContent = formatCredit(state.balance);
    });
    $$('[data-total-plays]').forEach((element) => {
      element.textContent = formatCredit(state.totalPlays);
    });
    $$('[data-best-win]').forEach((element) => {
      element.textContent = formatCredit(state.bestWin);
    });

    const soundButton = $("#sound-toggle");
    soundButton.setAttribute("aria-pressed", String(state.sound));
    soundButton.setAttribute("aria-label", state.sound ? "サウンドをオフにする" : "サウンドをオンにする");

    const feverFill = $("#fever-fill");
    const feverLabel = $("#fever-label");
    const feverMeter = $(".fever-meter");
    if (feverFill && feverLabel && feverMeter) {
      feverFill.style.width = `${state.fever * 20}%`;
      feverLabel.textContent = `${state.fever} / 5`;
      feverMeter.setAttribute("aria-valuenow", String(state.fever));
    }
  }

  function setMessage(element, text, isWin = false) {
    element.textContent = text;
    element.classList.toggle("is-win", isWin);
  }

  function showToast(message, isError = false) {
    const toast = document.createElement("div");
    toast.className = `toast${isError ? " is-error" : ""}`;
    toast.textContent = message;
    $("#toast-region").append(toast);
    window.setTimeout(() => toast.remove(), reducedMotion.matches ? 1200 : 2800);
  }

  function randomInt(max) {
    if (!Number.isSafeInteger(max) || max <= 0) return 0;
    if (window.crypto?.getRandomValues) {
      const range = 0x100000000;
      const limit = range - (range % max);
      const buffer = new Uint32Array(1);
      do {
        window.crypto.getRandomValues(buffer);
      } while (buffer[0] >= limit);
      return buffer[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  function weightedChoice(items, getWeight = (item) => item.weight) {
    const total = items.reduce((sum, item) => sum + getWeight(item), 0);
    let ticket = randomInt(total);
    for (const item of items) {
      ticket -= getWeight(item);
      if (ticket < 0) return item;
    }
    return items[items.length - 1];
  }

  const wait = (milliseconds) => new Promise((resolve) => {
    window.setTimeout(resolve, reducedMotion.matches ? Math.min(milliseconds, 35) : milliseconds);
  });

  function beginRound(game, bet) {
    if (activeRounds.has(game)) return null;
    if (!Number.isSafeInteger(bet) || bet <= 0) {
      showToast("賭け金を選び直してください。", true);
      return null;
    }
    if (state.balance < bet) {
      showToast("クレジットが足りません。右上の＋から無料で補充できます。", true);
      return null;
    }

    const round = { game, bet, settled: false, token: Symbol(game) };
    activeRounds.set(game, round);
    state.balance -= bet;
    saveState();
    updateDashboard();
    return round;
  }

  function addStake(game, amount) {
    const round = activeRounds.get(game);
    if (!round || round.settled || !Number.isSafeInteger(amount) || amount <= 0 || state.balance < amount) return false;
    state.balance -= amount;
    round.bet += amount;
    saveState();
    updateDashboard();
    return true;
  }

  function settleRound(game, payout) {
    const round = activeRounds.get(game);
    if (!round || round.settled) return null;
    const safePayout = safeInteger(Math.round(payout), 0);
    round.settled = true;
    state.balance = Math.min(MAX_CREDIT, state.balance + safePayout);
    state.totalPlays += 1;
    state.bestWin = Math.max(state.bestWin, Math.max(0, safePayout - round.bet));
    activeRounds.delete(game);
    saveState();
    updateDashboard();
    return { bet: round.bet, payout: safePayout, net: safePayout - round.bet };
  }

  function cancelRound(game) {
    const round = activeRounds.get(game);
    if (!round || round.settled) return;
    state.balance = Math.min(MAX_CREDIT, state.balance + round.bet);
    activeRounds.delete(game);
    saveState();
    updateDashboard();
  }

  function setupBetGroup(selector, dataKey, displaySelector, initialValue, game) {
    const buttons = $$(selector);
    let value = initialValue;

    const select = (button) => {
      value = Number(button.dataset[dataKey]);
      buttons.forEach((candidate) => {
        const selected = candidate === button;
        candidate.classList.toggle("is-selected", selected);
        candidate.setAttribute("aria-pressed", String(selected));
      });
      $(displaySelector).textContent = formatCredit(value);
    };

    buttons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.classList.contains("is-selected")));
      button.addEventListener("click", () => {
        if (!activeRounds.has(game)) select(button);
      });
    });

    return {
      get value() { return value; },
      setDisabled(disabled) { buttons.forEach((button) => { button.disabled = disabled; }); }
    };
  }

  /* Sound is generated locally and never auto-plays. */
  const sound = {
    context: null,
    ensureContext() {
      if (!state.sound) return null;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      try {
        this.context ||= new AudioContext();
        if (this.context.state === "suspended") this.context.resume().catch(() => {});
      } catch {
        this.context = null;
      }
      return this.context;
    },
    async toggle() {
      state.sound = !state.sound;
      if (state.sound) {
        const context = this.ensureContext();
        if (context?.state === "suspended") await context.resume().catch(() => {});
        this.play("select");
      }
      saveState();
      updateDashboard();
      showToast(state.sound ? "サウンド ON" : "サウンド OFF");
    },
    tone(frequency, duration = 0.08, offset = 0, volume = 0.035) {
      if (!state.sound || !this.context) return;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const start = this.context.currentTime + offset;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(volume, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain).connect(this.context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration);
    },
    play(type) {
      if (!state.sound || !this.ensureContext()) return;
      const patterns = {
        select: [[480, 0.06, 0]],
        start: [[180, 0.09, 0], [240, 0.09, 0.08]],
        stop: [[380, 0.07, 0]],
        win: [[523, 0.1, 0], [659, 0.1, 0.1], [784, 0.18, 0.2]],
        lose: [[210, 0.12, 0], [150, 0.18, 0.1]],
        card: [[320, 0.055, 0]],
        jackpot: [[523, 0.12, 0], [659, 0.12, 0.1], [784, 0.12, 0.2], [1046, 0.3, 0.31]],
        pachiLaunch: [[240, 0.04, 0], [380, 0.045, 0.05]],
        pachiStart: [[660, 0.06, 0], [880, 0.08, 0.06]],
        prealert: [[180, 0.08, 0, 0.055], [880, 0.12, 0.05, 0.05], [220, 0.12, 0.14, 0.055], [980, 0.22, 0.2, 0.045]],
        reach: [[392, 0.1, 0], [523, 0.1, 0.1], [659, 0.18, 0.2]],
        impact: [[110, 0.18, 0, 0.065], [880, 0.22, 0.06, 0.04]],
        rush: [[392, 0.09, 0], [523, 0.09, 0.08], [659, 0.09, 0.16], [784, 0.24, 0.24]]
      };
      (patterns[type] || patterns.select).forEach(([frequency, duration, offset, volume]) => this.tone(frequency, duration, offset, volume));
    }
  };

  $("#sound-toggle").addEventListener("click", () => sound.toggle());

  /* Navigation and guides */
  const screenNames = new Set(["lobby", "slots", "roulette", "blackjack", "pachinko"]);
  const titles = {
    lobby: "MIDNIGHT ARCADE — Casino & Pachinko",
    slots: "HANABI 3 — MIDNIGHT ARCADE",
    roulette: "ROUGE 37 — MIDNIGHT ARCADE",
    blackjack: "BLACK 21 — MIDNIGHT ARCADE",
    pachinko: "PACHINKO MULTIVERSE — MIDNIGHT ARCADE"
  };

  function showScreen(requested, writeHash = true) {
    const name = screenNames.has(requested) ? requested : "lobby";
    $$('[data-screen]').forEach((screen) => {
      const active = screen.dataset.screen === name;
      screen.hidden = !active;
      screen.classList.toggle("is-active", active);
    });
    $$('.nav-item').forEach((button) => {
      const active = button.dataset.openGame === name;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    document.title = name === "pachinko" ? `${getPachiTheme().name} — MIDNIGHT ARCADE` : titles[name];
    if (writeHash && location.hash !== `#${name}`) history.pushState({ screen: name }, "", `#${name}`);
    window.scrollTo({ top: 0, behavior: reducedMotion.matches ? "auto" : "smooth" });
    if (name !== "lobby") {
      window.setTimeout(() => $(`#screen-${name} h1`)?.focus({ preventScroll: true }), reducedMotion.matches ? 0 : 260);
    }
    window.dispatchEvent(new CustomEvent("midnight-screen-change", { detail: name }));
  }

  $$('[data-open-game]').forEach((control) => {
    control.addEventListener("click", (event) => {
      event.preventDefault();
      showScreen(control.dataset.openGame);
    });
  });

  window.addEventListener("popstate", () => showScreen(location.hash.slice(1) || "lobby", false));
  $('[data-scroll-games]').addEventListener("click", () => {
    $("#game-selection").scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" });
  });

  const guides = {
    lobby: {
      title: "はじめての方へ",
      intro: "MIDNIGHT ARCADEは、4種類のゲームをひとつの仮想クレジットで遊べる無料ゲーム集です。",
      items: [
        "最初に <strong>2,500 CR</strong> を用意しています。現金価値はなく、課金もありません。",
        "残高は自動保存されます。足りなくなったら右上の <strong>＋</strong> から無料で補充できます。",
        "各ゲームの「遊び方」から、ルールと配当をいつでも確認できます。",
        "音は初期状態でOFFです。右上のスピーカーボタンから切り替えられます。"
      ]
    },
    slots: {
      title: "HANABI 3",
      intro: "3つのリールを回し、中央の赤いラインに同じ図柄をそろえる和風スロットです。",
      items: [
        "賭け金を選び、<strong>SPIN</strong> を押します。",
        "回転中は3つの <strong>STOP</strong> ボタンで好きな順にリールを止められます。押さなくても自動停止します。",
        "七は賭け金の20倍、宝は12倍、BARは8倍、桜は4倍。桜が2つなら2倍です。",
        "同じ図柄が2つ並ぶとリプレイとなり、賭け金が戻ります。"
      ]
    },
    roulette: {
      title: "ROUGE 37",
      intro: "0〜36を使う、シングルゼロ方式のヨーロピアンルーレットです。",
      items: [
        "RED / BLACK、ODD / EVEN、1–18 / 19–36は、当たると賭け金を含めて<strong>2倍</strong>戻ります。",
        "NUMBERを選ぶと、0〜36の好きな数字1つに賭けられます。当たると<strong>36倍</strong>です。",
        "0は緑です。赤黒・奇数偶数・範囲ベットでは外れになります。",
        "結果はホイール下に直近7回まで保存されます。"
      ]
    },
    blackjack: {
      title: "BLACK 21",
      intro: "カードの合計を21に近づけ、ディーラーより強い手を作るクラシックゲームです。",
      items: [
        "絵札は10、Aは1または11として数えます。21を超えるとバーストで負けです。",
        "<strong>HIT</strong>で1枚引き、<strong>STAND</strong>で止めます。ディーラーは17以上で止まります。",
        "最初の2枚で21になるブラックジャックは<strong>3:2</strong>配当です。引き分けでは賭け金が戻ります。",
        "最初の2枚だけDOUBLEを選べます。賭け金を倍にし、1枚だけ引いて自動で勝負します。"
      ]
    },
    pachinko: {
      title: "PACHINKO MULTIVERSE",
      intro: "4つの世界観から機種を選び、先バレ、保留、リーチ、大当たり、ST型RUSHを楽しめるデジタルパチンコです。",
      items: [
        "桜幻想、電脳侵入、宇宙メカ、ゴシックホラーの4機種から選べます。抽選確率と配当は全機種共通です。",
        "レートを選び、<strong>SHOOT</strong>で玉を打ち出します。START入賞率は45%、保留は最大4個です。",
        "通常時の大当たりはSTART入賞ごとに<strong>約1/39.9</strong>。先バレON時は入賞した瞬間にランプと音で期待度約40%を告知します。",
        "桜舞SP、夜桜SP、金襖、全回転などへ発展。大当たりは<strong>4Rまたは10R</strong>です。",
        "初当たりの55%で<strong>宵桜RUSH</strong>へ。30回転のST中は約1/24.9、先バレ期待度は約70%になります。",
        "先バレOFFは演出だけを止め、抽選確率には影響しません。演出速度やオート発射も切り替えられます。"
      ]
    }
  };

  const rulesDialog = $("#rules-dialog");
  $$('[data-open-rules]').forEach((button) => {
    button.addEventListener("click", () => {
      const guide = button.dataset.openRules === "pachinko" ? getPachinkoGuide() : guides[button.dataset.openRules] || guides.lobby;
      $("#rules-content").innerHTML = `
        <h2 id="rules-title">${guide.title}</h2>
        <p>${guide.intro}</p>
        <ol>${guide.items.map((item) => `<li>${item}</li>`).join("")}</ol>
      `;
      if (typeof rulesDialog.showModal === "function") rulesDialog.showModal();
      else rulesDialog.setAttribute("open", "");
    });
  });
  $("#rules-close").addEventListener("click", () => rulesDialog.close());
  rulesDialog.addEventListener("click", (event) => {
    if (event.target === rulesDialog) rulesDialog.close();
  });

  $("#wallet-button").addEventListener("click", () => {
    state.balance = Math.min(MAX_CREDIT, state.balance + 1000);
    saveState();
    updateDashboard();
    sound.play("win");
    showToast("練習クレジットを 1,000 CR 補充しました。 ");
  });

  $("#reset-progress").addEventListener("click", () => {
    if (!window.confirm("クレジットとプレイ記録を初期状態に戻しますか？")) return;
    window.dispatchEvent(new Event("midnight-reset"));
    Object.assign(state, defaultState());
    saveState();
    updateDashboard();
    renderRouletteHistory();
    showToast("進行状況をリセットしました。 ");
  });

  /* HANABI 3 */
  const SLOT_SYMBOLS = [
    { key: "sakura", label: "桜", className: "symbol-sakura", weight: 30 },
    { key: "bell", label: "鈴", className: "symbol-bell", weight: 24 },
    { key: "bar", label: "BAR", className: "symbol-bar", weight: 19 },
    { key: "treasure", label: "宝", className: "symbol-treasure", weight: 16 },
    { key: "seven", label: "七", className: "symbol-seven", weight: 11 }
  ];
  const slotReels = $$('.reel');
  const slotStopButtons = [$("#slot-stop-0"), $("#slot-stop-1"), $("#slot-stop-2")];
  const slotBet = setupBetGroup('[data-slot-bet]', "slotBet", "#slot-bet-display", 25, "slots");
  let currentSlotSpin = null;

  function setReelSymbol(reel, symbol) {
    const element = $(".reel-symbol", reel);
    element.className = `reel-symbol ${symbol.className}`;
    element.textContent = symbol.label;
  }

  function stopSlotReel(index) {
    const spin = currentSlotSpin;
    if (!spin || spin.stopped[index]) return;
    spin.stopped[index] = true;
    window.clearInterval(spin.intervals[index]);
    window.clearTimeout(spin.autoStops[index]);
    slotReels[index].classList.remove("is-spinning");
    setReelSymbol(slotReels[index], spin.targets[index]);
    slotStopButtons[index].disabled = true;
    sound.play("stop");
    if (spin.stopped.every(Boolean)) spin.resolve();
  }

  slotStopButtons.forEach((button, index) => button.addEventListener("click", () => stopSlotReel(index)));

  function slotMultiplier(symbols) {
    const keys = symbols.map((symbol) => symbol.key);
    if (keys.every((key) => key === "seven")) return 20;
    if (keys.every((key) => key === "treasure")) return 12;
    if (keys.every((key) => key === "bar")) return 8;
    if (keys.every((key) => key === "bell")) return 5;
    if (keys.every((key) => key === "sakura")) return 4;
    if (keys.filter((key) => key === "sakura").length >= 2) return 2;
    if (new Set(keys).size < 3) return 1;
    return 0;
  }

  async function spinSlots() {
    const round = beginRound("slots", slotBet.value);
    if (!round) return;
    const spinButton = $("#slot-spin");
    const message = $("#slot-message");
    spinButton.disabled = true;
    slotBet.setDisabled(true);
    setMessage(message, "リール回転中。STOPボタンで止めよう。 ");
    sound.play("start");

    try {
      const targets = Array.from({ length: 3 }, () => weightedChoice(SLOT_SYMBOLS));
      let resolveSpin;
      const finished = new Promise((resolve) => { resolveSpin = resolve; });
      currentSlotSpin = {
        round,
        targets,
        stopped: [false, false, false],
        intervals: [],
        autoStops: [],
        resolve: resolveSpin
      };

      slotReels.forEach((reel, index) => {
        reel.classList.add("is-spinning");
        slotStopButtons[index].disabled = false;
        if (!reducedMotion.matches) {
          currentSlotSpin.intervals[index] = window.setInterval(() => {
            setReelSymbol(reel, SLOT_SYMBOLS[randomInt(SLOT_SYMBOLS.length)]);
          }, 80 + index * 12);
          currentSlotSpin.autoStops[index] = window.setTimeout(() => stopSlotReel(index), 2400 + index * 420);
        }
      });

      if (reducedMotion.matches) slotReels.forEach((_, index) => stopSlotReel(index));
      await finished;

      const multiplier = slotMultiplier(targets);
      const result = settleRound("slots", round.bet * multiplier);
      const labels = targets.map((symbol) => symbol.label).join("・");
      if (result.payout > 0) {
        const detail = result.net > 0 ? `+${formatCredit(result.net)} CR` : `${formatCredit(result.payout)} CR リプレイ`;
        setMessage(message, `${labels} — WIN ${detail}`, true);
        sound.play(multiplier >= 12 ? "jackpot" : "win");
      } else {
        setMessage(message, `${labels} — 次のスピンへ。`);
        sound.play("lose");
      }
    } catch {
      cancelRound("slots");
      setMessage(message, "回転を完了できませんでした。賭け金は返却されました。 ");
      showToast("スロットを再開してください。", true);
    } finally {
      if (currentSlotSpin) {
        currentSlotSpin.intervals.forEach((timer) => window.clearInterval(timer));
        currentSlotSpin.autoStops.forEach((timer) => window.clearTimeout(timer));
      }
      currentSlotSpin = null;
      slotReels.forEach((reel) => reel.classList.remove("is-spinning"));
      slotStopButtons.forEach((button) => { button.disabled = true; });
      slotBet.setDisabled(false);
      spinButton.disabled = false;
    }
  }

  $("#slot-spin").addEventListener("click", spinSlots);

  /* ROUGE 37 */
  const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const rouletteStake = setupBetGroup('[data-roulette-stake]', "rouletteStake", "#roulette-stake-display", 25, "roulette");
  const rouletteBetButtons = $$('[data-roulette-bet]');
  const rouletteNumber = $("#roulette-number");
  let selectedRouletteBet = "red";
  let rouletteRotation = 0;

  for (let number = 0; number <= 36; number += 1) {
    const option = document.createElement("option");
    option.value = String(number);
    option.textContent = String(number);
    rouletteNumber.append(option);
  }

  const rouletteLabels = { red: "RED", black: "BLACK", odd: "ODD", even: "EVEN", low: "1–18", high: "19–36", number: "NUMBER" };

  function updateRouletteBetLabel() {
    $("#roulette-bet-label").textContent = selectedRouletteBet === "number"
      ? `NUMBER ${rouletteNumber.value}`
      : rouletteLabels[selectedRouletteBet];
  }

  rouletteBetButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.classList.contains("is-selected")));
    button.addEventListener("click", () => {
      if (activeRounds.has("roulette")) return;
      selectedRouletteBet = button.dataset.rouletteBet;
      rouletteBetButtons.forEach((candidate) => {
        const selected = candidate === button;
        candidate.classList.toggle("is-selected", selected);
        candidate.setAttribute("aria-pressed", String(selected));
      });
      $("#roulette-number-wrap").hidden = selectedRouletteBet !== "number";
      updateRouletteBetLabel();
      sound.play("select");
    });
  });
  rouletteNumber.addEventListener("change", updateRouletteBetLabel);

  function rouletteColor(number) {
    if (number === 0) return "green";
    return RED_NUMBERS.has(number) ? "red" : "black";
  }

  function rouletteWins(bet, number, pickedNumber) {
    if (bet === "number") return number === pickedNumber;
    if (number === 0) return false;
    if (bet === "red" || bet === "black") return rouletteColor(number) === bet;
    if (bet === "odd") return number % 2 === 1;
    if (bet === "even") return number % 2 === 0;
    if (bet === "low") return number >= 1 && number <= 18;
    if (bet === "high") return number >= 19 && number <= 36;
    return false;
  }

  function renderRouletteHistory() {
    const list = $("#roulette-history");
    list.replaceChildren();
    state.rouletteHistory.forEach((number) => {
      const item = document.createElement("li");
      item.className = `is-${rouletteColor(number)}`;
      item.textContent = String(number);
      item.setAttribute("aria-label", `${number} ${rouletteColor(number) === "red" ? "赤" : rouletteColor(number) === "black" ? "黒" : "緑"}`);
      list.append(item);
    });
  }

  function setRouletteDisabled(disabled) {
    rouletteBetButtons.forEach((button) => { button.disabled = disabled; });
    rouletteStake.setDisabled(disabled);
    rouletteNumber.disabled = disabled;
    $("#roulette-spin").disabled = disabled;
  }

  async function spinRoulette() {
    const round = beginRound("roulette", rouletteStake.value);
    if (!round) return;
    const message = $("#roulette-message");
    const resultElement = $("#roulette-result");
    const pickedNumber = Number(rouletteNumber.value);
    setRouletteDisabled(true);
    setMessage(message, "Rien ne va plus — ベットを締め切りました。 ");
    resultElement.textContent = "·";
    resultElement.className = "roulette-result";
    sound.play("start");

    try {
      const number = randomInt(37);
      const index = WHEEL_ORDER.indexOf(number);
      rouletteRotation += 1440 + (37 - index) * (360 / 37);
      $(".roulette-track").style.transform = `rotate(${rouletteRotation}deg)`;
      await wait(2900);

      const color = rouletteColor(number);
      resultElement.textContent = String(number);
      resultElement.className = `roulette-result is-${color}`;
      const won = rouletteWins(selectedRouletteBet, number, pickedNumber);
      const multiplier = selectedRouletteBet === "number" ? 36 : 2;
      const result = settleRound("roulette", won ? round.bet * multiplier : 0);
      const colorJa = color === "red" ? "赤" : color === "black" ? "黒" : "緑";

      state.rouletteHistory.unshift(number);
      state.rouletteHistory = state.rouletteHistory.slice(0, 7);
      saveState();
      renderRouletteHistory();

      if (won) {
        setMessage(message, `結果 ${number}（${colorJa}）— WIN +${formatCredit(result.net)} CR`, true);
        sound.play(multiplier === 36 ? "jackpot" : "win");
      } else {
        setMessage(message, `結果 ${number}（${colorJa}）— 次のベットへ。`);
        sound.play("lose");
      }
    } catch {
      cancelRound("roulette");
      setMessage(message, "ホイールを完了できませんでした。賭け金は返却されました。 ");
      showToast("ルーレットを再開してください。", true);
    } finally {
      setRouletteDisabled(false);
    }
  }

  $("#roulette-spin").addEventListener("click", spinRoulette);

  /* BLACK 21 */
  const blackjackBet = setupBetGroup('[data-blackjack-bet]', "blackjackBet", "#blackjack-bet-display", 50, "blackjack");
  const blackjackBetButtons = $$('[data-blackjack-bet]');
  const suits = [
    { symbol: "♠", name: "スペード", red: false },
    { symbol: "♥", name: "ハート", red: true },
    { symbol: "♦", name: "ダイヤ", red: true },
    { symbol: "♣", name: "クラブ", red: false }
  ];
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  let deck = [];
  let playerHand = [];
  let dealerHand = [];
  let dealerRevealed = false;
  let blackjackPhase = "idle";

  function createDeck() {
    const cards = [];
    for (const suit of suits) {
      for (const rank of ranks) cards.push({ rank, suit });
    }
    for (let index = cards.length - 1; index > 0; index -= 1) {
      const swapIndex = randomInt(index + 1);
      [cards[index], cards[swapIndex]] = [cards[swapIndex], cards[index]];
    }
    return cards;
  }

  function drawCard() {
    if (deck.length < 12) deck = createDeck();
    return deck.pop();
  }

  function scoreHand(cards) {
    let total = 0;
    let aces = 0;
    for (const card of cards) {
      if (card.rank === "A") {
        total += 11;
        aces += 1;
      } else if (["J", "Q", "K"].includes(card.rank)) {
        total += 10;
      } else {
        total += Number(card.rank);
      }
    }
    while (total > 21 && aces > 0) {
      total -= 10;
      aces -= 1;
    }
    return total;
  }

  function createCardElement(card, hidden = false) {
    const element = document.createElement("div");
    element.className = `playing-card${card.suit.red ? " is-red" : ""}${hidden ? " is-hidden" : ""}`;
    element.setAttribute("aria-label", hidden ? "伏せられたカード" : `${card.suit.name}の${card.rank}`);
    if (!hidden) {
      const corner = document.createElement("small");
      corner.append(document.createTextNode(card.rank));
      const suit = document.createElement("span");
      suit.textContent = card.suit.symbol;
      corner.append(suit);
      element.append(corner, document.createTextNode(card.suit.symbol));
    }
    return element;
  }

  function renderBlackjack() {
    const dealerCards = $("#dealer-cards");
    const playerCards = $("#player-cards");
    dealerCards.replaceChildren();
    playerCards.replaceChildren();
    dealerHand.forEach((card, index) => dealerCards.append(createCardElement(card, !dealerRevealed && index === 1)));
    playerHand.forEach((card) => playerCards.append(createCardElement(card)));
    $("#player-score").textContent = playerHand.length ? String(scoreHand(playerHand)) : "—";
    $("#dealer-score").textContent = dealerHand.length
      ? String(scoreHand(dealerRevealed ? dealerHand : dealerHand.slice(0, 1)))
      : "—";
  }

  function updateBlackjackControls() {
    const playerTurn = blackjackPhase === "player";
    $("#blackjack-deal").disabled = blackjackPhase !== "idle";
    blackjackBetButtons.forEach((button) => { button.disabled = blackjackPhase !== "idle"; });
    $("#blackjack-hit").disabled = !playerTurn;
    $("#blackjack-stand").disabled = !playerTurn;
    const round = activeRounds.get("blackjack");
    $("#blackjack-double").disabled = !playerTurn || playerHand.length !== 2 || !round || state.balance < round.bet;
  }

  function finishBlackjack(payout, message, isWin = false) {
    const result = settleRound("blackjack", payout);
    blackjackPhase = "idle";
    setMessage($("#blackjack-message"), message(result), isWin);
    updateBlackjackControls();
    sound.play(isWin ? "win" : result?.net === 0 ? "select" : "lose");
  }

  async function dealBlackjack() {
    const round = beginRound("blackjack", blackjackBet.value);
    if (!round) return;
    blackjackPhase = "busy";
    dealerRevealed = false;
    playerHand = [];
    dealerHand = [];
    deck = createDeck();
    updateBlackjackControls();
    setMessage($("#blackjack-message"), "カードを配っています…");

    try {
      playerHand.push(drawCard());
      renderBlackjack();
      sound.play("card");
      await wait(170);
      dealerHand.push(drawCard());
      renderBlackjack();
      sound.play("card");
      await wait(170);
      playerHand.push(drawCard());
      renderBlackjack();
      sound.play("card");
      await wait(170);
      dealerHand.push(drawCard());
      renderBlackjack();
      sound.play("card");

      const playerNatural = scoreHand(playerHand) === 21;
      const dealerNatural = scoreHand(dealerHand) === 21;
      if (playerNatural || dealerNatural) {
        dealerRevealed = true;
        renderBlackjack();
        if (playerNatural && dealerNatural) {
          finishBlackjack(round.bet, () => "双方ブラックジャック — PUSH。賭け金を返却しました。 ");
        } else if (playerNatural) {
          finishBlackjack(Math.round(round.bet * 2.5), (result) => `BLACKJACK — WIN +${formatCredit(result.net)} CR`, true);
        } else {
          finishBlackjack(0, () => "ディーラーのブラックジャック。次の勝負へ。 ");
        }
        return;
      }

      blackjackPhase = "player";
      setMessage($("#blackjack-message"), `あなたは ${scoreHand(playerHand)}。HIT または STANDを選んでください。`);
      updateBlackjackControls();
    } catch {
      cancelRound("blackjack");
      blackjackPhase = "idle";
      updateBlackjackControls();
      setMessage($("#blackjack-message"), "配札を完了できませんでした。賭け金は返却されました。 ");
    }
  }

  async function dealerPlay() {
    blackjackPhase = "busy";
    dealerRevealed = true;
    renderBlackjack();
    updateBlackjackControls();
    await wait(260);
    while (scoreHand(dealerHand) < 17) {
      dealerHand.push(drawCard());
      renderBlackjack();
      sound.play("card");
      await wait(380);
    }

    const round = activeRounds.get("blackjack");
    const playerScore = scoreHand(playerHand);
    const dealerScore = scoreHand(dealerHand);
    if (playerScore > 21) {
      finishBlackjack(0, () => `${playerScore}でバースト。次の勝負へ。`);
    } else if (dealerScore > 21) {
      finishBlackjack(round.bet * 2, (result) => `ディーラーがバースト — WIN +${formatCredit(result.net)} CR`, true);
    } else if (playerScore > dealerScore) {
      finishBlackjack(round.bet * 2, (result) => `${playerScore} 対 ${dealerScore} — WIN +${formatCredit(result.net)} CR`, true);
    } else if (playerScore === dealerScore) {
      finishBlackjack(round.bet, () => `${playerScore} 対 ${dealerScore} — PUSH。賭け金を返却しました。`);
    } else {
      finishBlackjack(0, () => `${playerScore} 対 ${dealerScore} — ディーラーの勝ち。`);
    }
  }

  $("#blackjack-deal").addEventListener("click", dealBlackjack);
  $("#blackjack-hit").addEventListener("click", async () => {
    if (blackjackPhase !== "player") return;
    blackjackPhase = "busy";
    updateBlackjackControls();
    playerHand.push(drawCard());
    renderBlackjack();
    sound.play("card");
    await wait(220);
    if (scoreHand(playerHand) > 21) {
      dealerRevealed = true;
      renderBlackjack();
      finishBlackjack(0, () => `${scoreHand(playerHand)}でバースト。次の勝負へ。`);
    } else if (scoreHand(playerHand) === 21) {
      await dealerPlay();
    } else {
      blackjackPhase = "player";
      setMessage($("#blackjack-message"), `あなたは ${scoreHand(playerHand)}。もう1枚引きますか？`);
      updateBlackjackControls();
    }
  });
  $("#blackjack-stand").addEventListener("click", () => {
    if (blackjackPhase === "player") dealerPlay();
  });
  $("#blackjack-double").addEventListener("click", async () => {
    if (blackjackPhase !== "player" || playerHand.length !== 2) return;
    const round = activeRounds.get("blackjack");
    if (!addStake("blackjack", round.bet)) {
      showToast("ダブルに必要なクレジットが足りません。", true);
      return;
    }
    blackjackPhase = "busy";
    updateBlackjackControls();
    setMessage($("#blackjack-message"), `DOUBLE — 合計 ${formatCredit(round.bet)} CR で勝負。`);
    playerHand.push(drawCard());
    renderBlackjack();
    sound.play("card");
    await wait(320);
    if (scoreHand(playerHand) > 21) {
      dealerRevealed = true;
      renderBlackjack();
      finishBlackjack(0, () => `${scoreHand(playerHand)}でバースト。次の勝負へ。`);
    } else {
      await dealerPlay();
    }
  });

  /* PACHINKO MULTIVERSE — one stable engine, four presentation themes */
  const PACHI_THEMES = Object.freeze({
    sakura: {
      name: "P SAKURA ∞",
      heading: "P SAKURA ∞",
      kicker: "PACHINKO MULTIVERSE / MACHINE 01",
      marquee: "SAKURA",
      boardLabel: "P SAKURA∞ 桜幻想パチンコ盤面",
      intro: "満開の桜を駆け抜け、夜桜の向こうに大当たりを咲かせる。",
      scene: ["MIDNIGHT BLOOM", "桜", "INFINITY"],
      symbols: ["一", "二", "三", "四", "五", "六", "七", "八", "九"],
      effects: {
        instant: "",
        normal: "ノーマルリーチ",
        sakura: "桜舞SP",
        yozakura: "夜桜幻舞SP",
        gold: "金襖・決戦予告",
        rainbow: "天桜全回転"
      },
      normalBadge: "通常時",
      normalLabel: "NORMAL MODE",
      prealertName: "緋桜フラッシュ",
      prealertCopy: "先バレ",
      rushName: "宵桜 RUSH",
      rushLabel: "YOZAKURA RUSH",
      rushKicker: "突入",
      rushEndTitle: "通常時へ",
      rushEndCopy: "また桜を咲かせよう",
      jackpot4: "大当り",
      jackpot10: "超大当り"
    },
    cyber: {
      name: "P NEON//BREACH",
      heading: "P NEON//BREACH",
      kicker: "PACHINKO MULTIVERSE / MACHINE 02",
      marquee: "BREACH",
      boardLabel: "P NEON BREACH 電脳都市パチンコ盤面",
      intro: "暴走都市AIへ侵入し、最深部のジャックポットコードを奪取せよ。",
      scene: ["CITY NODE 09", "侵", "ROOT ACCESS"],
      symbols: ["01", "02", "03", "04", "05", "06", "07", "08", "09"],
      effects: {
        instant: "",
        normal: "TARGET LOCK",
        sakura: "TRACE RUN SP",
        yozakura: "FIREWALL BREAK SP",
        gold: "ROOT ACCESS・GOLD",
        rainbow: "SYSTEM OVERRIDE 全回転"
      },
      normalBadge: "NODE SCAN",
      normalLabel: "INTRUSION MODE",
      prealertName: "CODE RED",
      prealertCopy: "CODE RED",
      rushName: "OVERDRIVE RUSH",
      rushLabel: "OVERDRIVE RUSH",
      rushKicker: "ACCESS",
      rushEndTitle: "SYSTEM RESET",
      rushEndCopy: "RECONNECT TO THE GRID",
      jackpot4: "ACCESS GRANTED",
      jackpot10: "ROOT JACKPOT"
    },
    mecha: {
      name: "P ASTRAL GEAR ZERO",
      heading: "P ASTRAL GEAR ZERO",
      kicker: "PACHINKO MULTIVERSE / MACHINE 03",
      marquee: "ASTRAL",
      boardLabel: "P ASTRAL GEAR ZERO 星間機甲パチンコ盤面",
      intro: "最終機アストラルギアを起動し、星間艦隊との決戦へ出撃する。",
      scene: ["ORBITAL COMMAND", "零", "GEAR ONLINE"],
      symbols: ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9"],
      effects: {
        instant: "",
        normal: "敵影捕捉",
        sakura: "BOOST CHASE SP",
        yozakura: "FLEET BREAK SP",
        gold: "FINAL ARMAMENT",
        rainbow: "ASTRAL COMBINE 全回転"
      },
      normalBadge: "STANDBY",
      normalLabel: "SORTIE MODE",
      prealertName: "SCRAMBLE BEACON",
      prealertCopy: "SCRAMBLE",
      rushName: "ASTRAL DRIVE",
      rushLabel: "ASTRAL DRIVE",
      rushKicker: "IGNITION",
      rushEndTitle: "RETURN BASE",
      rushEndCopy: "NEXT SORTIE AWAITS",
      jackpot4: "MISSION CLEAR",
      jackpot10: "ULTIMATE DRIVE"
    },
    gothic: {
      name: "P NOCTURNE: BLOOD OATH",
      heading: "P NOCTURNE: BLOOD OATH",
      kicker: "PACHINKO MULTIVERSE / MACHINE 04",
      marquee: "NOCTURNE",
      boardLabel: "P NOCTURNE BLOOD OATH 血月古城パチンコ盤面",
      intro: "血月が昇る古城で、封印された夜の契約を完成させる。",
      scene: ["BLOOD MOON", "†", "OATH AWAITS"],
      symbols: ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"],
      effects: {
        instant: "",
        normal: "霧中遭遇",
        sakura: "BLACK ROSE SP",
        yozakura: "ECLIPSE CASTLE SP",
        gold: "GOLDEN COFFIN",
        rainbow: "BLOOD MOON 全回転"
      },
      normalBadge: "NIGHT WATCH",
      normalLabel: "OATH MODE",
      prealertName: "BLOOD BELL",
      prealertCopy: "BLOOD BELL",
      rushName: "CRIMSON RITUAL",
      rushLabel: "CRIMSON RITUAL",
      rushKicker: "AWAKEN",
      rushEndTitle: "DAWN RETURNS",
      rushEndCopy: "THE OATH REMAINS",
      jackpot4: "契約成立",
      jackpot10: "BLOOD OATH"
    }
  });

  function getPachiTheme(themeKey = state.pachiTheme) {
    return PACHI_THEMES[normalizePachiTheme(themeKey)] || PACHI_THEMES[DEFAULT_PACHI_THEME];
  }

  function getPachinkoGuide() {
    const theme = getPachiTheme();
    const effectNames = [theme.effects.sakura, theme.effects.yozakura, theme.effects.gold, theme.effects.rainbow].join("、");
    return {
      title: theme.name,
      intro: theme.intro,
      items: [
        "画面上部から4つの機種を選べます。抽選確率・配当・保留・RUSH仕様は全機種共通です。",
        "レートを選び、<strong>SHOOT</strong>で玉を打ち出します。START入賞率は45%、保留は最大4個です。",
        `通常時の大当たりはSTART入賞ごとに<strong>約1/39.9</strong>。<strong>${theme.prealertName}</strong>は期待度約40%です。`,
        `${effectNames}へ発展。大当たりは<strong>4Rまたは10R</strong>です。`,
        `初当たりの55%で<strong>${theme.rushName}</strong>へ。30回転のST中は約1/24.9、先バレ期待度は約70%です。`,
        "機種変更は通常時・保留なし・AUTO停止中のみ可能です。変更しても抽選確率には影響しません。"
      ]
    };
  }

  const PACHI_CONFIG = Object.freeze({
    startChance: 4500,
    normalHitChance: 251,
    rushHitChance: 402,
    rushEntryChance: 5500,
    rushSpins: 30,
    maxHolds: 4,
    maxPending: 5,
    prealertHitChance: 8000,
    prealertNormalMissChance: 310,
    prealertRushMissChance: 140
  });
  const PACHI_EFFECTS = Object.freeze({
    instant: { label: "", rank: 0 },
    normal: { label: "ノーマルリーチ", rank: 1 },
    sakura: { label: "桜舞SP", rank: 2 },
    yozakura: { label: "夜桜SP", rank: 3 },
    gold: { label: "次回予告・金襖", rank: 4 },
    rainbow: { label: "全回転・虹", rank: 5 }
  });
  const pachinkoBet = setupBetGroup('[data-pachinko-bet]', "pachinkoBet", "#pachinko-bet-display", 10, "pachinko");
  const pachinkoBetButtons = $$('[data-pachinko-bet]');
  let pachiSessionEpoch = 1;
  let pachiProcessing = false;
  let pachiCurrent = null;
  let pachiLaunchLocked = false;
  let pachiLaunchToken = 0;
  let pachiAuto = false;
  let pachiAutoTimer = 0;
  let pachiAlertTicket = 0;
  let pachiAlertActive = false;

  function pachiDelay(milliseconds) {
    const duration = reducedMotion.matches ? Math.min(milliseconds, 28) : state.pachiFast ? milliseconds * 0.48 : milliseconds;
    return new Promise((resolve) => window.setTimeout(resolve, duration));
  }

  async function waitPachi(milliseconds, epoch) {
    await pachiDelay(milliseconds);
    return epoch === pachiSessionEpoch;
  }

  function pachiQueue() {
    if (!Array.isArray(state.pachiPending)) state.pachiPending = [];
    return state.pachiPending;
  }

  function pachiCapacityUsed() {
    const currentOutsideQueue = pachiCurrent && !pachiQueue().some((item) => item.id === pachiCurrent.id) ? 1 : 0;
    return pachiQueue().length + currentOutsideQueue;
  }

  function isPachiThemeLocked() {
    return pachiCapacityUsed() > 0
      || pachiLaunchLocked
      || pachiProcessing
      || Boolean(pachiCurrent)
      || pachiAuto
      || pachiAlertActive
      || state.pachiRush > 0;
  }

  function applyPachiTheme(themeKey, { persist = false, announce = false } = {}) {
    const resolvedKey = normalizePachiTheme(themeKey);
    const theme = getPachiTheme(resolvedKey);
    if (persist) state.pachiTheme = resolvedKey;
    const screen = $("#screen-pachinko");
    const machine = $("#pachi-machine");
    screen.dataset.pachiTheme = resolvedKey;
    machine.dataset.theme = resolvedKey;
    $("#pachi-game-kicker").textContent = theme.kicker;
    $("#pachi-game-title").textContent = theme.heading;
    $("#pachinko-board").setAttribute("aria-label", theme.boardLabel);
    $("#pachi-alert-lamp").replaceChildren(...[...theme.marquee].map((letter) => {
      const span = document.createElement("span");
      span.textContent = letter;
      return span;
    }));
    $("#pachi-scene-kicker").textContent = theme.scene[0];
    $("#pachi-scene-hero").textContent = theme.scene[1];
    $("#pachi-scene-footer").textContent = theme.scene[2];
    $("#pachi-prealert-name").textContent = theme.prealertName;
    $("#pachi-preview-label").textContent = `${theme.prealertName}を試聴`;
    $("#pachi-prealert-copy").textContent = theme.prealertCopy;
    $$("button[data-pachi-theme]").forEach((button) => {
      const selected = button.dataset.pachiTheme === resolvedKey;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    if (!pachiCurrent) setPachiSymbols([3, 7, 5], resolvedKey);
    if (location.hash === "#pachinko") document.title = `${theme.name} — MIDNIGHT ARCADE`;
    if (persist) saveState();
    if (announce) {
      setMessage($("#pachinko-message"), `${theme.name}へ移動しました。${theme.intro}`);
      showToast(`${theme.name}を選択しました。`);
      sound.play("select");
    }
  }

  function selectPachiTheme(themeKey) {
    const resolvedKey = normalizePachiTheme(themeKey);
    if (resolvedKey === state.pachiTheme) return;
    if (isPachiThemeLocked()) {
      showToast("遊技中・AUTO中・RUSH中は機種を変更できません。", true);
      return;
    }
    applyPachiTheme(resolvedKey, { persist: true, announce: true });
    renderPachiHUD();
    updatePachiControls();
  }

  function buildPachinkoPins() {
    const pins = $("#pachinko-pins");
    pins.replaceChildren();
    for (let row = 0; row < 8; row += 1) {
      const count = row % 2 === 0 ? 8 : 7;
      for (let column = 0; column < count; column += 1) {
        const pin = document.createElement("span");
        pin.className = "pachi-pin";
        pin.style.left = `${((column + 1) / (count + 1)) * 100}%`;
        pin.style.top = `${(row / 7) * 100}%`;
        pins.append(pin);
      }
    }
  }

  function choosePachiEffect(hit, mode) {
    const table = hit
      ? [
          { key: "normal", weight: 4 },
          { key: "sakura", weight: 20 },
          { key: "yozakura", weight: mode === "rush" ? 24 : 35 },
          { key: "gold", weight: mode === "rush" ? 38 : 31 },
          { key: "rainbow", weight: mode === "rush" ? 14 : 10 }
        ]
      : [
          { key: "instant", weight: mode === "rush" ? 87 : 905 },
          { key: "normal", weight: mode === "rush" ? 65 : 52 },
          { key: "sakura", weight: mode === "rush" ? 30 : 30 },
          { key: "yozakura", weight: mode === "rush" ? 15 : 11 },
          { key: "gold", weight: mode === "rush" ? 3 : 2 }
        ];
    return weightedChoice(table).key;
  }

  function createPachiDigits(hit, rounds) {
    if (hit) {
      const digit = rounds === 10 ? 7 : [1, 2, 3, 4, 5, 6, 8, 9][randomInt(8)];
      return [digit, digit, digit];
    }
    const left = randomInt(9) + 1;
    let center = randomInt(9) + 1;
    let right = randomInt(9) + 1;
    while (center === left) center = randomInt(9) + 1;
    if (randomInt(100) < 58) right = left;
    if (center === left && right === left) center = left === 9 ? 1 : left + 1;
    return [left, center, right];
  }

  function drawPachiOutcome(bet, mode, themeKey = state.pachiTheme) {
    const hitChance = mode === "rush" ? PACHI_CONFIG.rushHitChance : PACHI_CONFIG.normalHitChance;
    const hit = randomInt(10000) < hitChance;
    const rounds = hit
      ? (randomInt(100) < (mode === "rush" ? 70 : 30) ? 10 : 4)
      : 0;
    const prealertChance = hit
      ? PACHI_CONFIG.prealertHitChance
      : mode === "rush" ? PACHI_CONFIG.prealertRushMissChance : PACHI_CONFIG.prealertNormalMissChance;
    const prealert = randomInt(10000) < prealertChance;
    const rushEntry = hit && (mode === "rush" || randomInt(10000) < PACHI_CONFIG.rushEntryChance);
    const effect = choosePachiEffect(hit, mode);
    return {
      id: `pachi-${Date.now()}-${randomInt(1000000)}`,
      theme: normalizePachiTheme(themeKey),
      bet,
      mode,
      hit,
      prealert,
      alerted: false,
      effect,
      rounds,
      rushEntry,
      digits: createPachiDigits(hit, rounds),
      readyAt: Date.now(),
      rushConsumed: false
    };
  }

  function setPachiSymbols(digits, themeKey = pachiCurrent?.theme || state.pachiTheme) {
    const symbols = getPachiTheme(themeKey).symbols;
    [$("#pachi-symbol-left"), $("#pachi-symbol-center"), $("#pachi-symbol-right")].forEach((element, index) => {
      const digit = digits[index];
      element.textContent = symbols[digit - 1];
      element.dataset.digit = String(digit);
    });
  }

  function setPachiPhase(phase, effect = "") {
    const machine = $("#pachi-machine");
    machine.dataset.phase = phase;
    machine.className = `pachi-machine${effect ? ` effect-${effect}` : ""}${machine.classList.contains("is-prealert") ? " is-prealert" : ""}`;
  }

  function renderPachiHolds() {
    const holds = $$("#pachi-holds li");
    const waiting = pachiQueue().filter((item) => !pachiCurrent || item.id !== pachiCurrent.id).slice(0, PACHI_CONFIG.maxHolds);
    holds.forEach((hold, index) => {
      const item = waiting[index];
      const visiblePrealert = item?.prealert && state.pachiPrealert;
      hold.className = item
        ? `is-filled${visiblePrealert ? " is-hot" : ""}${PACHI_EFFECTS[item.effect]?.rank >= 4 ? " is-gold" : ""}`
        : "";
      hold.setAttribute("aria-label", item
        ? `保留${index + 1} 入賞済み${visiblePrealert ? " 先バレ対象" : ""}`
        : `保留${index + 1} 空き`);
    });
    $("#pachi-hold-count").textContent = `${waiting.length} / ${PACHI_CONFIG.maxHolds}`;
  }

  function renderPachiHUD() {
    const rushMode = pachiCurrent ? pachiCurrent.mode === "rush" : state.pachiRush > 0;
    const theme = getPachiTheme(pachiCurrent?.theme || state.pachiTheme);
    const machine = $("#pachi-machine");
    const statusCard = $(".pachi-status-card");
    machine.dataset.mode = rushMode ? "rush" : "normal";
    statusCard.dataset.mode = rushMode ? "rush" : "normal";
    $("#pachi-mode-badge").textContent = rushMode ? theme.rushName : theme.normalBadge;
    $("#pachi-st-counter").textContent = rushMode ? `ST 残り ${state.pachiRush}` : "大当り 1 / 39.9";
    $("#pachi-status-label").textContent = rushMode ? theme.rushLabel : theme.normalLabel;
    $("#pachi-status-value").textContent = rushMode ? `ST ${state.pachiRush} / 30` : "1 / 39.9";
    $("#pachi-status-note").textContent = rushMode ? "大当り 約1 / 24.9" : "START入賞時";
    $("#pachi-st-fill").style.width = `${(state.pachiRush / PACHI_CONFIG.rushSpins) * 100}%`;
    $(".pachi-st-gauge").setAttribute("aria-valuenow", String(state.pachiRush));
    $("#pachi-prealert-trust").textContent = rushMode ? "期待度 約70%" : "期待度 約40%";
    $("#pachi-total-pay").textContent = formatCredit(state.pachiTotalPay);
    $("#pachi-hit-count").textContent = formatCredit(state.pachiHitCount);

    const prealertToggle = $("#pachi-prealert-toggle");
    prealertToggle.setAttribute("aria-pressed", String(state.pachiPrealert));
    $("strong", prealertToggle).textContent = state.pachiPrealert ? "ON" : "OFF";
    const speedToggle = $("#pachi-speed-toggle");
    speedToggle.setAttribute("aria-pressed", String(state.pachiFast));
    $("strong", speedToggle).textContent = state.pachiFast ? "高速" : "標準";
    const autoToggle = $("#pachi-auto-toggle");
    autoToggle.setAttribute("aria-pressed", String(pachiAuto));
    $("strong", autoToggle).textContent = pachiAuto ? "ON" : "OFF";
    renderPachiHolds();
  }

  function updatePachiControls() {
    const queueLocked = pachiCapacityUsed() >= PACHI_CONFIG.maxPending;
    const insufficient = state.balance < pachinkoBet.value;
    const rushReserved = pachiQueue().filter((item) => item.mode === "rush" && !item.rushConsumed).length;
    const rushResolutionPending = state.pachiRush === 0 && pachiQueue().some((item) => item.mode === "rush");
    const noRushSpinsLeft = rushResolutionPending || (state.pachiRush > 0 && rushReserved >= state.pachiRush);
    $("#pachinko-shoot").disabled = pachiLaunchLocked || queueLocked || insufficient || noRushSpinsLeft;
    pachinkoBetButtons.forEach((button) => {
      button.disabled = pachiCapacityUsed() > 0;
    });
    const themeLocked = isPachiThemeLocked();
    $$("button[data-pachi-theme]").forEach((button) => {
      button.disabled = themeLocked;
      button.title = themeLocked ? "遊技中は機種を変更できません" : "";
    });
    $("#pachi-theme-lock-note").textContent = themeLocked
      ? "現在遊技中です。保留消化・AUTO停止・RUSH終了後に変更できます。"
      : "通常時・保留なしで機種を変更できます。抽選確率は全機種共通です。";
    renderPachiHUD();
  }

  async function triggerPachiPrealert(item = null, preview = false) {
    if (!preview && !state.pachiPrealert) return;
    const ticket = ++pachiAlertTicket;
    pachiAlertActive = true;
    updatePachiControls();
    const machine = $("#pachi-machine");
    machine.classList.add("is-prealert");
    $("#pachi-prealert-copy").hidden = false;
    sound.play("prealert");
    if (!preview) {
      const waitingIndex = pachiQueue().filter((candidate) => !pachiCurrent || candidate.id !== pachiCurrent.id)
        .findIndex((candidate) => candidate.id === item?.id);
      setMessage($("#pachinko-message"), waitingIndex >= 0
        ? `保留${waitingIndex + 1}で先バレ発生 — 期待度UP！`
        : "先バレ発生 — 赤フラッシュ、期待度UP！", true);
    }
    await pachiDelay(820);
    if (ticket === pachiAlertTicket) {
      machine.classList.remove("is-prealert");
      $("#pachi-prealert-copy").hidden = true;
      pachiAlertActive = false;
      updatePachiControls();
    }
  }

  function settlePachiItem(item, payout) {
    const index = pachiQueue().findIndex((candidate) => candidate.id === item.id);
    if (index < 0) return null;
    const safePayout = safeInteger(Math.round(payout), 0);
    pachiQueue().splice(index, 1);
    state.balance = Math.min(MAX_CREDIT, state.balance + safePayout);
    state.pachiTotalPay = Math.min(MAX_CREDIT, state.pachiTotalPay + safePayout);
    if (item.hit) state.pachiHitCount += 1;
    if (item.rushEntry) state.pachiRush = PACHI_CONFIG.rushSpins;
    state.bestWin = Math.max(state.bestWin, Math.max(0, safePayout - item.bet));
    saveState();
    updateDashboard();
    renderPachiHUD();
    return { payout: safePayout, net: safePayout - item.bet };
  }

  function refundPachiItem(item) {
    const index = pachiQueue().findIndex((candidate) => candidate.id === item.id);
    if (index < 0) return;
    pachiQueue().splice(index, 1);
    state.balance = Math.min(MAX_CREDIT, state.balance + item.bet);
    if (item.mode === "rush" && item.rushConsumed) {
      state.pachiRush = Math.min(PACHI_CONFIG.rushSpins, state.pachiRush + 1);
      item.rushConsumed = false;
    }
    saveState();
    updateDashboard();
  }

  async function awaitPachiPush(epoch) {
    const button = $("#pachi-push");
    button.hidden = false;
    if (reducedMotion.matches || state.pachiFast) {
      await waitPachi(state.pachiFast ? 300 : 20, epoch);
      button.hidden = true;
      sound.play("impact");
      return;
    }
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    button.focus({ preventScroll: true });
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        button.removeEventListener("click", onPush);
        window.clearTimeout(timer);
        const restoreFocus = document.activeElement === button;
        button.hidden = true;
        if (restoreFocus) {
          const target = previousFocus?.isConnected && !previousFocus.hidden && !previousFocus.disabled
            ? previousFocus
            : $("#pachinko-shoot");
          target?.focus({ preventScroll: true });
        }
        resolve();
      };
      const onPush = () => {
        sound.play("impact");
        finish();
      };
      const timer = window.setTimeout(finish, 1500);
      button.addEventListener("click", onPush);
    });
  }

  async function cyclePachiSymbols(epoch, effect, themeKey) {
    const cycles = reducedMotion.matches ? 1 : state.pachiFast ? 4 : 8;
    setPachiPhase("spin", effect);
    for (let index = 0; index < cycles; index += 1) {
      setPachiSymbols([randomInt(9) + 1, randomInt(9) + 1, randomInt(9) + 1], themeKey);
      if (!await waitPachi(125, epoch)) return false;
    }
    return true;
  }

  async function showPachiRushEntry(epoch, themeKey) {
    const theme = getPachiTheme(themeKey);
    const overlay = $("#pachi-rush-overlay");
    const [kicker, title, count] = overlay.children;
    kicker.textContent = theme.rushKicker;
    title.textContent = theme.rushName;
    count.textContent = "ST 30";
    overlay.hidden = false;
    $("#pachi-machine").dataset.mode = "rush";
    sound.play("rush");
    setMessage($("#pachinko-message"), `${theme.rushName}突入 — ST30回転、右打ち！`, true);
    await waitPachi(1250, epoch);
    overlay.hidden = true;
  }

  async function showPachiRushEnd(epoch, themeKey) {
    const theme = getPachiTheme(themeKey);
    const overlay = $("#pachi-rush-overlay");
    const [kicker, title, count] = overlay.children;
    kicker.textContent = "ST終了";
    title.textContent = theme.rushEndTitle;
    count.textContent = theme.rushEndCopy;
    overlay.hidden = false;
    sound.play("lose");
    setMessage($("#pachinko-message"), "RUSH終了 — 通常時へ戻ります。 ");
    await waitPachi(900, epoch);
    overlay.hidden = true;
  }

  async function playPachiItem(item, epoch) {
    const themeKey = normalizePachiTheme(item.theme, state.pachiTheme);
    const theme = getPachiTheme(themeKey);
    const effectMeta = PACHI_EFFECTS[item.effect] || PACHI_EFFECTS.instant;
    const effect = { ...effectMeta, label: theme.effects[item.effect] || "" };
    const message = $("#pachinko-message");
    const effectCopy = $("#pachi-effect-copy");
    const reachBanner = $("#pachi-reach-banner");

    if (item.mode === "rush" && !item.rushConsumed) {
      item.rushConsumed = true;
      state.pachiRush = Math.max(0, state.pachiRush - 1);
      saveState();
      renderPachiHUD();
    }

    if (item.prealert && !item.alerted) {
      item.alerted = true;
      saveState();
      await triggerPachiPrealert(item);
      if (epoch !== pachiSessionEpoch) return;
    }

    $("#pachi-jackpot").hidden = true;
    $("#pachi-rush-overlay").hidden = true;
    $("#pachi-push").hidden = true;
    reachBanner.textContent = "";
    effectCopy.textContent = effect.label;
    setMessage(message, item.mode === "rush" ? `RUSH変動 — 残り${state.pachiRush}回` : "図柄変動開始…");

    if (!await cyclePachiSymbols(epoch, item.effect, themeKey)) return;
    if (effect.rank === 0) {
      setPachiSymbols(item.digits, themeKey);
      setPachiPhase("miss", item.effect);
      const result = settlePachiItem(item, 0);
      if (!result) return;
      setMessage(message, item.mode === "rush"
        ? `ハズレ — RUSH残り${state.pachiRush}回`
        : "ハズレ — 次のSTARTを狙おう。 ");
      await waitPachi(420, epoch);
      if (item.mode === "rush" && state.pachiRush === 0 && !pachiQueue().some((queued) => queued.mode === "rush")) {
        await showPachiRushEnd(epoch, themeKey);
      }
      return;
    }

    const reachDigit = item.digits[0];
    const missCenter = item.hit ? (reachDigit === 9 ? 8 : reachDigit + 1) : item.digits[1];
    setPachiSymbols([reachDigit, missCenter, reachDigit], themeKey);
    setPachiPhase("reach", item.effect);
    reachBanner.textContent = effect.label;
    sound.play("reach");
    setMessage(message, `${effect.label} — ${theme.symbols[reachDigit - 1]}図柄テンパイ！`, effect.rank >= 3);
    if (!await waitPachi(600 + effect.rank * 170, epoch)) return;

    if (effect.rank >= 2 || item.hit) {
      setMessage(message, `${effect.label} — PUSHボタンを押せ！`, effect.rank >= 3);
      await awaitPachiPush(epoch);
      if (epoch !== pachiSessionEpoch) return;
    }
    setPachiPhase("impact", item.effect);
    if (effect.rank < 2) sound.play("impact");
    if (!await waitPachi(320, epoch)) return;

    if (!item.hit) {
      setPachiSymbols(item.digits, themeKey);
      setPachiPhase("miss", item.effect);
      const result = settlePachiItem(item, 0);
      if (!result) return;
      setMessage(message, `${effect.label} — 惜しくもハズレ${item.mode === "rush" ? `、残り${state.pachiRush}回` : ""}。`);
      sound.play("lose");
      await waitPachi(650, epoch);
      if (item.mode === "rush" && state.pachiRush === 0 && !pachiQueue().some((queued) => queued.mode === "rush")) {
        await showPachiRushEnd(epoch, themeKey);
      }
      return;
    }

    setPachiSymbols(item.digits, themeKey);
    setPachiPhase("jackpot", item.effect);
    const payout = item.bet * (item.rounds === 10 ? 50 : 16);
    const result = settlePachiItem(item, payout);
    if (!result) return;
    const jackpot = $("#pachi-jackpot");
    $("#pachi-jackpot-kicker").textContent = item.rounds === 10 ? theme.jackpot10 : theme.jackpot4;
    $("#pachi-jackpot-rounds").textContent = `${item.rounds}R`;
    $("#pachi-jackpot-pay").textContent = `+${formatCredit(result.payout)} CR`;
    jackpot.hidden = false;
    sound.play(item.rounds === 10 ? "jackpot" : "win");
    setMessage(message, `${theme.symbols[item.digits[0] - 1]}図柄揃い — ${item.rounds}R 大当たり！ +${formatCredit(result.payout)} CR`, true);

    if (!await waitPachi(item.rounds === 10 ? 1450 : 1050, epoch)) return;
    jackpot.hidden = true;
    if (item.rushEntry) await showPachiRushEntry(epoch, themeKey);
  }

  async function processPachiQueue() {
    if (pachiProcessing) return;
    pachiProcessing = true;
    const epoch = pachiSessionEpoch;
    try {
      while (epoch === pachiSessionEpoch && pachiQueue().length > 0) {
        const item = pachiQueue()[0];
        pachiCurrent = item;
        applyPachiTheme(item.theme, { persist: false });
        renderPachiHUD();
        const waitUntilReady = Math.max(0, safeInteger(item.readyAt, 0, 0, Number.MAX_SAFE_INTEGER) - Date.now());
        if (waitUntilReady > 0 && !await waitPachi(waitUntilReady, epoch)) break;
        await playPachiItem(item, epoch);
        if (epoch !== pachiSessionEpoch) break;
        pachiCurrent = null;
        applyPachiTheme(state.pachiTheme, { persist: false });
        setPachiPhase("idle");
        $("#pachi-effect-copy").textContent = "";
        $("#pachi-reach-banner").textContent = "";
        renderPachiHUD();
        updatePachiControls();
        if (pachiQueue().length && !await waitPachi(220, epoch)) break;
      }
    } catch {
      if (pachiCurrent && epoch === pachiSessionEpoch) {
        refundPachiItem(pachiCurrent);
        setMessage($("#pachinko-message"), "演出を完了できませんでした。該当の玉代を返却しました。 ");
        showToast("パチンコ演出を再開してください。", true);
      }
    } finally {
      if (epoch === pachiSessionEpoch) {
        pachiCurrent = null;
        pachiProcessing = false;
        setPachiPhase("idle");
        updatePachiControls();
      }
    }
  }

  function createPachiBallAnimation(startEntered) {
    const layer = $("#pachi-ball-layer");
    const board = $("#pachinko-board");
    const ball = document.createElement("span");
    ball.className = "pachi-ball";
    layer.append(ball);
    const rect = board.getBoundingClientRect();
    const endX = startEntered ? -rect.width * 0.36 : -rect.width * 0.16;
    const endY = startEntered ? -rect.height * 0.16 : rect.height * 0.09;
    const animation = ball.animate([
      { transform: "translate3d(0, 0, 0)", opacity: 0, offset: 0 },
      { transform: `translate3d(${rect.width * 0.06}px, ${-rect.height * 0.58}px, 0)`, opacity: 1, offset: 0.24 },
      { transform: `translate3d(${-rect.width * 0.12}px, ${-rect.height * 0.66}px, 0)`, opacity: 1, offset: 0.42 },
      { transform: `translate3d(${-rect.width * 0.3}px, ${-rect.height * 0.38}px, 0)`, opacity: 1, offset: 0.7 },
      { transform: `translate3d(${endX}px, ${endY}px, 0)`, opacity: 1, offset: 1 }
    ], {
      duration: reducedMotion.matches ? 30 : state.pachiFast ? 460 : 820,
      easing: "cubic-bezier(.28,.03,.65,1)",
      fill: "forwards"
    });
    return { ball, animation };
  }

  async function shootPachinko(fromAuto = false) {
    if (pachiLaunchLocked || pachiCapacityUsed() >= PACHI_CONFIG.maxPending) return false;
    const bet = pachinkoBet.value;
    if (state.balance < bet) {
      if (fromAuto) setPachiAuto(false);
      showToast("クレジットが足りません。右上の＋から無料で補充できます。", true);
      return false;
    }

    const rushReserved = pachiQueue().filter((item) => item.mode === "rush" && !item.rushConsumed).length;
    if (state.pachiRush === 0 && pachiQueue().some((item) => item.mode === "rush")) return false;
    if (state.pachiRush > 0 && rushReserved >= state.pachiRush) return false;

    pachiLaunchLocked = true;
    const launchToken = ++pachiLaunchToken;
    const epoch = pachiSessionEpoch;
    const startEntered = randomInt(10000) < PACHI_CONFIG.startChance;
    const mode = state.pachiRush > 0 ? "rush" : "normal";
    const item = startEntered ? drawPachiOutcome(bet, mode, state.pachiTheme) : null;
    const flightDuration = reducedMotion.matches ? 30 : state.pachiFast ? 460 : 820;
    if (item) {
      item.readyAt = Date.now() + flightDuration;
      pachiQueue().push(item);
    }
    state.balance -= bet;
    state.totalPlays += 1;
    saveState();
    updateDashboard();
    updatePachiControls();
    if (!pachiCurrent) setMessage($("#pachinko-message"), "玉を打ち出しました — STARTを狙え！");
    sound.play("pachiLaunch");

    const { ball, animation } = createPachiBallAnimation(startEntered);
    try {
      await animation.finished;
      if (epoch !== pachiSessionEpoch) return false;
      if (startEntered) {
        $("#pachi-start").classList.add("is-entered");
        sound.play("pachiStart");
        window.setTimeout(() => $("#pachi-start").classList.remove("is-entered"), 360);
        if (item.prealert && state.pachiPrealert && !item.alerted) {
          item.alerted = true;
          saveState();
          triggerPachiPrealert(item);
        } else if (!pachiCurrent || pachiCurrent.id === item.id) {
          setMessage($("#pachinko-message"), "START入賞 — 図柄変動へ。 ");
        }
      } else if (!pachiCurrent) {
        setMessage($("#pachinko-message"), "OUT — 次の玉でSTARTを狙おう。 ");
      }
      return true;
    } finally {
      animation.cancel();
      ball.remove();
      if (epoch === pachiSessionEpoch && launchToken === pachiLaunchToken) {
        pachiLaunchLocked = false;
        updatePachiControls();
        processPachiQueue();
      }
    }
  }

  function schedulePachiAuto() {
    window.clearTimeout(pachiAutoTimer);
    if (!pachiAuto) return;
    pachiAutoTimer = window.setTimeout(async () => {
      if (!pachiAuto) return;
      await shootPachinko(true);
      schedulePachiAuto();
    }, reducedMotion.matches ? 90 : state.pachiFast ? 410 : 720);
  }

  function setPachiAuto(enabled) {
    pachiAuto = Boolean(enabled);
    window.clearTimeout(pachiAutoTimer);
    renderPachiHUD();
    updatePachiControls();
    if (pachiAuto) {
      showToast("オート発射を開始しました。 ");
      schedulePachiAuto();
    }
  }

  $("#pachinko-shoot").addEventListener("click", () => shootPachinko(false));
  $$("button[data-pachi-theme]").forEach((button) => {
    button.addEventListener("click", () => selectPachiTheme(button.dataset.pachiTheme));
  });
  $("#pachi-auto-toggle").addEventListener("click", () => setPachiAuto(!pachiAuto));
  $("#pachi-prealert-toggle").addEventListener("click", () => {
    state.pachiPrealert = !state.pachiPrealert;
    saveState();
    renderPachiHUD();
    sound.play("select");
    showToast(`先バレを${state.pachiPrealert ? "ON" : "OFF"}にしました。抽選確率は変わりません。`);
  });
  $("#pachi-speed-toggle").addEventListener("click", () => {
    state.pachiFast = !state.pachiFast;
    saveState();
    renderPachiHUD();
    sound.play("select");
  });
  $("#pachi-prealert-preview").addEventListener("click", () => triggerPachiPrealert(null, true));

  window.addEventListener("midnight-screen-change", (event) => {
    if (event.detail !== "pachinko" && pachiAuto) setPachiAuto(false);
  });
  window.addEventListener("midnight-reset", () => {
    pachiSessionEpoch += 1;
    pachiLaunchToken += 1;
    pachiAlertTicket += 1;
    pachiAlertActive = false;
    pachiProcessing = false;
    pachiCurrent = null;
    pachiLaunchLocked = false;
    setPachiAuto(false);
    $("#pachi-ball-layer").replaceChildren();
    $("#pachi-push").hidden = true;
    $("#pachi-prealert-copy").hidden = true;
    $("#pachi-machine").classList.remove("is-prealert");
    window.setTimeout(() => {
      applyPachiTheme(state.pachiTheme, { persist: false });
      setPachiPhase("idle");
      setPachiSymbols([3, 7, 5], state.pachiTheme);
      renderPachiHUD();
      updatePachiControls();
    }, 0);
  });

  buildPachinkoPins();
  renderBlackjack();
  renderRouletteHistory();
  updateBlackjackControls();
  updateDashboard();
  applyPachiTheme(pachiQueue()[0]?.theme || state.pachiTheme, { persist: false });
  setPachiSymbols([3, 7, 5], pachiQueue()[0]?.theme || state.pachiTheme);
  renderPachiHUD();
  updatePachiControls();
  if (pachiQueue().length) processPachiQueue();
  showScreen(location.hash.slice(1) || "lobby", false);

  /* Small read-only surface used by automated browser checks. */
  window.__midnightArcade = Object.freeze({
    getState: () => ({ ...state, rouletteHistory: [...state.rouletteHistory] }),
    scoreHand: (cards) => scoreHand(cards),
    rouletteWins: (bet, number, pickedNumber = -1) => rouletteWins(bet, number, pickedNumber),
    activeRoundCount: () => activeRounds.size,
    getPachinkoState: () => ({
      processing: pachiProcessing,
      currentId: pachiCurrent?.id || null,
      pending: pachiQueue().map((item) => ({ ...item, digits: [...item.digits] })),
      capacityUsed: pachiCapacityUsed(),
      auto: pachiAuto,
      rushRemaining: state.pachiRush
    })
  });
})();

