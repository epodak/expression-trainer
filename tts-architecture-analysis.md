# Expression Trainer 文本转语音 (TTS) 架构与技术路线分析

## 核心结论

当前 AI 在帮您运行的 **表达训练系统 (expression-trainer)** 项目，采用了 **三级自动降级 (Fallback) 的 TTS 架构**。

在实际运行时，它优先使用 **本地离线神经网络引擎 (`sherpa-onnx` + MeloTTS)**；如果本地模型缺失或推理异常，会自动无缝切换到 **在线微软神经语音 (`edge-tts`)** 或 **操作系统本地语音引擎 (`speechSynthesis`)**。

---

## 三层 TTS 引擎详细解析

```
                      ┌──────────────────────────────┐
                      │    TTS 合成请求 (text)       │
                      └──────────────┬───────────────┘
                                     │
                      ┌──────────────▼───────────────┐
                      │ 1. sherpa-onnx + MeloTTS     │───(成功)───► [播放 WAV]
                      │    (本地离线 / VITS 神经网络)  │
                      └──────────────┬───────────────┘
                                  (失败/未下载)
                                     │
                      ┌──────────────▼───────────────┐
                      │ 2. edge-tts (微软神经语音)   │───(成功)───► [播放 MP3]
                      │    (zh-CN-XiaoxiaoNeural)    │
                      └──────────────┬───────────────┘
                                  (失败/无网络)
                                     │
                      ┌──────────────▼───────────────┐
                      │ 3. HTML5 speechSynthesis     │───(兜底)───► [系统发音]
                      │    (系统自带 SAPI5 / Web API)│
                      └──────────────────────────────┘
```

### 1. 主力引擎：`sherpa-onnx` + MeloTTS (本地完全离线)
* **核心模型**：`vits-melo-tts-zh_en`（基于 VITS 深度学习架构的中英双语语音合成模型 MeloTTS）。
* **推理框架**：`sherpa-onnx-node`（使用新一代 Kaldi / Sherpa 团队开发的高性能 C++ ONNX Runtime 引擎绑定）。
* **文本正则化 (Text Normalization)**：内置了 `date.fst`、`phone.fst`、`number.fst` 等有限状态自动机，自动处理阿拉伯数字、电话号码、日期格式的准确发音。
* **数据流实现**：C++ 层推理输出 `Float32` 原始音频采样点，Node.js 主进程实时封装为 `audio/wav` 格式 Buffer，通过 Base64 传递给 Electron 渲染进程播放。

### 2. 二级备用引擎：`edge-tts` (微软 Azure 神经语音)
* **技术原理**：通过调用 Python `edge-tts` 库直接与微软 Edge/Azure 神经语音云端服务通信。
* **默认音色**：`zh-CN-XiaoxiaoNeural`（微软经典自然音色“晓晓”），语速设为 `+8%`。
* **生成格式**：MP3 音频流。

### 3. 三级兜底引擎：Web SpeechSynthesis API (浏览器 / 系统自带)
* **技术原理**：Electron 前端 `window.speechSynthesis` 接口。
* **特点**：零延迟、无需下载网络资源，使用 Windows 操作系统原生的 TTS 语音引擎（如 SAPI5 / Windows 默认中文语音包）。

---

## 关键代码映射

* **引擎调度中心**：[`lib/tts.js`](file:///d:/_AI/10_DOING/expression-trainer/lib/tts.js#L124-L154)
* **模型目录结构**：`models/vits-melo-tts-zh_en/` (`model.onnx`, `lexicon.txt`, `tokens.txt`, `*.fst`)
* **前端播放调用**：[`src/drill.js`](file:///d:/_AI/10_DOING/expression-trainer/src/drill.js#L328-L352)

---

## 总结

您听到的自然声音，大概率为：
1. **本地离线模型**：`MeloTTS`（如果已下载模型文件，特点是完全无网络延迟、声音自然度高）；
2. **在线微软神经语音**：`Edge TTS (晓晓)`（如果未放置本地 ONNX 模型，特点是极高的人声抑扬顿挫自然度）。
