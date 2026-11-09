import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatResponse, ProviderConfig } from './types';
import { asArray, asRecord, ProviderError, type FetchLike } from './providers/base';
import { createOpenAICompatibleProvider } from './providers/openai';
import { createAnthropicProvider } from './providers/anthropic';
import { createGeminiProvider } from './providers/gemini';
import { createProvider, listProviderMetadata, PROVIDERS } from './providers/index';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

const toolSpec = {
  name: 'apply_commands',
  description: 'Apply edits',
  parameters: { type: 'object', properties: { commands: { type: 'array' } } },
};

describe('OpenAI-compatible provider', () => {
  it('maps tools, tool messages and tool_calls in both directions', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl: FetchLike = async (input, init) => {
      captured = { url: String(input), init: init ?? {} };
      return jsonResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'apply_commands', arguments: '{"commands":[{"op":"undo"}]}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 4 },
      });
    };
    const provider = createOpenAICompatibleProvider({ fetchImpl });
    const messages: ChatMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'cut the intro' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_0', name: 'read_project', arguments: {} }],
      },
      { role: 'tool', content: '{"ok":true}', toolCallId: 'call_0', name: 'read_project' },
    ];

    const response = await provider.chat(
      { model: 'gpt-test', messages, tools: [toolSpec] },
      { apiKey: 'sk-test' },
    );

    expect(captured?.url).toBe('https://api.openai.com/v1/chat/completions');
    const headers = new Headers(captured?.init.headers);
    expect(headers.get('authorization')).toBe('Bearer sk-test');
    expect(headers.get('HTTP-Referer')).toBeNull();

    const body = bodyOf(captured?.init);
    expect(body.model).toBe('gpt-test');
    const tools = asArray(body.tools);
    expect(asRecord(tools[0])?.type).toBe('function');
    expect(asRecord(asRecord(tools[0])?.function)?.name).toBe('apply_commands');
    const sent = asArray(body.messages);
    const assistant = asRecord(sent[2]);
    expect(asArray(assistant?.tool_calls)).toHaveLength(1);
    expect(asRecord(sent[3])?.tool_call_id).toBe('call_0');

    expect(response.toolCalls).toEqual([
      { id: 'call_1', name: 'apply_commands', arguments: { commands: [{ op: 'undo' }] } },
    ]);
    expect(response.usage).toEqual({ inputTokens: 12, outputTokens: 4 });
    expect(response.finishReason).toBe('tool_calls');
  });

  it('returns text and supports a custom baseUrl', async () => {
    let url = '';
    const fetchImpl: FetchLike = async (input) => {
      url = String(input);
      return jsonResponse({ choices: [{ message: { content: 'Ready.' }, finish_reason: 'stop' }] });
    };
    const provider = createOpenAICompatibleProvider({ fetchImpl });

    const response = await provider.chat(
      { model: 'local', messages: [{ role: 'user', content: 'hi' }] },
      { baseUrl: 'http://127.0.0.1:1234/v1' },
    );

    expect(url).toBe('http://127.0.0.1:1234/v1/chat/completions');
    expect(response.text).toBe('Ready.');
    expect(response.toolCalls).toEqual([]);
  });

  it('adds OpenRouter attribution headers only on OpenRouter hosts', async () => {
    let headers: Headers | undefined;
    const fetchImpl: FetchLike = async (_input, init) => {
      headers = new Headers(init?.headers);
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    };
    const provider = createOpenAICompatibleProvider({ fetchImpl });

    await provider.chat(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or' },
    );

    expect(headers?.get('HTTP-Referer')).toBe('https://editbay.app');
    expect(headers?.get('X-Title')).toBe('Editbay');
  });

  it('aggregates SSE chunks', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}',
      'data: [DONE]',
      '',
    ].join('\n');
    const fetchImpl: FetchLike = async () =>
      new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    const provider = createOpenAICompatibleProvider({ fetchImpl });

    const response = await provider.chat(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      {},
    );
    expect(response.text).toBe('Hello');
    expect(response.usage).toEqual({ inputTokens: 2, outputTokens: 1 });
  });

  it('maps 401 and 429 to readable ProviderErrors', async () => {
    const unauthorized = createOpenAICompatibleProvider({
      fetchImpl: async () => new Response('bad key', { status: 401 }),
    });
    const authError = await unauthorized
      .chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }, {})
      .catch((error: unknown) => error);
    expect(authError).toBeInstanceOf(ProviderError);
    expect((authError as ProviderError).status).toBe(401);
    expect((authError as Error).message).toMatch(/API key rejected/);

    const limited = createOpenAICompatibleProvider({
      fetchImpl: async () => new Response('slow down', { status: 429 }),
    });
    await expect(
      limited.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }, {}),
    ).rejects.toThrow(/Rate limited/);
  });

  it('exposes a Retry-After header as retryAfterMs', async () => {
    const limited = createOpenAICompatibleProvider({
      fetchImpl: async () =>
        new Response('slow down', {
          status: 429,
          headers: { 'retry-after': '2' },
        }),
    });
    const error = await limited
      .chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }, {})
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).retryAfterMs).toBe(2000);
  });

  it('maps network failures and empty or malformed responses', async () => {
    const offline = createOpenAICompatibleProvider({
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(
      offline.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }, {}),
    ).rejects.toThrow(/Provider unreachable/);

    const empty = createOpenAICompatibleProvider({
      fetchImpl: async () => jsonResponse({ choices: [{ message: { content: '' } }] }),
    });
    await expect(
      empty.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }, {}),
    ).rejects.toThrow(/EMPTY_RESPONSE/);

    const malformed = createOpenAICompatibleProvider({
      fetchImpl: async () =>
        new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    await expect(
      malformed.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }, {}),
    ).rejects.toThrow(/Invalid JSON response/);
  });
});

