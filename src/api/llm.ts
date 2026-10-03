import { LlmError, classifyLlmError } from './llmErrors';
/**
 * 通用 OpenAI 兼容 Chat Completions 封装
 *
 * 原版只写死了 DeepSeek 的 reasoner 模型与官方地址。
 * 现在服务商、地址、模型、温度全部来自 LLMConfig，可接任何 OpenAI 兼容端点。
 */

import type { LLMConfig } from '@/types/cards';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  config: LLMConfig;
  /** 使用的模型；缺省用 config.narrativeModel */
  model?: string;
  stream?: boolean;
  /** 覆盖 config.temperature */
  temperature?: number;
  /** 要求返回 JSON 对象（部分服务商支持） */
  jsonMode?: boolean;
  signal?: AbortSignal;
}

export interface ProviderPreset {
  id: LLMConfig['provider'];
  label: string;
  baseUrl: string;
  /** 供 UI 下拉的候选模型 */
  models: string[];
  /** 是否需要 API Key（本地 ollama 不需要） */
  needsKey: boolean;
  keyUrl?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek 官方',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    needsKey: true,
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'],
    needsKey: true,
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: [
      'deepseek-ai/DeepSeek-V3',
      'deepseek-ai/DeepSeek-R1',
      'Qwen/Qwen2.5-72B-Instruct',
      'Qwen/Qwen3-235B-A22B',
    ],
    needsKey: true,
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      'deepseek/deepseek-chat',
      'anthropic/claude-3.5-sonnet',
      'google/gemini-2.0-flash-001',
      'meta-llama/llama-3.3-70b-instruct',
    ],
    needsKey: true,
    keyUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'ollama',
    label: 'Ollama（本地）',
    baseUrl: 'http://localhost:11434/v1',
    models: ['qwen2.5:14b', 'llama3.1:8b', 'mistral-nemo'],
    needsKey: false,
  },
  {
    id: 'custom',
    label: '自定义 OpenAI 兼容端点',
    baseUrl: '',
    models: [],
    needsKey: true,
  },
];

export const DEFAULT_LLM_CONFIG: LLMConfig = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  narrativeModel: 'deepseek-chat',
  analysisModel: 'deepseek-chat',
  temperature: 0.8,
  showReasoning: false,
};

export function getPreset(provider: LLMConfig['provider']): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find(p => p.id === provider);
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  // 用户可能填 https://host（不带 /v1），也可能填到 /v1/chat/completions
  if (/\/chat\/completions$/.test(base)) return base;
  return `${base}${suffix}`;
}

function buildBody(opts: ChatOptions, stream: boolean): string {
  const { messages, config, model, temperature, jsonMode } = opts;
  const body: Record<string, unknown> = {
    model: model || config.narrativeModel,
    messages,
    stream,
  };

  // 推理模型通常拒绝 temperature / response_format，只在明确安全时附带
  const modelName = String(body.model).toLowerCase();
  const isReasoner = /reasoner|(^|[-_/])r1($|[-_/])|o1|o3|thinking/.test(modelName);

  if (!isReasoner && typeof (temperature ?? config.temperature) === 'number') {
    body.temperature = temperature ?? config.temperature;
  }
  if (jsonMode && !isReasoner) {
    body.response_format = { type: 'json_object' };
  }
  return JSON.stringify(body);
}

/**
 * 发起一次对话请求。
 * stream=true 时返回原始 Response（交给调用方读取 SSE），否则返回解析后的 JSON。
 *
 * 关于重试（这是关键设计，别退化成"失败就算了"）：
 * 「叙事 AI」和「数据 AI」两段流水线里，任何一段因网络抖动失败，
 * 整轮就白跑了 —— 玩家投入几十秒等待与一次 API 费用，最后只得到一句报错。
 * 所以对**可重试**的错误（限流 / 5xx / 网络 / 超时）自动退避重试；
 * 对**不可重试**的（Key 无效、余额不足、模型名错）立刻失败 ——
 * 那类问题重试一百次也不会好，只会浪费时间与配额。
 *
 * 流式请求（stream=true）不在此处重试：SSE 一旦开始吐字就已经产生了副作用，
 * 重试会导致叙事内容重复。它的重试放在调用方按「整轮」粒度处理。
 */
