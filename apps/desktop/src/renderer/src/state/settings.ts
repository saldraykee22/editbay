export interface ProviderPreset {
  id: string;
  label: string;
  requiresApiKey: boolean;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  hint: string;
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    requiresApiKey: true,
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-4.5',
    models: [
      'anthropic/claude-sonnet-4.5',
      'anthropic/claude-haiku-4.5',
      'openai/gpt-5.1',
      'google/gemini-3-pro',
      'deepseek/deepseek-v4.1',
      'qwen/qwen3-235b-a22b',
    ],
    hint: 'One key, many models. Connect with OAuth — no key to paste.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    requiresApiKey: true,
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.1',
    models: ['gpt-5.1', 'gpt-5.1-mini', 'o5'],
    hint: 'Use your own OpenAI key.',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    requiresApiKey: true,
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4.5',
    models: ['claude-sonnet-4.5', 'claude-haiku-4.5', 'claude-opus-4.5'],
    hint: 'Claude models through the Messages API.',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    requiresApiKey: true,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-3-pro',
    models: ['gemini-3-pro', 'gemini-3-flash'],
    hint: 'Gemini API key.',
  },
  {
    id: 'groq',
    label: 'Groq',
    requiresApiKey: true,
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-4-70b',
    models: ['llama-4-70b', 'qwen-3-32b'],
    hint: 'Fast inference, OpenAI-compatible.',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    requiresApiKey: false,
    baseUrl: 'http://127.0.0.1:1234/v1',
    defaultModel: 'local-model',
    models: [],
    hint: 'Runs fully offline on your machine.',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    requiresApiKey: false,
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'qwen3:14b',
    models: [],
    hint: 'Runs fully offline on your machine.',
  },
];

export interface AppSettings {
  providerId: string;
  model: string;
  baseUrl: string;
  autoApply: boolean;
  temperature: number;
  showSafeArea: boolean;
}

const STORAGE_KEY = 'editbay.settings.v1';

export function loadSettings(): AppSettings {
  const fallback: AppSettings = {
    providerId: 'openrouter',
    model: PROVIDERS[0]!.defaultModel,
    baseUrl: PROVIDERS[0]!.baseUrl,
    autoApply: true,
    temperature: 0.4,
    showSafeArea: false,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    return fallback;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function providerPreset(id: string): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]!;
}

/** Raw keys never leave the main process; the renderer only learns presence. */
export async function hasApiKey(providerId: string): Promise<boolean> {
  return window.editbay.secrets.has(`provider.${providerId}.apiKey`);
}

export async function setApiKey(
  providerId: string,
  key: string,
): Promise<{ encrypted: boolean }> {
  if (!key.trim()) {
    await window.editbay.secrets.delete(`provider.${providerId}.apiKey`);
    return { encrypted: false };
  }
  return window.editbay.secrets.set(`provider.${providerId}.apiKey`, key.trim());
}
