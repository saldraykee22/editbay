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
  joinUrl,
  mergeHeaders,
  parseArguments,
  sendRequest,
  type FetchLike,
} from './base';

export const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';

export interface GeminiProviderOptions {
  id?: string;
  label?: string;
  requiresApiKey?: boolean;
  defaultBaseUrl?: string;
  defaultModel?: string;
  /** Injection point for tests; defaults to global fetch. */
  fetchImpl?: FetchLike;
}

/**
 * Google Gemini `generateContent` provider.
 *
 * System messages become `systemInstruction`, assistant turns use the `model`
 * role, and tool results become `functionResponse` parts in user turns.
 */
export function createGeminiProvider(options: GeminiProviderOptions = {}): Provider {
  const id = options.id ?? 'gemini';
  const label = options.label ?? 'Google Gemini';
  const defaultBaseUrl = options.defaultBaseUrl ?? GEMINI_DEFAULT_BASE_URL;
  const defaultModel = options.defaultModel ?? GEMINI_DEFAULT_MODEL;
  const requiresApiKey = options.requiresApiKey ?? true;

  const chat = async (req: ChatRequest, config: ProviderConfig = {}): Promise<ChatResponse> => {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const baseUrl = config.baseUrl?.trim() || defaultBaseUrl;
    const model = config.model?.trim() || req.model?.trim() || defaultModel;
    const url = joinUrl(baseUrl, `models/${encodeURIComponent(stripModelPrefix(model))}:generateContent`);
    const { systemInstruction, contents } = toGeminiContents(req.messages);

    const headers = mergeHeaders(
      {
        'content-type': 'application/json',
        ...(config.apiKey ? { 'x-goog-api-key': config.apiKey } : {}),
      },
      config.headers,
    );

    const body: Record<string, unknown> = { contents };
    if (systemInstruction !== null) body.systemInstruction = systemInstruction;
    if (req.tools !== undefined && req.tools.length > 0) {
      body.tools = [{ functionDeclarations: req.tools.map(toGeminiTool) }];
    }
    if (req.temperature !== undefined || req.maxTokens !== undefined) {
      body.generationConfig = {
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.maxTokens !== undefined ? { maxOutputTokens: req.maxTokens } : {}),
      };
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

    return parseGeminiResponse(parsed.payload, label);
  };

  const listModels = async (config: ProviderConfig = {}): Promise<ModelInfo[]> => {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const baseUrl = config.baseUrl?.trim() || defaultBaseUrl;
    const url = joinUrl(baseUrl, 'models');
    const headers = mergeHeaders(
      {
        ...(config.apiKey ? { 'x-goog-api-key': config.apiKey } : {}),
      },
      config.headers,
    );
    const parsed = await sendRequest(fetchImpl, url, { method: 'GET', headers }, label);
    const record = asRecord(parsed.payload);
    const models: ModelInfo[] = [];
    for (const item of asArray(record?.models)) {
      const entry = asRecord(item);
      const rawName = asString(entry?.name);
      if (!rawName) continue;
      const modelId = stripModelPrefix(rawName);
      models.push({
        id: modelId,
        label: asString(entry?.displayName) ?? modelId,
        ...(asNumber(entry?.inputTokenLimit) !== undefined
          ? { contextWindow: asNumber(entry?.inputTokenLimit) }
          : {}),
      });
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

export const geminiProvider: Provider = createGeminiProvider();

/* ------------------------------------------------------------------ */
/* Request mapping                                                     */
/* ------------------------------------------------------------------ */

function toGeminiTool(tool: ToolSpec): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

interface GeminiContents {
  systemInstruction: { parts: Array<{ text: string }> } | null;
  contents: Array<{ role: 'user' | 'model'; parts: Array<Record<string, unknown>> }>;
}

function toGeminiContents(messages: ChatMessage[]): GeminiContents {
  const systems: string[] = [];
  const contents: GeminiContents['contents'] = [];

  const push = (role: 'user' | 'model', parts: Array<Record<string, unknown>>): void => {
    if (parts.length === 0) return;
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push(...parts);
      return;
    }
    contents.push({ role, parts });
  };

  for (const message of messages) {
    if (message.role === 'system') {
      if (message.content.trim() !== '') systems.push(message.content);
      continue;
    }
    if (message.role === 'tool') {
      push('user', [
        {
          functionResponse: {
            name: message.name ?? 'tool',
            response: toolResponsePayload(message.content),
          },
        },
      ]);
      continue;
    }
    if (message.role === 'assistant') {
      const parts: Array<Record<string, unknown>> = [];
      if (message.content !== '') parts.push({ text: message.content });
      for (const call of message.toolCalls ?? []) {
        parts.push({ functionCall: { name: call.name, args: call.arguments } });
      }
      push('model', parts);
      continue;
    }
    push('user', [{ text: message.content }]);
  }

  return {
    systemInstruction:
      systems.length > 0 ? { parts: [{ text: systems.join('\n\n') }] } : null,
    contents,
  };
}

function toolResponsePayload(content: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(content);
    const record = asRecord(parsed);
    return record ?? { content };
  } catch {
    return { content };
  }
}

/* ------------------------------------------------------------------ */
/* Response mapping                                                    */
/* ------------------------------------------------------------------ */

function parseGeminiResponse(payload: unknown, label: string): ChatResponse {
  const record = asRecord(payload);
  if (!record) {
    throw new Error(`Unexpected response shape from ${label}: expected a JSON object`);
  }
  const candidate = asRecord(asArray(record.candidates)[0]);
  const content = asRecord(candidate?.content);

  const texts: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const [index, rawPart] of asArray(content?.parts).entries()) {
    const part = asRecord(rawPart);
    const text = asString(part?.text);
    if (text !== undefined) texts.push(text);

    const functionCall = asRecord(part?.functionCall);
    const name = asString(functionCall?.name);
    if (name) {
      toolCalls.push({
        id: asString(functionCall?.id) ?? `call_${index}`,
        name,
        arguments: parseArguments(functionCall?.args),
      });
    }
  }

  const text = texts.join('');
  if (text === '' && toolCalls.length === 0) throw emptyResponseError(label);

  const usage = parseUsage(record.usageMetadata);
  const finishReason = asString(candidate?.finishReason);

  return {
    text,
    toolCalls,
    ...(usage !== undefined ? { usage } : {}),
    ...(finishReason !== undefined ? { finishReason } : {}),
  };
}

function parseUsage(value: unknown): ChatUsage | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return {
    inputTokens: asNumber(record.promptTokenCount) ?? 0,
    outputTokens: asNumber(record.candidatesTokenCount) ?? 0,
  };
}

function stripModelPrefix(model: string): string {
  return model.replace(/^models\//, '');
}
