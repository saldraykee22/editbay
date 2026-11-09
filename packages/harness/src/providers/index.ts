import type { Provider, ProviderConfig } from '../types';
import { createAnthropicProvider, anthropicProvider } from './anthropic';
import { createGeminiProvider, geminiProvider } from './gemini';
import { createOpenAICompatibleProvider, openaiProvider } from './openai';

export * from './base';
export * from './openai';
export * from './anthropic';
export * from './gemini';

export interface ProviderMetadata {
  id: string;
  label: string;
  requiresApiKey: boolean;
  defaultBaseUrl: string;
  defaultModel: string;
}

export const PROVIDER_METADATA: readonly ProviderMetadata[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    requiresApiKey: true,
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/auto',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-5',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    requiresApiKey: true,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
  },
  {
    id: 'groq',
    label: 'Groq',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    requiresApiKey: false,
    defaultBaseUrl: 'http://127.0.0.1:1234/v1',
    defaultModel: 'local-model',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    requiresApiKey: false,
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'llama3.2',
  },
];

export const openrouterProvider: Provider = createOpenAICompatibleProvider({
  id: 'openrouter',
  label: 'OpenRouter',
  requiresApiKey: true,
  defaultBaseUrl: 'https://openrouter.ai/api/v1',
  defaultModel: 'openrouter/auto',
});

export const groqProvider: Provider = createOpenAICompatibleProvider({
  id: 'groq',
  label: 'Groq',
  requiresApiKey: true,
  defaultBaseUrl: 'https://api.groq.com/openai/v1',
  defaultModel: 'llama-3.3-70b-versatile',
});

export const lmstudioProvider: Provider = createOpenAICompatibleProvider({
  id: 'lmstudio',
  label: 'LM Studio',
  requiresApiKey: false,
  defaultBaseUrl: 'http://127.0.0.1:1234/v1',
  defaultModel: 'local-model',
});

export const ollamaProvider: Provider = createOpenAICompatibleProvider({
  id: 'ollama',
  label: 'Ollama',
  requiresApiKey: false,
  defaultBaseUrl: 'http://127.0.0.1:11434/v1',
  defaultModel: 'llama3.2',
});

/** Provider instances keyed by id. */
export const PROVIDERS: Readonly<Record<string, Provider>> = {
  openrouter: openrouterProvider,
  openai: openaiProvider,
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  groq: groqProvider,
  lmstudio: lmstudioProvider,
  ollama: ollamaProvider,
};

export const providerRegistry = PROVIDERS;

export function listProviderMetadata(): ProviderMetadata[] {
  return PROVIDER_METADATA.map((metadata) => ({ ...metadata }));
}

export function getProviderMetadata(id: string): ProviderMetadata {
  const metadata = PROVIDER_METADATA.find((entry) => entry.id === id);
  if (!metadata) throw new Error(unknownProviderMessage(id));
  return { ...metadata };
}

export function getProvider(id: string): Provider {
  const provider = PROVIDERS[id];
  if (!provider) throw new Error(unknownProviderMessage(id));
  return provider;
}

/**
 * Create a provider with default configuration baked in. Per-call config wins
 * over these defaults, and headers are merged.
 */
export function createProvider(id: string, config: ProviderConfig = {}): Provider {
  const base = getProvider(id);
  const merge = (overrides: ProviderConfig): ProviderConfig => ({
    ...config,
    ...overrides,
    headers: { ...(config.headers ?? {}), ...(overrides.headers ?? {}) },
  });

  const configured: Provider = {
    id: base.id,
    label: base.label,
    requiresApiKey: base.requiresApiKey,
    defaultBaseUrl: config.baseUrl?.trim() || base.defaultBaseUrl,
    defaultModel: config.model?.trim() || base.defaultModel,
    chat: (req, perCall = {}) => base.chat(req, merge(perCall)),
  };
  if (base.listModels) {
    const listModels = base.listModels.bind(base);
    configured.listModels = (perCall = {}) => listModels(merge(perCall));
  }
  return configured;
}

export { createAnthropicProvider, createGeminiProvider, createOpenAICompatibleProvider };

function unknownProviderMessage(id: string): string {
  const ids = PROVIDER_METADATA.map((entry) => entry.id).join(', ');
  return `Unknown provider "${id}". Available providers: ${ids}`;
}
