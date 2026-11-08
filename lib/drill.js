/**
 * 高压对抗训练模块 (Stress Response Simulator)
 * AI 扮演刁钻 NPC 诘难 → 用户极速反驳 → 多维评分
 */

const { getProviderConfig, callAPI } = require('./ai-feedback');

// ===== 场景库 =====
const SCENARIOS = [
  {
    id: 'workplace',
    name: '职场被否定/抢功',
    npcRole: '强势的上级或刁钻的同事',
    seeds: {
      easy: [
        '你这个方案我看过了，完全不行，重做吧。',
        '这么简单的事你都要做这么久？效率呢？'
      ],
      medium: [
        '这个项目明明是我推的，你凭什么写进你的汇报里？',
        '上次那个错误就是你的责任，别想推给别人。'
      ],
      hard: [
        '你带的这个项目三个月了还在原地，数据呢？指标呢？就拿出这种结果给老板看？',
        '你方案里引用的数据我核过了，假的。你做不了可以直说，别浪费团队时间。'
      ]
    }
  },
  {
    id: 'personal',
    name: '突发人身攻击/辱骂',
    npcRole: '情绪失控的客户或挑衅者',
    seeds: {
      easy: [
        '你怎么回事？这点事都办不明白？',
        '你说话怎么这么没水平？'
      ],
      medium: [
        '你们公司就派你这种人来糊弄我？当我好骗是吧？',
        '就你这态度，也配谈什么专业？'
      ],
      hard: [
        '你懂什么？你连最基本的东西都不懂就在这儿胡说八道，你家里人知道你这么没出息吗？',
        '我看你就是故意的，垃圾！你是不是根本就没想过要认真做事？'
      ]
    }
  },
  {
    id: 'interview',
    name: '高压面试/质询',
    npcRole: '严苛的面试官或审计人员',
    seeds: {
      easy: [
        '你简历上写的能力，刚才一个都没体现出来。',
        '你怎么看待你刚才回答中的逻辑漏洞？'
      ],
      medium: [
        '如果明天就要上线，你只有半天时间，你会砍掉哪些功能？为什么？',
        '你上一份工作离职的真实原因是什么？我听说你业绩不达标。'
      ],
      hard: [
        '你刚才说的方案成本要八十万，而竞争对手用一半的钱就能做。给我三个理由，为什么还要用你？',
        '这个数字和标准流程对不上，你能现场给我推演一遍你的计算逻辑吗？'
      ]
    }
  }
];

function getScenarios() {
  return SCENARIOS;
}

function getSeedAttacks(scenarioId, difficulty) {
  const scenario = SCENARIOS.find(s => s.id === scenarioId);
  if (!scenario) return ['说点什么让我听听。'];
  const list = scenario.seeds[difficulty] || scenario.seeds.easy;
  return list[Math.floor(Math.random() * list.length)];
}

// ===== 攻击生成 =====
async function generateAttack(scenario, difficulty, settings, customPrompt) {
  const config = getProviderConfig(settings);
  const customBlock = customPrompt?.goals
    ? `\n\n用户训练目标：${customPrompt.goals}`
    : '';

  const messages = [
    {
      role: 'system',
      content: `你是中文表达训练系统里的「高压诘难者 NPC」。根据给定场景与角色，用最刁钻、最逼真、最让人血脉偾张的口气说出 1~2 句攻击/质问/否定的话。

要求：
- 只输出台词本身，不加引号、不加角色名、不加任何解释
- 语气要像真实高压场景：用细节攻击、抢功、质疑能力、施加时间压力、甚至人身攻击
- 难度越高，语气越狠、逻辑陷阱越深
- 每句 10~35 个字，让受训者真的感到被逼到墙角`
    },
    {
      role: 'user',
      content: `场景：${scenario.name}
NPC 角色：${scenario.npcRole}
难度：${difficulty === 'easy' ? '简单（客气但否定）' : difficulty === 'hard' ? '困难（尖锐、人身攻击、设陷阱）' : '中等（施压、质疑、逼问）'}
${customBlock}

请输出攻击台词。`
    }
  ];

  try {
    const text = await callAPI(config.endpoint, config.apiKey, config.model, messages, 150);
    const cleaned = (text || '').replace(/^["'「『]|["'」』]$/g, '').trim();
    if (cleaned) return cleaned;
  } catch (e) {
    console.warn('[Drill] 攻击生成失败，使用本地种子台词:', e.message);
  }
  return getSeedAttacks(scenario.id, difficulty);
}

// ===== 回应评估 =====
async function evaluateResponse(round, settings, customPrompt) {
  const config = getProviderConfig(settings);
  const customBlock = customPrompt?.goals
    ? `\n\n用户训练目标（重点考核）：${customPrompt.goals}`
    : '';

  const messages = [
    {
      role: 'system',
      content: `你是高压表达训练系统的评估教练。用户刚刚在高压情境下被攻击后做了口头回应。请严格按下面的 JSON 结构输出，只输出 JSON，不要任何多余文字、markdown 或注释：

{
  "totalScore": 0到100的整数,
  "logicScore": 0到100的整数,
  "stressScore": 0到100的整数,
  "proprietyScore": 0到100的整数,
  "verdict": "一句话总评，不超过40字",
  "strengths": ["亮点1", "亮点2"],
  "issues": ["问题1", "问题2"],
  "directVersion": "把用户回应改写成更直接、更有力、不卑不亢的版本，一句话"
}

评分维度：
- logicScore 逻辑得分：是否用事实、数据、论证反击，而不是情绪化回骂或逃避
- stressScore 抗压得分：响应时延越短越好（3秒内优秀，5秒内良好，超8秒低分）；慌乱填充词越多越低分
- proprietyScore 得体度：不卑不亢、不攻击对方人格、守住边界有分寸
- totalScore 总分（综合三维度）

要求：犀利、直接、有建设性。`
    },
    {
      role: 'user',
      content: `高压场景：${round.scenario.name}（NPC 角色：${round.scenario.npcRole}）
NPC 攻击：${round.attack}
用户回应：${round.response || '（沉默，没有回应）'}
响应时延：${round.latencySec} 秒
填充词：${round.stats?.fillers || 0} 次
犹豫词：${round.stats?.hedges || 0} 次
笼统词：${round.stats?.vagueWords || 0} 次
${customBlock}

请评估。`
    }
  ];

  const text = await callAPI(config.endpoint, config.apiKey, config.model, messages, 600);
  return parseJson(text);
}

/**
 * 从 LLM 输出中稳健地提取 JSON 对象
 */
function parseJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) { /* fallthrough */ }

  // 提取第一个 { ... } 平衡块
  const start = cleaned.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === '{') depth++;
    else if (cleaned[i] === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch (e2) {
          return null;
        }
      }
    }
  }
  return null;
}

module.exports = { getScenarios, generateAttack, evaluateResponse, getSeedAttacks };