export async function llmChat(opts: ChatOptions): Promise<any | Response> {
  const { config, stream = false, signal } = opts;
  const url = joinUrl(config.baseUrl, '/chat/completions');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  const body = buildBody(opts, stream);
  const maxAttempts = stream ? 1 : RETRY_MAX_ATTEMPTS;

  let lastErr: LlmError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 用户已取消就别再发请求了
    if (signal?.aborted) throw new LlmError(classifyLlmError(undefined, '', { name: 'AbortError' }));

    try {
      const response = await fetch(url, { method: 'POST', headers, body, signal });

      if (response.ok) {
        if (stream) return response;
        return response.json();
      }

      const errorText = await response.text().catch(() => '');
      const info = classifyLlmError(response.status, errorText);
      lastErr = new LlmError(info);

      // 不可重试 → 立刻抛出（例如 Key 无效、余额不足）
      if (!info.retryable || attempt === maxAttempts) throw lastErr;

      await backoff(attempt, signal);
    } catch (e) {
      // 已经是我们包装过的，直接决定是否继续
      if (e instanceof LlmError) {
        if (!e.info.retryable || attempt === maxAttempts) throw e;
        lastErr = e;
        await backoff(attempt, signal);
        continue;
      }
      // 网络层异常（断网 / DNS / 连接被重置）
      const info = classifyLlmError(undefined, '', e);
      lastErr = new LlmError(info);
      if (info.kind === 'aborted') throw lastErr;
      if (!info.retryable || attempt === maxAttempts) throw lastErr;
      await backoff(attempt, signal);
    }
  }

  throw lastErr || new LlmError(classifyLlmError(undefined, '', '未知错误'));
}

/** 非流式请求的最大尝试次数（1 次原始 + 2 次重试） */
const RETRY_MAX_ATTEMPTS = 3;

/**
 * 指数退避 + 抖动。
 * 抖动很重要：两段流水线若同时被限流，固定间隔会让它们同步重试、继续互相挤。
 */
function backoff(attempt: number, signal?: AbortSignal): Promise<void> {
  const base = 700 * Math.pow(2, attempt - 1);   // 700ms → 1400ms
  const jitter = Math.random() * 400;
  const ms = Math.min(base + jitter, 8000);

  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new LlmError(classifyLlmError(undefined, '', { name: 'AbortError' })));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new LlmError(classifyLlmError(undefined, '', { name: 'AbortError' })));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface ParsedChunk {
  content?: string;
  reasoning?: string;
}

/** 解析一行 SSE data，返回其中的增量文本 */
export function parseSseLine(line: string): ParsedChunk | null {
  if (!line.startsWith('data:')) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;
  try {
    const json = JSON.parse(payload);
    const delta = json.choices?.[0]?.delta || json.choices?.[0]?.message || {};
    const chunk: ParsedChunk = {};
    if (typeof delta.content === 'string' && delta.content) chunk.content = delta.content;
    const reasoning = delta.reasoning_content ?? delta.reasoning;
    if (typeof reasoning === 'string' && reasoning) chunk.reasoning = reasoning;
    return chunk.content || chunk.reasoning ? chunk : null;
  } catch {
    return null;
  }
}

/** 从非流式响应里取出正文 */
export function extractContent(response: any): string {
  const message = response?.choices?.[0]?.message;
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  // 部分服务商返回 content 数组
  if (Array.isArray(message.content)) {
    return message.content.map((c: any) => (typeof c === 'string' ? c : c?.text || '')).join('');
  }
  return '';
}

/** 快速连通性测试 */
export async function testConnection(config: LLMConfig): Promise<void> {
  await llmChat({
    messages: [{ role: 'user', content: 'ping' }],
    config,
    model: config.analysisModel || config.narrativeModel,
    stream: false,
  });
}
