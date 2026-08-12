(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const STORAGE_KEY = "midnight-arcade-state-v1";
  const MAX_CREDIT = 9999999;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const defaultState = () => ({
    balance: 2500,
    totalPlays: 0,
    bestWin: 0,
    sound: false,
    fever: 0,
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
      return {
        balance: safeInteger(saved.balance, fallback.balance),
        totalPlays: safeInteger(saved.totalPlays, 0, 0, 10000000),
        bestWin: safeInteger(saved.bestWin, 0),
        sound: saved.sound === true,
        fever: safeInteger(saved.fever, 0, 0, 5),
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
    feverFill.style.width = `${state.fever * 20}%`;
    feverLabel.textContent = `${state.fever} / 5`;
    feverMeter.setAttribute("aria-valuenow", String(state.fever));
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
    async toggle() {
      state.sound = !state.sound;
      if (state.sound) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          this.context ||= new AudioContext();
          if (this.context.state === "suspended") await this.context.resume();
          this.play("select");
        }
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
      if (!state.sound || !this.context) return;
      const patterns = {
        select: [[480, 0.06, 0]],
        start: [[180, 0.09, 0], [240, 0.09, 0.08]],
        stop: [[380, 0.07, 0]],
        win: [[523, 0.1, 0], [659, 0.1, 0.1], [784, 0.18, 0.2]],
        lose: [[210, 0.12, 0], [150, 0.18, 0.1]],
        card: [[320, 0.055, 0]],
        jackpot: [[523, 0.12, 0], [659, 0.12, 0.1], [784, 0.12, 0.2], [1046, 0.3, 0.31]]
      };
      (patterns[type] || patterns.select).forEach(([frequency, duration, offset]) => this.tone(frequency, duration, offset));
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
    pachinko: "SAKURA ∞ — MIDNIGHT ARCADE"
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
    document.title = titles[name];
    if (writeHash && location.hash !== `#${name}`) history.pushState({ screen: name }, "", `#${name}`);
    window.scrollTo({ top: 0, behavior: reducedMotion.matches ? "auto" : "smooth" });
    if (name !== "lobby") {
      window.setTimeout(() => $(`#screen-${name} h1`)?.focus({ preventScroll: true }), reducedMotion.matches ? 0 : 260);
    }
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
      title: "SAKURA ∞",
      intro: "玉が釘を抜けて落ちる、オリジナルのスマートパチンコです。",
      items: [
        "玉の価値を選び、<strong>SHOOT</strong>で1玉を打ち出します。",
        "下部の7つのポケットで配当が決まり、中央FEVERは<strong>8倍</strong>です。",
        "当たりポケットに入るたびFEVERゲージが1つ増えます。",
        "ゲージが5つたまると、次の1玉だけ中央FEVERへ入りやすくなります。"
      ]
    }
  };

  const rulesDialog = $("#rules-dialog");
  $$('[data-open-rules]').forEach((button) => {
    button.addEventListener("click", () => {
      const guide = guides[button.dataset.openRules] || guides.lobby;
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

  /* SAKURA infinity */
  const pachinkoBet = setupBetGroup('[data-pachinko-bet]', "pachinkoBet", "#pachinko-bet-display", 25, "pachinko");
  const pachinkoBetButtons = $$('[data-pachinko-bet]');
  const pachinkoMultipliers = [0, 1, 2, 8, 2, 1, 0];

  function buildPachinkoPins() {
    const pins = $("#pachinko-pins");
    for (let row = 0; row < 7; row += 1) {
      const count = row % 2 === 0 ? 7 : 6;
      for (let column = 0; column < count; column += 1) {
        const pin = document.createElement("span");
        pin.className = "pin";
        pin.style.left = `${((column + 1) / (count + 1)) * 100}%`;
        pin.style.top = `${(row / 6) * 100}%`;
        pins.append(pin);
      }
    }
  }

  function choosePachinkoLane(feverBoost) {
    const weights = feverBoost ? [8, 12, 15, 34, 15, 12, 8] : [12, 18, 20, 5, 20, 18, 12];
    const choices = weights.map((weight, index) => ({ index, weight }));
    return weightedChoice(choices).index;
  }

  function pachinkoPath(lane) {
    const targetX = 7 + ((lane + 0.5) / 7) * 86;
    const frames = [{ left: "50%", top: "28%", opacity: 1, offset: 0 }];
    for (let step = 1; step <= 7; step += 1) {
      const progress = step / 8;
      const baseX = 50 + (targetX - 50) * progress;
      const jitter = (randomInt(17) - 8) * (1 - progress * 0.55);
      const x = Math.max(8, Math.min(92, baseX + jitter));
      frames.push({ left: `${x}%`, top: `${28 + step * 7.2}%`, opacity: 1, offset: progress });
    }
    frames.push({ left: `${targetX}%`, top: "88%", opacity: 1, offset: 1 });
    return frames;
  }

  async function shootPachinko() {
    const round = beginRound("pachinko", pachinkoBet.value);
    if (!round) return;
    const message = $("#pachinko-message");
    const shootButton = $("#pachinko-shoot");
    const ball = $("#pachinko-ball");
    const feverBoost = state.fever >= 5;
    const lane = choosePachinkoLane(feverBoost);
    const multiplier = pachinkoMultipliers[lane];
    shootButton.disabled = true;
    pachinkoBet.setDisabled(true);
    setMessage(message, feverBoost ? "FEVER CHANCE — 中央ポケットを狙え！" : "玉を打ち出しました…");
    sound.play("start");

    try {
      ball.getAnimations().forEach((animation) => animation.cancel());
      const animation = ball.animate(pachinkoPath(lane), {
        duration: reducedMotion.matches ? 45 : 2200,
        easing: "linear",
        fill: "forwards"
      });
      await animation.finished;

      const pocket = $$('.pockets span')[lane];
      pocket.classList.add("is-hit");
      if (feverBoost) state.fever = 0;
      if (multiplier > 0) state.fever = Math.min(5, state.fever + 1);
      const result = settleRound("pachinko", round.bet * multiplier);

      if (multiplier === 8) {
        setMessage(message, `FEVER ×8 — WIN +${formatCredit(result.net)} CR`, true);
        sound.play("jackpot");
      } else if (result.payout > 0) {
        const detail = result.net > 0 ? `+${formatCredit(result.net)} CR` : "玉代返却";
        setMessage(message, `ポケット ×${multiplier} — ${detail}`, true);
        sound.play("win");
      } else {
        setMessage(message, "MISS — 次の玉で中央を狙おう。 ");
        sound.play("lose");
      }
      await wait(480);
      pocket.classList.remove("is-hit");
      animation.cancel();
    } catch {
      cancelRound("pachinko");
      setMessage(message, "抽選を完了できませんでした。玉代は返却されました。 ");
      showToast("パチンコを再開してください。", true);
    } finally {
      ball.style.opacity = "0";
      pachinkoBet.setDisabled(false);
      shootButton.disabled = false;
    }
  }

  $("#pachinko-shoot").addEventListener("click", shootPachinko);

  buildPachinkoPins();
  renderBlackjack();
  renderRouletteHistory();
  updateBlackjackControls();
  updateDashboard();
  showScreen(location.hash.slice(1) || "lobby", false);

  /* Small read-only surface used by automated browser checks. */
  window.__midnightArcade = Object.freeze({
    getState: () => ({ ...state, rouletteHistory: [...state.rouletteHistory] }),
    scoreHand: (cards) => scoreHand(cards),
    rouletteWins: (bet, number, pickedNumber = -1) => rouletteWins(bet, number, pickedNumber),
    activeRoundCount: () => activeRounds.size
  });
})();

