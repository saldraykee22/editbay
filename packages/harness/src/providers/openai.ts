import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatUsage,
  ModelInfo,
  Provider,
  ProviderConfig,
  ToolCall,
  ToolSpec,
} from '../types';
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  emptyResponseError,
  isOpenRouterHost,
  joinUrl,
  mergeHeaders,
  parseArguments,
  sendRequest,
  type FetchLike,
} from './base';

export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
export const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';

export interface OpenAICompatibleOptions {
  id?: string;
  label?: string;
  requiresApiKey?: boolean;
  defaultBaseUrl?: string;
  defaultModel?: string;
  /** Extra headers for white-labelled gateways. */
  extraHeaders?: Record<string, string>;
  /** Injection point for tests; defaults to global fetch. */
  fetchImpl?: FetchLike;
}

/**
 * OpenAI-compatible `/chat/completions` provider.
 *
 * Works for OpenAI, OpenRouter, Groq, LM Studio, Ollama and any gateway that
 * implements the same schema. Function tools are sent as `function` schemas
 * and `tool_calls` are parsed back into harness `ToolCall`s.
 */
export function createOpenAICompatibleProvider(options: OpenAICompatibleOptions = {}): Provider {
  const id = options.id ?? 'openai';
  const label = options.label ?? 'OpenAI';
  const defaultBaseUrl = options.defaultBaseUrl ?? OPENAI_DEFAULT_BASE_URL;
  const defaultModel = options.defaultModel ?? OPENAI_DEFAULT_MODEL;
  const requiresApiKey = options.requiresApiKey ?? true;

  const chat = async (req: ChatRequest, config: ProviderConfig = {}): Promise<ChatResponse> => {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new Error('No fetch implementation available for provider requests');
    }
    const baseUrl = config.baseUrl?.trim() || defaultBaseUrl;
    const url = joinUrl(baseUrl, 'chat/completions');
    const model = config.model?.trim() || req.model?.trim() || defaultModel;

    const headers = mergeHeaders(
      {
        'content-type': 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        ...(isOpenRouterHost(url)
          ? { 'HTTP-Referer': 'https://editbay.app', 'X-Title': 'Editbay' }
          : {}),
        ...(options.extraHeaders ?? {}),
      },
      config.headers,
    );

    const body: Record<string, unknown> = {
      model,
      messages: toOpenAIMessages(req.messages),
      stream: false,
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    if (req.tools !== undefined && req.tools.length > 0) {
      body.tools = req.tools.map(toOpenAITool);
      body.tool_choice = 'auto';
    }

    const parsed = await sendRequest(
      fetchImpl,
      url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        ...(req.signal !== undefined ? { signal: req.signal } : {}),
      },
      label,
    );

    return parsed.isSse ? aggregateOpenAIStream(parsed.sseEvents, label) : parseOpenAIResponse(parsed.payload, label);
  };

  const listModels = async (config: ProviderConfig = {}): Promise<ModelInfo[]> => {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const baseUrl = config.baseUrl?.trim() || defaultBaseUrl;
    const url = joinUrl(baseUrl, 'models');
    const headers = mergeHeaders(
      {
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        ...(options.extraHeaders ?? {}),
      },
      config.headers,
    );
    const parsed = await sendRequest(fetchImpl, url, { method: 'GET', headers }, label);
    const record = asRecord(parsed.payload);
    const data = asArray(record?.data ?? record?.models);
    const models: ModelInfo[] = [];
    for (const item of data) {
      const entry = asRecord(item);
      const modelId = asString(entry?.id) ?? asString(entry?.name);
      if (!modelId) continue;
      models.push({ id: modelId, label: asString(entry?.name) ?? modelId });
    }
    return models;
  };

  return {
    id,
    label,
    requiresApiKey,
    defaultBaseUrl,
    defaultModel,
    chat,
    listModels,
  };
}

export const openaiProvider: Provider = createOpenAICompatibleProvider();

/* ------------------------------------------------------------------ */
/* Request mapping                                                     */
/* ------------------------------------------------------------------ */