describe('Anthropic provider', () => {
  it('separates system, maps tool_use and tool_result blocks, and usage', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl: FetchLike = async (input, init) => {
      captured = { url: String(input), init: init ?? {} };
      return jsonResponse({
        content: [
          { type: 'text', text: 'Checking the timeline.' },
          { type: 'tool_use', id: 'toolu_1', name: 'read_project', input: { detail: 'full' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 20, output_tokens: 7 },
      });
    };
    const provider = createAnthropicProvider({ fetchImpl });
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are Editbay.' },
      { role: 'user', content: 'what is on screen?' },
      { role: 'assistant', content: 'Let me look.', toolCalls: [{ id: 'toolu_0', name: 'read_project', arguments: {} }] },
      { role: 'tool', content: '{"ok":true}', toolCallId: 'toolu_0', name: 'read_project' },
    ];

    const response = await provider.chat(
      { model: 'claude-test', messages, tools: [toolSpec], maxTokens: 512 },
      { apiKey: 'sk-ant' },
    );

    expect(captured?.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = new Headers(captured?.init.headers);
    expect(headers.get('x-api-key')).toBe('sk-ant');
    expect(headers.get('anthropic-version')).toBe('2023-06-01');

    const body = bodyOf(captured?.init);
    expect(body.system).toBe('You are Editbay.');
    expect(body.max_tokens).toBe(512);
    const sent = asArray(body.messages);
    expect(sent).toHaveLength(3);
    expect(asRecord(sent[0])?.role).toBe('user');
    const assistantBlocks = asArray(asRecord(sent[1])?.content);
    expect(asRecord(assistantBlocks[0])?.type).toBe('text');
    expect(asRecord(assistantBlocks[1])?.type).toBe('tool_use');
    const toolBlocks = asArray(asRecord(sent[2])?.content);
    expect(asRecord(toolBlocks[0])).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'toolu_0',
    });
    const tools = asArray(body.tools);
    expect(asRecord(tools[0])?.input_schema).toEqual(toolSpec.parameters);

    expect(response.text).toBe('Checking the timeline.');
    expect(response.toolCalls).toEqual([
      { id: 'toolu_1', name: 'read_project', arguments: { detail: 'full' } },
    ]);
    expect(response.usage).toEqual({ inputTokens: 20, outputTokens: 7 });
    expect(response.finishReason).toBe('tool_use');
  });
});

