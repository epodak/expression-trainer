## 2026-08-10 | 高压对抗模拟器（Stress Response Simulator）落地
**问题核心**：「我和 AI 讨论的几个东西（高压对抗/反射台账融合/口音微调/TTS/iPhone 移植），你觉得哪一个方向是现在可以做的？」
**方向信号**：从 6 份讨论文档中筛出「现在可做」vs「依赖外部条件」vs「做不了」，指向把既有 ASR+词库+LLM 基础设施复用起来、能立刻产生实用价值的那个方向 —— 高压对抗模拟器。
**决策**：实施「高压对抗模拟器」模式（AI NPC 诘难 → 倒计时 → ASR 极速反驳 → 多维评分），LLM 用 OpenCode 的 DeepSeek（`~/token.bashrc` 的 DEEPSEEK_API_KEY + `https://opencode.ai/zen/go/v1` + deepseek-v4-flash），并顺带实现 NPC 攻击台词 TTS 朗读 → [dev_log 高压对抗模拟器](../_dev_log/2026-08-10_高压对抗模拟器.md)
---
