import { useEffect, useState } from 'react';
import { Button, Chip, Field, Input, Select, Section } from '@editbay/ui';
import { PROVIDERS, getApiKey, providerPreset, setApiKey, type AppSettings } from '../state/settings';

export function SettingsPanel({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
}) {
  const preset = providerPreset(settings.providerId);
  const [apiKey, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [oauthBusy, setOauthBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void getApiKey(settings.providerId).then((key) => {
      if (!alive) return;
      setHasKey(Boolean(key));
      setKey('');
    });
    return () => {
      alive = false;
    };
  }, [settings.providerId]);

  const update = (patch: Partial<AppSettings>) => onChange({ ...settings, ...patch });

  const saveKey = async () => {
    await setApiKey(settings.providerId, apiKey);
    setHasKey(Boolean(apiKey.trim()));
    setTestResult(apiKey.trim() ? 'Key saved to the OS keychain.' : 'Key removed.');
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    const response = await window.editbay.llm.chat({
      providerId: settings.providerId,
      model: settings.model,
      baseUrl: settings.baseUrl,
      messages: [
        { role: 'system', content: 'Reply with exactly: ok' },
        { role: 'user', content: 'ping' },
      ],
      maxTokens: 8,
    });
    setTesting(false);
    setTestResult(response.error ? `Failed: ${response.error}` : `Connected · ${response.text.slice(0, 40) || 'ok'}`);
  };

  const connectOpenRouter = async () => {
    setOauthBusy(true);
    const result = await window.editbay.auth.openrouter();
    setOauthBusy(false);
    if (result.ok) {
      setHasKey(true);
      setTestResult('OpenRouter connected. Pick a model below.');
      update({ providerId: 'openrouter', baseUrl: providerPreset('openrouter').baseUrl });
    } else {
      setTestResult(`OpenRouter failed: ${result.error ?? 'unknown error'}`);
    }
  };

  return (
    <div className="scroll-y">
      <Section title="Model">
        <Field label="Provider">
          <Select
            value={settings.providerId}
            onChange={(event) => {
              const next = providerPreset(event.target.value);
              update({ providerId: next.id, baseUrl: next.baseUrl, model: next.defaultModel });
              setTestResult(null);
            }}
          >
            {PROVIDERS.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="hint">{preset.hint}</div>

        <Field label="Model">
          <Input
            value={settings.model}
            list="model-list"
            onChange={(event) => update({ model: event.target.value })}
            placeholder="model id"
          />
          <datalist id="model-list">
            {preset.models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </Field>

        <Field label="Base URL">
          <Input value={settings.baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} />
        </Field>

        {settings.providerId === 'openrouter' ? (
          <div className="proposal">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="dot-live" />
              <span style={{ fontSize: 12 }}>OAuth connect — no key to copy</span>
            </div>
            <div className="hint">Opens your browser, then returns here. The key is stored encrypted by the OS.</div>
            <div className="row">
              <Button size="sm" variant="primary" onClick={connectOpenRouter} disabled={oauthBusy} icon="external">
                {oauthBusy ? 'Waiting for browser…' : 'Connect OpenRouter'}
              </Button>
            </div>
          </div>
        ) : null}

        <Field label="API key" hint={hasKey ? 'A key is stored for this provider.' : 'Stored in the OS keychain, never written to project files.'}>
          <Input
            type="password"
            value={apiKey}
            placeholder={hasKey ? '••••••••••••  (stored)' : 'sk-…'}
            onChange={(event) => setKey(event.target.value)}
          />
        </Field>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button size="sm" onClick={saveKey} icon="save">
            Save key
          </Button>
          <Button size="sm" variant="ghost" onClick={test} disabled={testing} icon="bolt">
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
        </div>
        {testResult ? (
          <div className="hint" style={{ color: testResult.startsWith('Failed') ? 'var(--danger)' : 'var(--accent)' }}>
            {testResult}
          </div>
        ) : null}
      </Section>

      <div className="hairline" />

      <Section title="Behaviour">
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={settings.autoApply}
            onChange={(event) => update({ autoApply: event.target.checked })}
          />
          <span style={{ fontSize: 12.5 }}>Apply edits immediately</span>
        </label>
        <div className="hint">
          When off, Editbay proposes a change set and waits for your approval. Undo works either way.
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={settings.showSafeArea}
            onChange={(event) => update({ showSafeArea: event.target.checked })}
          />
          <span style={{ fontSize: 12.5 }}>Show title-safe guides</span>
        </label>
      </Section>

      <div className="hairline" />

      <Section title="Privacy">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip tone="accent">Local-first</Chip>
          <Chip>No upload</Chip>
          <Chip>BYOK</Chip>
        </div>
        <div className="hint">
          Video, audio and images never leave this machine. Only the prompt text, asset labels, timeline summary and the
          skills you enable are sent to the model you choose.
        </div>
      </Section>
    </div>
  );
}