describe('Gemini provider', () => {
  it('maps systemInstruction, functionCall and functionResponse', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl: FetchLike = async (input, init) => {
      captured = { url: String(input), init: init ?? {} };
      return jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                { text: 'Listing assets.' },
                { functionCall: { name: 'list_assets', args: { scope: 'all' } } },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 3 },
      });
    };
    const provider = createGeminiProvider({ fetchImpl });
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Be precise.' },
      { role: 'user', content: 'list assets' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'list_assets', arguments: {} }] },
      { role: 'tool', content: '{"ok":true}', toolCallId: 'c1', name: 'list_assets' },
    ];

    const response = await provider.chat(
      { model: 'gemini-test', messages, tools: [toolSpec] },
      { apiKey: 'gm-key' },
    );

    expect(captured?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent',
    );
    const headers = new Headers(captured?.init.headers);
    expect(headers.get('x-goog-api-key')).toBe('gm-key');

    const body = bodyOf(captured?.init);
    const systemParts = asArray(asRecord(body.systemInstruction)?.parts);
    expect(asRecord(systemParts[0])?.text).toBe('Be precise.');
    const tools = asArray(body.tools);
    const declarations = asArray(asRecord(tools[0])?.functionDeclarations);
    expect(asRecord(declarations[0])?.name).toBe('apply_commands');
    const contents = asArray(body.contents);
    expect(contents.map((entry) => asRecord(entry)?.role)).toEqual(['user', 'model', 'user']);
    const fnResponse = asRecord(asArray(asRecord(contents[2])?.parts)[0])?.functionResponse;
    expect(asRecord(fnResponse)?.name).toBe('list_assets');

    expect(response.text).toBe('Listing assets.');
    expect(response.toolCalls).toEqual([
      { id: 'call_1', name: 'list_assets', arguments: { scope: 'all' } },
    ]);
    expect(response.usage).toEqual({ inputTokens: 9, outputTokens: 3 });
  });

  it('preserves thought parts and thoughtSignature across a round-trip', async () => {
    let requests = 0;
    let secondBody: Record<string, unknown> = {};
    const fetchImpl: FetchLike = async (_input, init) => {
      requests += 1;
      if (requests === 1) {
        return jsonResponse({
          candidates: [
            {
              content: {
                parts: [
                  { text: 'I will trim the intro.', thought: true },
                  {
                    functionCall: {
                      name: 'apply_commands',
                      args: { commands: [{ op: 'trim_clip', clipId: 'clip-1', inMs: 500 }] },
                    },
                    thoughtSignature: 'sig_123',
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        });
      }
      secondBody = bodyOf(init);
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: 'Done.' }] }, finishReason: 'STOP' }],
      });
    };

    const provider = createGeminiProvider({ fetchImpl });
    const first = await provider.chat(
      { model: 'gemini-3-pro', messages: [{ role: 'user', content: 'trim the intro' }] },
      {},
    );

    // Reasoning text is kept out of the answer but preserved for the follow-up.
    expect(first.text).toBe('');
    expect(first.thoughts).toBe('I will trim the intro.');
    expect(first.toolCalls[0]?.thoughtSignature).toBe('sig_123');

    await provider.chat(
      {
        model: 'gemini-3-pro',
        messages: [
          { role: 'user', content: 'trim the intro' },
          {
            role: 'assistant',
            content: first.text,
            thoughts: first.thoughts,
            toolCalls: first.toolCalls,
          },
          {
            role: 'tool',
            content: '{"ok":true}',
            toolCallId: first.toolCalls[0]?.id,
            name: 'apply_commands',
          },
        ],
      },
      {},
    );

    const contents = asArray(secondBody.contents);
    const modelParts = asArray(asRecord(contents[1])?.parts);
    const thoughtPart = modelParts.map(asRecord).find((part) => part?.thought === true);
    expect(thoughtPart?.text).toBe('I will trim the intro.');
    const functionPart = modelParts.map(asRecord).find((part) => part?.functionCall !== undefined);
    expect(functionPart?.thoughtSignature).toBe('sig_123');
  });
});

describe('provider registry', () => {
  it('exposes the required provider ids and metadata', () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual([
      'anthropic',
      'gemini',
      'groq',
      'lmstudio',
      'ollama',
      'openai',
      'openrouter',
    ]);
    const ids = listProviderMetadata().map((item) => item.id);
    expect(ids).toEqual(['openrouter', 'openai', 'anthropic', 'gemini', 'groq', 'lmstudio', 'ollama']);
    expect(listProviderMetadata().find((item) => item.id === 'lmstudio')?.requiresApiKey).toBe(false);
  });

  it('creates configured providers and rejects unknown ids', () => {
    const provider = createProvider('groq', { model: 'custom-model', baseUrl: 'https://example.test/v1' });
    expect(provider.id).toBe('groq');
    expect(provider.defaultModel).toBe('custom-model');
    expect(provider.defaultBaseUrl).toBe('https://example.test/v1');
    expect(() => createProvider('nope')).toThrow(/Unknown provider/);
  });

  it('passes merged config into chat', async () => {
    let captured: { url: string; apiKey: string | null } | undefined;
    const config: ProviderConfig = {
      baseUrl: 'https://example.test/v1',
      apiKey: 'cfg-key',
      headers: { 'x-custom': 'one' },
    };
    const provider = createProvider('openai', config);
    // The registry provider uses global fetch, so replace it for this call via a per-call config.
    const configured = provider;
    const fetchImpl: FetchLike = async (input, init) => {
      captured = { url: String(input), apiKey: new Headers(init?.headers).get('authorization') };
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const response: ChatResponse = await configured.chat({
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
      }, { headers: { 'x-custom': 'two' } });
      expect(response.text).toBe('ok');
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(captured?.url).toBe('https://example.test/v1/chat/completions');
    expect(captured?.apiKey).toBe('Bearer cfg-key');
  });
});
