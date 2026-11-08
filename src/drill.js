// 高压对抗训练模式 (DrillTrainer)
// AI NPC 诘难 → 倒计时 → 极速反驳 → 多维评分

class DrillTrainer {
  constructor() {
    this.scenarios = [];
    this.isRunning = false;
    this.countdownSec = 3;
    this.responseStartAt = null;
    this.firstWordLatencyMs = null;
    this.responseSentences = [];
    this.responseFullText = '';
    this.drillStats = { fillers: 0, hedges: 0, vagueWords: 0 };
    this.currentScenario = null;
    this.currentAttack = '';
    this.currentAudio = null;
    this.countdownInterval = null;
    this.ttsActive = false;
    this.asrBlockedUntil = 0;
    this.generating = false;

    this.initElements();
    this.bindEvents();
    this.loadScenarios();
  }

  initElements() {
    this.btnModeFree = document.getElementById('btn-mode-free');
    this.btnModeDrill = document.getElementById('btn-mode-drill');
    this.freeMode = document.getElementById('free-mode');
    this.drillMode = document.getElementById('drill-mode');

    this.drillScenario = document.getElementById('drill-scenario');
    this.drillDifficulty = document.getElementById('drill-difficulty');
    this.drillCountdownSel = document.getElementById('drill-countdown');
    this.btnDrillStart = document.getElementById('btn-drill-start');
    this.btnDrillStop = document.getElementById('btn-drill-stop');
    this.btnDrillSpeak = document.getElementById('btn-drill-speak');
    this.btnDrillSkip = document.getElementById('btn-drill-skip');
    this.btnDrillAgain = document.getElementById('btn-drill-again');
    this.drillAttack = document.getElementById('drill-attack');
    this.drillCountdown = document.getElementById('drill-countdown');
    this.drillResponseText = document.getElementById('drill-response-text');
    this.drillResponseStats = document.getElementById('drill-response-stats');
    this.drillResult = document.getElementById('drill-result');
    this.drillTotal = document.getElementById('drill-total');
    this.drillVerdict = document.getElementById('drill-verdict');
    this.barLogic = document.getElementById('bar-logic');
    this.barStress = document.getElementById('bar-stress');
    this.barPropriety = document.getElementById('bar-propriety');
    this.numLogic = document.getElementById('num-logic');
    this.numStress = document.getElementById('num-stress');
    this.numPropriety = document.getElementById('num-propriety');
    this.drillStrengths = document.getElementById('drill-strengths');
    this.drillIssues = document.getElementById('drill-issues');
    this.drillDirect = document.getElementById('drill-direct');
  }

  bindEvents() {
    this.btnModeFree.addEventListener('click', () => this.switchMode('free'));
    this.btnModeDrill.addEventListener('click', () => this.switchMode('drill'));
    this.btnDrillStart.addEventListener('click', () => this.startDrill(false));
    this.btnDrillStop.addEventListener('click', () => this.stopDrill());
    this.btnDrillSpeak.addEventListener('click', () => this.speak(this.currentAttack));
    this.btnDrillSkip.addEventListener('click', () => this.startDrill(true));
    this.btnDrillAgain.addEventListener('click', () => this.startDrill(true));
  }

  switchMode(mode) {
    this.btnModeFree.classList.toggle('mode-active', mode === 'free');
    this.btnModeDrill.classList.toggle('mode-active', mode === 'drill');
    this.freeMode.classList.toggle('hidden', mode !== 'free');
    this.drillMode.classList.toggle('hidden', mode !== 'drill');
  }

  async loadScenarios() {
    try {
      const list = await window.api.getDrillScenarios();
      this.scenarios = list || [];
      this.drillScenario.innerHTML = this.scenarios
        .map(s => `<option value="${s.id}">${s.name}</option>`)
        .join('');
    } catch (e) {
      this.drillScenario.innerHTML = '<option value="">场景加载失败</option>';
    }
  }

  // ===== 对练流程 =====

