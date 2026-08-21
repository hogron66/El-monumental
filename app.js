(() => {
  const STORAGE_KEY = 'el-monumental-scoreboard-v2';
  const BASE_WIDTH = 2265;
  const BASE_HEIGHT = 947;
  const MAX_SCORE = 99;
  const MAX_DURATION_MS = 99 * 60 * 1000 + 59 * 1000;
  const DEFAULT_STATE = {
    title: 'WORLD CUP 1978',
    homeName: 'HOME TEAM',
    awayName: 'AWAY TEAM',
    homeScore: 0,
    awayScore: 0,
    period: 1,
    matchDurationMs: 45 * 60 * 1000,
    matchRemainingMs: 45 * 60 * 1000,
    matchRunning: false,
    matchEndAt: null,
    clockMode: 'live',
    clockCustomSeconds: 12 * 3600,
    clockCustomSetAt: Date.now(),
    boardScale: 1
  };

  const stage = document.getElementById('stage');
  const board = document.getElementById('board');
  const modal = document.getElementById('modal');
  const dialogTitle = document.getElementById('dialogTitle');
  const dialogBody = document.getElementById('dialogBody');
  const dialogForm = document.getElementById('dialogForm');
  const dialogClose = document.getElementById('dialogClose');
  const dialogCancel = document.getElementById('dialogCancel');
  const toast = document.getElementById('toast');
  const timerRunningLamp = document.getElementById('timerRunningLamp');
  const fields = {
    title: document.getElementById('titleText'),
    homeName: document.getElementById('homeNameText'),
    awayName: document.getElementById('awayNameText'),
    period: document.getElementById('periodText'),
    matchTime: document.getElementById('matchTimeText'),
    homeScore: document.getElementById('homeScoreText'),
    awayScore: document.getElementById('awayScoreText')
  };
  const canvases = {
    clock: document.getElementById('analogClock')
  };
  const sounds = {
    whistle: new Audio('assets/referee-whistle.mp3'),
    reset: new Audio('assets/button.mp3'),
    crowd: new Audio('assets/big-crowd-cheering.mp3'),
    stadium: new Audio('assets/stadium-crowd-loop.mp3')
  };
  sounds.whistle.volume = 0.78;
  sounds.reset.volume = 0.62;
  sounds.crowd.volume = 0.68;
  sounds.stadium.volume = 0.34;
  sounds.stadium.loop = true;
  Object.values(sounds).forEach((sound) => { sound.preload = 'auto'; });

  let state = loadState();
  let dialogSubmitHandler = null;
  let toastTimer = null;
  let timerFinishedHandled = false;
  let stadiumSoundPlaying = false;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function asFiniteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizeBoardText(value, maxLength) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ñ/gi, 'n')
      .toUpperCase()
      .replace(/[^A-Z0-9 .:\-/]/g, '')
      .slice(0, maxLength)
      .trim();
  }

  function loadState() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
      saved = {};
    }

    const loaded = { ...DEFAULT_STATE, ...saved };
    loaded.title = normalizeBoardText(loaded.title ?? DEFAULT_STATE.title, 34) || DEFAULT_STATE.title;
    loaded.homeName = normalizeBoardText(loaded.homeName ?? DEFAULT_STATE.homeName, 18) || DEFAULT_STATE.homeName;
    loaded.awayName = normalizeBoardText(loaded.awayName ?? DEFAULT_STATE.awayName, 18) || DEFAULT_STATE.awayName;
    loaded.homeScore = clamp(Math.round(asFiniteNumber(loaded.homeScore, 0)), 0, MAX_SCORE);
    loaded.awayScore = clamp(Math.round(asFiniteNumber(loaded.awayScore, 0)), 0, MAX_SCORE);
    loaded.period = clamp(Math.round(asFiniteNumber(loaded.period, 1)), 0, 9);
    loaded.matchDurationMs = clamp(asFiniteNumber(loaded.matchDurationMs, DEFAULT_STATE.matchDurationMs), 0, MAX_DURATION_MS);
    loaded.matchRemainingMs = clamp(asFiniteNumber(loaded.matchRemainingMs, loaded.matchDurationMs), 0, MAX_DURATION_MS);
    loaded.matchRunning = Boolean(loaded.matchRunning);
    loaded.matchEndAt = loaded.matchRunning ? asFiniteNumber(loaded.matchEndAt, null) : null;
    loaded.clockMode = loaded.clockMode === 'custom' ? 'custom' : 'live';
    loaded.clockCustomSeconds = ((Math.round(asFiniteNumber(loaded.clockCustomSeconds, DEFAULT_STATE.clockCustomSeconds)) % 86400) + 86400) % 86400;
    loaded.clockCustomSetAt = asFiniteNumber(loaded.clockCustomSetAt, Date.now());
    loaded.boardScale = clamp(asFiniteNumber(loaded.boardScale, DEFAULT_STATE.boardScale), 0.75, 1.25);

    if (loaded.matchRunning && !loaded.matchEndAt) {
      loaded.matchEndAt = Date.now() + loaded.matchRemainingMs;
    }

    return loaded;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage may be unavailable in private mode; app still works.
    }
  }

  function fitBoard() {
    const availableWidth = stage.clientWidth || window.innerWidth;
    const availableHeight = stage.clientHeight || window.innerHeight;
    const fittedScale = Math.min(availableWidth / BASE_WIDTH, availableHeight / BASE_HEIGHT);
    const scale = fittedScale * state.boardScale;
    board.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }

  function prepareCanvas(canvas) {
    const width = Math.max(1, Math.round(canvas.clientWidth));
    const height = Math.max(1, Math.round(canvas.clientHeight));
    const ratio = Math.min(2.5, window.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    return { context, width, height };
  }

  function getClockSeconds() {
    if (state.clockMode === 'live') {
      const now = new Date();
      return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000;
    }
    const elapsed = Math.max(0, Date.now() - state.clockCustomSetAt) / 1000;
    return (state.clockCustomSeconds + elapsed) % 86400;
  }

  function getMatchRemainingMs() {
    if (!state.matchRunning) {
      return state.matchRemainingMs;
    }
    return Math.max(0, state.matchEndAt - Date.now());
  }

  function formatMatchTime(remainingMs) {
    const totalSeconds = clamp(Math.ceil(remainingMs / 1000), 0, 99 * 60 + 59);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function drawClock() {
    const { context, width, height } = prepareCanvas(canvases.clock);
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.485;
    const seconds = getClockSeconds();
    const hour = Math.floor(seconds / 3600) % 12;
    const minute = Math.floor(seconds / 60) % 60;
    const second = seconds % 60;

    context.save();
    context.translate(centerX, centerY);

    const face = context.createRadialGradient(-radius * 0.18, -radius * 0.22, radius * 0.05, 0, 0, radius);
    face.addColorStop(0, '#090909');
    face.addColorStop(0.72, '#020202');
    face.addColorStop(1, '#000');
    context.fillStyle = face;
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.fill();

    context.lineWidth = radius * 0.018;
    context.strokeStyle = 'rgba(255,255,255,0.10)';
    context.stroke();

    context.strokeStyle = '#deded9';
    context.lineCap = 'butt';
    for (let index = 0; index < 12; index += 1) {
      if (index === 0) continue;
      const angle = (index / 12) * Math.PI * 2 - Math.PI / 2;
      const cardinal = index % 3 === 0;
      const outer = radius * 0.88;
      const inner = radius * (cardinal ? 0.70 : 0.76);
      context.lineWidth = radius * (cardinal ? 0.082 : 0.058);
      context.beginPath();
      context.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      context.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      context.stroke();
    }

    context.fillStyle = '#d9d9d4';
    context.font = `${Math.round(radius * 0.28)}px Arial, Helvetica, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('12', 0, -radius * 0.73);

    drawClockHand(context, (hour + minute / 60 + second / 3600) * Math.PI / 6, radius * 0.48, radius * 0.046, '#d8d8d4', radius * 0.08);
    drawClockHand(context, (minute + second / 60) * Math.PI / 30, radius * 0.70, radius * 0.035, '#e5e5e0', radius * 0.10);
    drawClockHand(context, second * Math.PI / 30, radius * 0.76, radius * 0.012, '#cfcfca', radius * 0.13);

    context.fillStyle = '#efefea';
    context.beginPath();
    context.arc(0, 0, radius * 0.045, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#777873';
    context.beginPath();
    context.arc(0, 0, radius * 0.018, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function drawClockHand(context, angle, length, width, color, tailLength) {
    const adjusted = angle - Math.PI / 2;
    context.save();
    context.rotate(adjusted);
    context.strokeStyle = color;
    context.lineWidth = width;
    context.lineCap = 'round';
    context.shadowColor = 'rgba(0,0,0,0.8)';
    context.shadowBlur = width * 0.7;
    context.beginPath();
    context.moveTo(-tailLength, 0);
    context.lineTo(length, 0);
    context.stroke();
    context.restore();
  }

  function fitLedText(element, maxSize, minSize) {
    let size = maxSize;
    element.style.fontSize = `${size}px`;
    while (element.scrollWidth > element.clientWidth && size > minSize) {
      size -= 2;
      element.style.fontSize = `${size}px`;
    }
  }

  function renderStaticDisplays() {
    fields.title.textContent = state.title;
    fitLedText(fields.title, 72, 46);
    fields.homeName.textContent = state.homeName;
    fields.awayName.textContent = state.awayName;
    fields.period.textContent = String(state.period);
    fields.homeScore.textContent = String(state.homeScore);
    fields.awayScore.textContent = String(state.awayScore);
  }

  function renderTimer() {
    const remaining = getMatchRemainingMs();
    fields.matchTime.textContent = formatMatchTime(remaining);
    timerRunningLamp.classList.toggle('is-running', state.matchRunning);

    if (state.matchRunning && remaining <= 0 && !timerFinishedHandled) {
      timerFinishedHandled = true;
      state.matchRunning = false;
      state.matchRemainingMs = 0;
      state.matchEndAt = null;
      saveState();
      timerRunningLamp.classList.remove('is-running');
      playEffect(sounds.whistle);
      if ('vibrate' in navigator) {
        navigator.vibrate([180, 100, 180]);
      }
      showToast('Match timer finished');
    }

    if (remaining > 0) {
      timerFinishedHandled = false;
    }
  }

  function renderAll() {
    renderStaticDisplays();
    renderTimer();
    drawClock();
  }

  function playEffect(sound) {
    try {
      sound.pause();
      sound.currentTime = 0;
      const playback = sound.play();
      playback?.catch(() => {});
    } catch {
      // Audio remains optional when a browser blocks playback.
    }
  }

  function renderStadiumSoundButton() {
    const button = document.getElementById('stadiumSoundButton');
    button.classList.toggle('is-active', stadiumSoundPlaying);
    button.setAttribute('aria-pressed', String(stadiumSoundPlaying));
    button.setAttribute('aria-label', stadiumSoundPlaying ? 'Stop stadium sounds' : 'Start stadium sounds');
  }

  async function toggleStadiumSound() {
    if (stadiumSoundPlaying) {
      sounds.stadium.pause();
      stadiumSoundPlaying = false;
      renderStadiumSoundButton();
      showToast('Stadium sounds off');
      return;
    }

    try {
      await sounds.stadium.play();
      stadiumSoundPlaying = true;
      renderStadiumSoundButton();
      showToast('Stadium sounds on');
    } catch {
      stadiumSoundPlaying = false;
      renderStadiumSoundButton();
      showToast('Tap again to enable stadium sounds');
    }
  }

  function stopStadiumSound() {
    sounds.stadium.pause();
    sounds.stadium.currentTime = 0;
    stadiumSoundPlaying = false;
    renderStadiumSoundButton();
  }

  function updateScore(side, delta) {
    const key = side === 'home' ? 'homeScore' : 'awayScore';
    const previous = state[key];
    state[key] = clamp(state[key] + delta, 0, MAX_SCORE);
    saveState();
    fields[key].textContent = String(state[key]);
    if (state[key] !== previous) playEffect(sounds.crowd);
  }

  function updatePeriod(delta) {
    state.period = clamp(state.period + delta, 0, 9);
    saveState();
    fields.period.textContent = String(state.period);
  }

  function startTimer() {
    const remaining = getMatchRemainingMs();
    state.matchRemainingMs = remaining <= 0 ? state.matchDurationMs : remaining;
    state.matchEndAt = Date.now() + state.matchRemainingMs;
    state.matchRunning = true;
    timerFinishedHandled = false;
    saveState();
    renderTimer();
    playEffect(sounds.whistle);
    showToast('Match timer started');
  }

  function pauseTimer() {
    if (state.matchRunning) {
      state.matchRemainingMs = getMatchRemainingMs();
      state.matchRunning = false;
      state.matchEndAt = null;
      saveState();
      renderTimer();
      playEffect(sounds.whistle);
      showToast('Match timer paused');
    }
  }

  function resetTimer() {
    state.matchRunning = false;
    state.matchEndAt = null;
    state.matchRemainingMs = state.matchDurationMs;
    timerFinishedHandled = false;
    saveState();
    renderTimer();
    playEffect(sounds.reset);
    showToast(`Reset to ${formatMatchTime(state.matchDurationMs)}`);
  }

  function showDialog(title, bodyHtml, setup, onSubmit) {
    dialogTitle.textContent = title;
    dialogBody.innerHTML = bodyHtml;
    dialogSubmitHandler = onSubmit;
    modal.hidden = false;
    setup?.();
    window.setTimeout(() => {
      const firstField = dialogBody.querySelector('input:not([type="radio"]):not([type="checkbox"]), select, button');
      firstField?.focus();
    }, 50);
  }

  function closeDialog() {
    modal.hidden = true;
    dialogSubmitHandler = null;
    dialogBody.innerHTML = '';
  }

  function openNameDialog(key, title, maxLength) {
    showDialog(
      title,
      `<label class="form-field">
        <span>Scoreboard text</span>
        <input id="nameInput" type="text" maxlength="${maxLength}" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="done">
      </label>
      <p class="dialog-note">The dialog opens at the top of the screen so the keyboard does not cover the scoreboard text area.</p>`,
      () => {
        const input = document.getElementById('nameInput');
        input.value = state[key];
        input.select();
      },
      () => {
        const input = document.getElementById('nameInput');
        const value = normalizeBoardText(input.value, maxLength);
        state[key] = value || (key === 'title' ? DEFAULT_STATE.title : key === 'homeName' ? DEFAULT_STATE.homeName : DEFAULT_STATE.awayName);
        saveState();
        renderStaticDisplays();
        showToast('Text saved');
      }
    );
  }

  function secondsToTimeInput(totalSeconds) {
    const seconds = ((Math.floor(totalSeconds) % 86400) + 86400) % 86400;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }

  function parseTimeInput(value) {
    const parts = String(value || '').split(':').map((part) => Number(part));
    const hours = clamp(Number.isFinite(parts[0]) ? parts[0] : 0, 0, 23);
    const minutes = clamp(Number.isFinite(parts[1]) ? parts[1] : 0, 0, 59);
    const seconds = clamp(Number.isFinite(parts[2]) ? parts[2] : 0, 0, 59);
    return hours * 3600 + minutes * 60 + seconds;
  }

  function openClockDialog() {
    showDialog(
      'Clock settings',
      `<div class="radio-stack" role="radiogroup" aria-label="Clock mode">
        <label class="radio-option"><input type="radio" name="clockMode" value="live"> Use the current phone time</label>
        <label class="radio-option"><input type="radio" name="clockMode" value="custom"> Start from a custom time</label>
      </div>
      <label class="form-field">
        <span>Selected time</span>
        <input id="clockTimeInput" type="time" step="1">
      </label>
      <p class="dialog-note">When a custom time is used, the analog clock continues running naturally from that chosen time.</p>`,
      () => {
        const radios = [...dialogBody.querySelectorAll('input[name="clockMode"]')];
        const timeInput = document.getElementById('clockTimeInput');
        const current = Math.floor(getClockSeconds());
        timeInput.value = secondsToTimeInput(current);
        radios.find((radio) => radio.value === state.clockMode).checked = true;
        const updateAvailability = () => {
          const custom = dialogBody.querySelector('input[name="clockMode"]:checked')?.value === 'custom';
          timeInput.disabled = !custom;
        };
        radios.forEach((radio) => radio.addEventListener('change', updateAvailability));
        updateAvailability();
      },
      () => {
        const mode = dialogBody.querySelector('input[name="clockMode"]:checked')?.value || 'live';
        if (mode === 'custom') {
          state.clockMode = 'custom';
          state.clockCustomSeconds = parseTimeInput(document.getElementById('clockTimeInput').value);
          state.clockCustomSetAt = Date.now();
          showToast(`Clock set to ${secondsToTimeInput(state.clockCustomSeconds).slice(0, 5)}`);
        } else {
          state.clockMode = 'live';
          showToast('Clock uses current time again');
        }
        saveState();
        drawClock();
      }
    );
  }

  function openPeriodDialog() {
    showDialog(
      'Period settings',
      `<label class="form-field">
        <span>Period</span>
        <input id="periodInput" type="number" min="0" max="9" step="1" inputmode="numeric" enterkeyhint="done">
      </label>
      <div class="quick-buttons" aria-label="Quick period choices">
        <button type="button" data-period="1">1st half</button>
        <button type="button" data-period="2">2nd half</button>
        <button type="button" data-period="3">Extra time 1</button>
        <button type="button" data-period="4">Extra time 2</button>
      </div>`,
      () => {
        const input = document.getElementById('periodInput');
        input.value = state.period;
        dialogBody.querySelectorAll('[data-period]').forEach((button) => {
          button.addEventListener('click', () => {
            input.value = button.dataset.period;
          });
        });
      },
      () => {
        state.period = clamp(Math.round(Number(document.getElementById('periodInput').value) || 0), 0, 9);
        saveState();
        fields.period.textContent = String(state.period);
        showToast(`Period ${state.period}`);
      }
    );
  }

  function openTimerDialog() {
    const currentMs = getMatchRemainingMs();
    const currentSeconds = Math.ceil(currentMs / 1000);
    const currentMinutes = Math.floor(currentSeconds / 60);
    const remainderSeconds = currentSeconds % 60;

    showDialog(
      'Match timer settings',
      `<div class="form-row">
        <label class="form-field">
          <span>Minutes</span>
          <input id="timerMinutes" type="number" min="0" max="99" step="1" inputmode="numeric" enterkeyhint="next">
        </label>
        <label class="form-field">
          <span>Seconds</span>
          <input id="timerSeconds" type="number" min="0" max="59" step="1" inputmode="numeric" enterkeyhint="done">
        </label>
      </div>
      <div class="quick-buttons" aria-label="Quick time choices">
        <button type="button" data-time="2700">45:00</button>
        <button type="button" data-time="1800">30:00</button>
        <button type="button" data-time="900">15:00</button>
        <button type="button" data-time="300">05:00</button>
      </div>
      <label class="radio-option">
        <input id="timerStartAfterSave" type="checkbox"> Start immediately after saving
      </label>
      <p class="dialog-note">The value you set becomes both the new default duration and the current remaining time.</p>`,
      () => {
        const minutes = document.getElementById('timerMinutes');
        const seconds = document.getElementById('timerSeconds');
        minutes.value = currentMinutes;
        seconds.value = remainderSeconds;
        dialogBody.querySelectorAll('[data-time]').forEach((button) => {
          button.addEventListener('click', () => {
            const total = Number(button.dataset.time);
            minutes.value = Math.floor(total / 60);
            seconds.value = total % 60;
          });
        });
      },
      () => {
        const minutes = clamp(Math.floor(Number(document.getElementById('timerMinutes').value) || 0), 0, 99);
        const seconds = clamp(Math.floor(Number(document.getElementById('timerSeconds').value) || 0), 0, 59);
        const totalMs = (minutes * 60 + seconds) * 1000;
        const startImmediately = document.getElementById('timerStartAfterSave').checked;
        state.matchDurationMs = totalMs;
        state.matchRemainingMs = totalMs;
        state.matchRunning = startImmediately && totalMs > 0;
        state.matchEndAt = state.matchRunning ? Date.now() + totalMs : null;
        timerFinishedHandled = false;
        saveState();
        renderTimer();
        showToast(`${formatMatchTime(totalMs)} set${state.matchRunning ? ' and started' : ''}`);
      }
    );
  }

  function openScaleDialog() {
    const currentPercent = Math.round(state.boardScale * 100);
    showDialog(
      'Scoreboard scale',
      `<label class="form-field">
        <span>Display size</span>
        <div class="scale-range-row">
          <input id="scaleInput" type="range" min="75" max="125" step="5" value="${currentPercent}">
          <output id="scaleValue" for="scaleInput">${currentPercent}%</output>
        </div>
      </label>
      <div class="quick-buttons" aria-label="Quick scale choices">
        <button type="button" data-scale="80">80%</button>
        <button type="button" data-scale="90">90%</button>
        <button type="button" data-scale="100">Fit</button>
        <button type="button" data-scale="110">110%</button>
        <button type="button" data-scale="125">125%</button>
      </div>
      <p class="dialog-note">100% fits the complete scoreboard to the available landscape screen. Larger values may crop the outer edges.</p>`,
      () => {
        const input = document.getElementById('scaleInput');
        const output = document.getElementById('scaleValue');
        const updateValue = () => {
          output.value = `${input.value}%`;
          output.textContent = `${input.value}%`;
        };
        input.addEventListener('input', updateValue);
        dialogBody.querySelectorAll('[data-scale]').forEach((button) => {
          button.addEventListener('click', () => {
            input.value = button.dataset.scale;
            updateValue();
          });
        });
        updateValue();
      },
      () => {
        const percent = clamp(Math.round(Number(document.getElementById('scaleInput').value) || 100), 75, 125);
        state.boardScale = percent / 100;
        saveState();
        fitBoard();
        showToast(`Scoreboard scale: ${percent}%`);
      }
    );
  }

  function openScoreDialog(side) {
    const key = side === 'home' ? 'homeScore' : 'awayScore';
    const label = side === 'home' ? 'Home score' : 'Away score';
    showDialog(
      label,
      `<label class="form-field">
        <span>Goals</span>
        <input id="scoreInput" type="number" min="0" max="${MAX_SCORE}" step="1" inputmode="numeric" enterkeyhint="done">
      </label>`,
      () => {
        const input = document.getElementById('scoreInput');
        input.value = state[key];
        input.select();
      },
      () => {
        state[key] = clamp(Math.round(Number(document.getElementById('scoreInput').value) || 0), 0, MAX_SCORE);
        saveState();
        fields[key].textContent = String(state[key]);
        showToast(`${label}: ${state[key]}`);
      }
    );
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 1800);
  }

  async function requestLandscapeLock() {
    try {
      if (screen.orientation?.lock && window.innerWidth >= window.innerHeight) {
        await screen.orientation.lock('landscape');
      }
    } catch {
      // iOS Safari does not support orientation lock; portrait overlay remains fallback.
    }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
        await requestLandscapeLock();
      } else if (document.documentElement.webkitRequestFullscreen) {
        document.documentElement.webkitRequestFullscreen();
      }
    } catch {
      showToast('Fullscreen depends on your browser or installed app');
    }
  }

  function bindEvents() {
    document.getElementById('titleField').addEventListener('click', () => openNameDialog('title', 'Top text', 34));
    document.getElementById('homeNameField').addEventListener('click', () => openNameDialog('homeName', 'Home team name', 18));
    document.getElementById('awayNameField').addEventListener('click', () => openNameDialog('awayName', 'Away team name', 18));
    document.getElementById('clockButton').addEventListener('click', openClockDialog);

    document.getElementById('periodMinus').addEventListener('click', () => updatePeriod(-1));
    document.getElementById('periodPlus').addEventListener('click', () => updatePeriod(1));
    document.getElementById('periodField').addEventListener('click', openPeriodDialog);

    document.getElementById('timerStart').addEventListener('click', startTimer);
    document.getElementById('timerPause').addEventListener('click', pauseTimer);
    document.getElementById('timerReset').addEventListener('click', resetTimer);
    document.getElementById('timerSettings').addEventListener('click', openTimerDialog);
    document.getElementById('matchTimeField').addEventListener('click', openTimerDialog);

    document.getElementById('homeScoreMinus').addEventListener('click', () => updateScore('home', -1));
    document.getElementById('homeScorePlus').addEventListener('click', () => updateScore('home', 1));
    document.getElementById('awayScoreMinus').addEventListener('click', () => updateScore('away', -1));
    document.getElementById('awayScorePlus').addEventListener('click', () => updateScore('away', 1));
    document.getElementById('homeScoreField').addEventListener('click', () => openScoreDialog('home'));
    document.getElementById('awayScoreField').addEventListener('click', () => openScoreDialog('away'));

    document.getElementById('stadiumSoundButton').addEventListener('click', toggleStadiumSound);
    document.getElementById('scaleButton').addEventListener('click', openScaleDialog);
    document.getElementById('fullscreenButton').addEventListener('click', toggleFullscreen);

    dialogClose.addEventListener('click', closeDialog);
    dialogCancel.addEventListener('click', closeDialog);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeDialog();
    });
    dialogForm.addEventListener('submit', (event) => {
      event.preventDefault();
      dialogSubmitHandler?.();
      closeDialog();
    });

    window.addEventListener('resize', () => {
      fitBoard();
      renderAll();
    });
    window.addEventListener('orientationchange', () => {
      window.setTimeout(() => {
        fitBoard();
        renderAll();
      }, 180);
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        fitBoard();
        renderAll();
      } else if (stadiumSoundPlaying) {
        stopStadiumSound();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.hidden) {
        closeDialog();
      }
      const target = event.target;
      const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable;
      if (event.key === ' ' && modal.hidden && !isTyping) {
        event.preventDefault();
        state.matchRunning ? pauseTimer() : startTimer();
      }
    });

    document.addEventListener('pointerdown', requestLandscapeLock, { once: true });
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      });
    }
  }

  bindEvents();
  fitBoard();
  renderAll();
  renderStadiumSoundButton();
  registerServiceWorker();

  if (document.fonts?.ready) {
    document.fonts.ready.then(renderStaticDisplays).catch(() => {});
  }

  window.setInterval(() => {
    drawClock();
    renderTimer();
  }, 250);
})();
