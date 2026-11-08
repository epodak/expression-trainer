/**
 * 语音朗读模块 (TTS)
 * 三级引擎，自动降级：
 *   1. sherpa-onnx 本地 MeloTTS（离线，音质好）
 *   2. edge-tts（微软在线神经语音，晓晓，需网络 + python）
 *   3. 系统 speechSynthesis（兜底，由渲染进程处理）
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const MODEL_DIR = path.join(__dirname, '..', 'models', 'vits-melo-tts-zh_en');
const REQUIRED_MODEL_FILES = ['model.onnx', 'lexicon.txt', 'tokens.txt'];

let ttsEngine = null;
let engineStatus = null; // 'none' | 'loading' | 'sherpa' | 'edge'

// ===== 模型检测 =====

function hasLocalModel() {
  return REQUIRED_MODEL_FILES.every(f => fs.existsSync(path.join(MODEL_DIR, f)));
}

function getEngineStatus() {
  return engineStatus || (hasLocalModel() ? 'sherpa' : 'edge');
}

// ===== WAV 编码（sherpa 输出 Float32 → wav buffer） =====

function float32ToWav(samples, sampleRate) {
  const numSamples = samples.length;
  const buffer = Buffer.alloc(44 + numSamples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(numSamples * 2, 40);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buffer;
}

// ===== sherpa-onnx 本地引擎 =====

async function initSherpaEngine() {
  if (ttsEngine) return ttsEngine;
  if (!hasLocalModel()) {
    throw new Error('本地 TTS 模型未下载');
  }

  const sherpa = require('sherpa-onnx-node');
  const modelDir = MODEL_DIR;

  const config = {
    model: {
      vits: {
        model: path.join(modelDir, 'model.onnx'),
        tokens: path.join(modelDir, 'tokens.txt'),
        lexicon: path.join(modelDir, 'lexicon.txt'),
      },
      debug: false,
      numThreads: 2,
      provider: 'cpu',
    },
    maxNumSentences: 1,
    ruleFsts: [
      path.join(modelDir, 'date.fst'),
      path.join(modelDir, 'phone.fst'),
      path.join(modelDir, 'number.fst'),
    ].join(','),
  };

  ttsEngine = await sherpa.OfflineTts.createAsync(config);
  console.log('[TTS] sherpa MeloTTS 引擎加载完成', ttsEngine.sampleRate, 'Hz');
  return ttsEngine;
}

// ===== edge-tts 引擎 =====

function edgeTts(text) {
  return new Promise((resolve, reject) => {
    const outFile = path.join(
      os.tmpdir(), `et-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`
    );
    execFile(
      'python', ['-m', 'edge_tts', '--voice', 'zh-CN-XiaoxiaoNeural',
                 '--rate', '+8%', '--text', text, '--write-media', outFile],
      { timeout: 30000, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          try { fs.unlinkSync(outFile); } catch (e) {}
          reject(new Error(`edge-tts 失败: ${err.message}`));
          return;
        }
        if (!fs.existsSync(outFile) || fs.statSync(outFile).size === 0) {
          reject(new Error('edge-tts 未生成音频'));
          return;
        }
        resolve({ audio: fs.readFileSync(outFile), ext: 'mp3' });
      }
    );
  });
}

// ===== 对外接口：合成音频 =====

/**
 * 合成语音
 * @param {string} text
 * @returns {Promise<{engine:string, mime:string, base64:string}>}
 */
async function synthesize(text) {
  const clean = (text || '').replace(/[「」『』]/g, '').trim();
  if (!clean) return { engine: 'none', mime: '', base64: '' };

  // 1. sherpa 本地引擎
  if (hasLocalModel()) {
    try {
      const tts = await initSherpaEngine();
      const audio = await tts.generateAsync({
        text: clean,
        enableExternalBuffer: false,
        generationConfig: { sid: 0, speed: 1.0, silenceScale: 0.2 },
      });
      const wav = float32ToWav(audio.samples, audio.sampleRate);
      return { engine: 'sherpa', mime: 'audio/wav', base64: wav.toString('base64') };
    } catch (e) {
      console.warn('[TTS] sherpa 合成失败，降级到 edge-tts:', e.message);
    }
  }

  // 2. edge-tts
  try {
    const { audio } = await edgeTts(clean);
    return { engine: 'edge', mime: 'audio/mpeg', base64: audio.toString('base64') };
  } catch (e) {
    console.warn('[TTS] edge-tts 合成失败，回退系统语音:', e.message);
  }

  // 3. 系统语音兜底（渲染进程 speechSynthesis）
  return { engine: 'system', mime: '', base64: '' };
}

module.exports = { synthesize, getEngineStatus, hasLocalModel };