  async startDrill(useSeed = false) {
    if (this.generating) return; // 生成中防重入
    this.generating = true;
    try {
      await this._startDrill(useSeed);
    } finally {
      this.generating = false;
    }
  }

  async _startDrill(useSeed = false) {
    // 运行中点击（换一题）：先收尾当前回合
    if (this.isRunning) {
      this.isRunning = false;
      if (this.countdownInterval) clearInterval(this.countdownInterval);
    }
    this.stopAudio();
    await this.teardownMic();

    this.drillResult.classList.add('hidden');
    this.drillCountdown.classList.add('hidden');
    this.drillResponseText.textContent = '倒计时结束立刻开口反驳…';
    this.drillResponseStats.textContent = '';
    this.drillStats = { fillers: 0, hedges: 0, vagueWords: 0 };
    this.responseSentences = [];
    this.responseFullText = '';
    this.firstWordLatencyMs = null;
    this.responseStartAt = null;
    this.asrBlockedUntil = 0;

    const scenario = this.scenarios.find(s => s.id === this.drillScenario.value);
    if (!scenario) return;
    this.currentScenario = scenario;
    const difficulty = this.drillDifficulty.value;
    this.countdownSec = parseInt(this.drillCountdownSel.value, 10);

    // 1. 生成攻击（换一题用本地种子秒出，开始/再来用 AI）
    this.drillAttack.textContent = '⚡ NPC 正在酝酿攻击…';
    this.btnDrillStart.classList.add('hidden');
    this.btnDrillStop.classList.remove('hidden');
    try {
      let attack;
      if (useSeed) {
        const seedRes = await window.api.getSeedAttack(scenario.id, difficulty);
        attack = seedRes.success ? seedRes.attack : null;
      }
      if (!attack) {
        const res = await window.api.generateAttack(scenario, difficulty);
        if (!res.success) {
          this.drillAttack.textContent = '攻击生成失败，请检查设置里的 AI 后端配置';
          this.btnDrillStart.classList.remove('hidden');
          this.btnDrillStop.classList.add('hidden');
          return;
        }
        attack = res.attack;
      }
      this.currentAttack = attack;
      this.drillAttack.textContent = `「${attack}」`;
      // 出题后自动播报，播完才开始倒计时
      await this.speak(attack);
    } catch (e) {
      this.drillAttack.textContent = '攻击生成失败: ' + e.message;
      this.btnDrillStart.classList.remove('hidden');
      this.btnDrillStop.classList.add('hidden');
      return;
    }

    // 2. 倒计时
    this.isRunning = true;
    this.runCountdown();
  }