function toOpenAITool(tool: ToolSpec): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function toOpenAIMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId ?? '',
        content: message.content,
        ...(message.name ? { name: message.name } : {}),
      };
    }
    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: message.content === '' ? null : message.content,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments ?? {}),
          },
        })),
      };
    }
    return { role: message.role, content: message.content };
  });
}

/* ------------------------------------------------------------------ */
/* Response mapping                                                    */
/* ------------------------------------------------------------------ */

function parseOpenAIResponse(payload: unknown, label: string): ChatResponse {
  const record = asRecord(payload);
  if (!record) {
    throw new Error(`Unexpected response shape from ${label}: expected a JSON object`);
  }
  const choice = asRecord(asArray(record.choices)[0]);
  const message = asRecord(choice?.message);
  const text = extractContent(message?.content);
  const toolCalls = parseToolCalls(message?.tool_calls);
  const usage = parseUsage(record.usage);
  const finishReason = asString(choice?.finish_reason);

  if (text === '' && toolCalls.length === 0) {
    throw emptyResponseError(label);
  }

  return {
    text,
    toolCalls,
    ...(usage !== undefined ? { usage } : {}),
    ...(finishReason !== undefined ? { finishReason } : {}),
  };
}

function aggregateOpenAIStream(events: unknown[], label: string): ChatResponse {
  let text = '';
  let finishReason: string | undefined;
  let usage: ChatUsage | undefined;
  const calls = new Map<number, { id: string; name: string; arguments: string }>();

  for (const event of events) {
    const record = asRecord(event);
    if (!record) continue;
    const choice = asRecord(asArray(record.choices)[0]);
    const delta = asRecord(choice?.delta);
    const content = extractContent(delta?.content);
    if (content !== '') text += content;
    if (asString(choice?.finish_reason) !== undefined) {
      finishReason = asString(choice?.finish_reason);
    }
    const eventUsage = parseUsage(record.usage);
    if (eventUsage !== undefined) usage = eventUsage;

    for (const [index, rawCall] of asArray(delta?.tool_calls).entries()) {
      const call = asRecord(rawCall);
      if (!call) continue;
      const callIndex = asNumber(call.index) ?? index;
      const existing = calls.get(callIndex) ?? { id: '', name: '', arguments: '' };
      const fn = asRecord(call.function);
      calls.set(callIndex, {
        id: asString(call.id) ?? existing.id,
        name: asString(fn?.name) ?? existing.name,
        arguments: existing.arguments + (asString(fn?.arguments) ?? ''),
      });
    }
  }

  const toolCalls: ToolCall[] = [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, call]) => ({
      id: call.id || `call_${index}`,
      name: call.name,
      arguments: parseArguments(call.arguments),
    }))
    .filter((call) => call.name !== '');

  if (text === '' && toolCalls.length === 0) throw emptyResponseError(label);

  return {
    text,
    toolCalls,
    ...(usage !== undefined ? { usage } : {}),
    ...(finishReason !== undefined ? { finishReason } : {}),
  };
}

function extractContent(content: unknown): string {
  if (typeof content === 'string') return content;
  const parts = asArray(content);
  const texts: string[] = [];
  for (const part of parts) {
    const record = asRecord(part);
    const text = asString(record?.text);
    if (text !== undefined) texts.push(text);
  }
  return texts.join('');
}

function parseToolCalls(value: unknown): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const [index, rawCall] of asArray(value).entries()) {
    const call = asRecord(rawCall);
    const fn = asRecord(call?.function);
    const name = asString(fn?.name);
    if (!name) continue;
    calls.push({
      id: asString(call?.id) ?? `call_${index}`,
      name,
      arguments: parseArguments(fn?.arguments),
    });
  }
  return calls;
}

function parseUsage(value: unknown): ChatUsage | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return {
    inputTokens: asNumber(record.prompt_tokens) ?? 0,
    outputTokens: asNumber(record.completion_tokens) ?? 0,
  };
}