  runCountdown() {
    let remaining = this.countdownSec;
    this.drillCountdown.classList.remove('hidden');
    this.drillCountdown.textContent = remaining;
    this.countdownInterval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(this.countdownInterval);
        this.drillCountdown.textContent = '🔥 开口！';
        this.drillCountdown.style.color = '#ff4444';
        setTimeout(() => { this.drillCountdown.classList.add('hidden'); }, 600);
        this.responseStartAt = Date.now();
        this.drillResponseText.textContent = '现在！用你的方式反驳回去…';
        this.startListening();
      } else {
        this.drillCountdown.textContent = remaining;
      }
    }, 1000);
  }

  // ===== 麦克风 =====

  async startListening() {
    const initResult = await window.api.initASR();
    if (!initResult.success) {
      this.drillResponseText.textContent = '语音识别启动失败: ' + initResult.error;
      this.resetControls();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      const source = this.audioContext.createMediaStreamSource(stream);
      this.audioProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.audioProcessor.onaudioprocess = async (e) => {
        if (!this.isRunning) return;
        // TTS 播放期间丢弃麦克风输入，防止扬声器声音被识别成回击
        if (this.ttsActive || Date.now() < this.asrBlockedUntil) return;
        const samples = e.inputBuffer.getChannelData(0);
        const result = await window.api.feedAudio(samples);
        if (result) this.handleDrillASR(result);
      };
      source.connect(this.audioProcessor);
      this.audioProcessor.connect(this.audioContext.destination);
      this.mediaStream = stream;
    } catch (err) {
      this.drillResponseText.textContent = '麦克风访问失败: ' + err.message;
      this.resetControls();
    }
  }

  async teardownMic() {
    if (this.audioProcessor) { this.audioProcessor.disconnect(); this.audioProcessor = null; }
    if (this.audioContext) { this.audioContext.close(); this.audioContext = null; }
    if (this.mediaStream) { this.mediaStream.getTracks().forEach(t => t.stop()); this.mediaStream = null; }
    await window.api.stopASR();
  }

  // ===== ASR 结果处理 =====

  handleDrillASR({ text, isFinal }) {
    if (!this.firstWordLatencyMs && this.responseStartAt && text) {
      this.firstWordLatencyMs = Date.now() - this.responseStartAt;
    }
    if (isFinal && text) {
      this.responseSentences.push(text);
      this.responseFullText += text;
      this.analyzeDrillSentence(text);
    }
    this.renderDrillResponse(text, isFinal);
  }

  async analyzeDrillSentence(text) {
    const analysis = await window.api.analyzeText(text);
    if (analysis) {
      this.drillStats.fillers += analysis.fillers.length;
      this.drillStats.hedges += analysis.hedges.length;
      this.drillStats.vagueWords += analysis.vagueWords.length;
      this.renderDrillStats();
    }
  }

  renderDrillResponse(text, isFinal) {
    const lines = this.responseSentences.slice(-3);
    const interim = isFinal ? '' : text;
    let html = lines.map(l => `<div>${this.highlightText(l)}</div>`).join('');
    if (interim) html += `<div style="color:#aaa;">${interim}</div>`;
    this.drillResponseText.innerHTML = html;
  }

  highlightText(text) {
    let result = text;
    const vagueWords = ['开心','难过','害怕','生气','不舒服','很好','很多','很快','很大','很小','好看','不好','喜欢','讨厌','觉得','想想'];
    vagueWords.forEach(w => {
      result = result.replace(new RegExp(w, 'g'), `<span class="vague">${w}</span>`);
    });
    const fillerPatterns = /(嗯|啊|呃|额|那个|就是|然后|这个|对吧|是吧|反正|基本上)/g;
    result = result.replace(fillerPatterns, '<span class="filler">$1</span>');
    const hedgePatterns = /(可能|也许|大概|应该|我觉得|好像|似乎|或许|不一定|差不多|感觉)/g;
    result = result.replace(hedgePatterns, '<span class="hedge">$1</span>');
    return result;
  }

  renderDrillStats() {
    const latency = this.firstWordLatencyMs ? (this.firstWordLatencyMs / 1000).toFixed(1) : '--';
    this.drillResponseStats.innerHTML = `
      <span>⚡ 响应时延: <span class="drill-stat-${this.latencyColor(this.firstWordLatencyMs)}">${latency} 秒</span></span>
      <span>🔴 填充词: ${this.drillStats.fillers}</span>
      <span>🟠 犹豫词: ${this.drillStats.hedges}</span>
      <span>🟡 笼统词: ${this.drillStats.vagueWords}</span>
    `;
  }

  latencyColor(ms) {
    if (ms == null) return 'orange';
    if (ms <= 3000) return 'red';
    if (ms <= 5000) return 'orange';
    return 'yellow';
  }

  // ===== 提交评分 =====

  async stopDrill() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.countdownInterval) clearInterval(this.countdownInterval);
    this.stopAudio();
    await this.teardownMic();

    this.btnDrillStop.classList.add('hidden');
    this.btnDrillStart.classList.remove('hidden');

    this.drillResponseStats.innerHTML = `正在评分…（响应时延 ${this.firstWordLatencyMs ? (this.firstWordLatencyMs / 1000).toFixed(1) : '--'} 秒）`;
    this.drillResult.classList.remove('hidden');
    this.drillResult.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const round = {
      scenario: this.currentScenario,
      attack: this.currentAttack,
      response: this.responseFullText.trim(),
      latencySec: this.firstWordLatencyMs ? +(this.firstWordLatencyMs / 1000).toFixed(1) : null,
      stats: { ...this.drillStats }
    };

    try {
      const res = await window.api.evaluateDrill(round);
      if (res.success && res.result) {
        this.renderResult(res.result);
      } else {
        this.renderError(res.error);
      }
    } catch (e) {
      this.renderError(e.message);
    }
  }

  renderResult(r) {
    this.drillTotal.textContent = r.totalScore ?? '--';
    this.drillVerdict.textContent = r.verdict || '';
    this.setBar(this.barLogic, this.numLogic, r.logicScore);
    this.setBar(this.barStress, this.numStress, r.stressScore);
    this.setBar(this.barPropriety, this.numPropriety, r.proprietyScore);

    this.drillStrengths.innerHTML = (r.strengths || []).map(s => `<li>${s}</li>`).join('') || '<li style="color:#555;">—</li>';
    this.drillIssues.innerHTML = (r.issues || []).map(s => `<li>${s}</li>`).join('') || '<li style="color:#555;">—</li>';
    this.drillDirect.textContent = r.directVersion || '';

    this.drillResponseStats.innerHTML = `
      <span>⚡ 响应时延: ${this.roundLatencyDisplay()} 秒</span>
      <span>🔴 填充词: ${this.drillStats.fillers}</span>
      <span>🟠 犹豫词: ${this.drillStats.hedges}</span>
      <span>🟡 笼统词: ${this.drillStats.vagueWords}</span>
    `;
    this.drillResult.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  roundLatencyDisplay() {
    return this.firstWordLatencyMs ? (this.firstWordLatencyMs / 1000).toFixed(1) : '--';
  }

  setBar(barEl, numEl, score) {
    const v = Math.max(0, Math.min(100, score || 0));
    barEl.style.width = v + '%';
    numEl.textContent = v;
  }

  renderError(msg) {
    this.drillResponseStats.innerHTML = `<span style="color:#ff6b6b;">评分失败: ${msg}</span>`;
  }

  resetControls() {
    this.isRunning = false;
    this.btnDrillStop.classList.add('hidden');
    this.btnDrillStart.classList.remove('hidden');
  }

  // ===== TTS 朗读（sherpa/edge 音频播放，系统语音兜底） =====

  stopAudio() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.onended = null;
      this.currentAudio.onerror = null;
      this.currentAudio.src = '';
      this.currentAudio = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  /**
   * 播报语音，返回 Promise（播放结束 resolve）
   * 播放期间屏蔽麦克风识别，防止扬声器声音被当成用户回击
   */
  speak(text) {
    const clean = (text || '').replace(/[「」『』]/g, '').trim();
    if (!clean) return Promise.resolve();
    this.stopAudio();
    this.ttsActive = true;
    this.asrBlockedUntil = Date.now() + 10000; // 保守兜底：10s 后强制恢复识别

    return new Promise((resolve) => {
      const finish = () => {
        this.ttsActive = false;
        this.asrBlockedUntil = 0;
        resolve();
      };

      window.api.speak(clean).then((res) => {
        if (res && res.base64) {
          const audio = new Audio(`data:${res.mime};base64,${res.base64}`);
          this.currentAudio = audio;
          audio.onended = finish;
          audio.onerror = finish;
          audio.play().catch(() => {
            this.currentAudio = null;
            this.ttsActive = false;
            this.asrBlockedUntil = 0;
            this.speakSystem(clean, finish);
          });
        } else {
          this.speakSystem(clean, finish);
        }
      }).catch(() => {
        this.speakSystem(clean, finish);
      });
    });
  }

  speakSystem(text, done) {
    if (!window.speechSynthesis) {
      if (done) done();
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 1.05;
    u.onend = () => { if (done) done(); };
    u.onerror = () => { if (done) done(); };
    window.speechSynthesis.speak(u);
  }
}

document.addEventListener('DOMContentLoaded', () => { new DrillTrainer(); });
