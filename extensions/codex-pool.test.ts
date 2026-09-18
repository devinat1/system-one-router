import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodexPoolRoute } from './codex-pool';

const { virtualFiles } = vi.hoisted(() => ({
  virtualFiles: new Map<string, string>(),
}));

vi.mock('node:fs', () => ({
  existsSync: (path: string) => virtualFiles.has(path),
  readFileSync: (path: string) => virtualFiles.get(path) ?? '',
}));

vi.mock('@earendil-works/pi-coding-agent', () => ({
  getAgentDir: () => '/mock/agent',
}));

import {
  createCodexPoolSelector,
  isCodexPoolExhaustionError,
  loadCodexPoolRoute,
} from './codex-pool';

const poolConfig = {
  name: 'finc',
  fallbackModel: 'cursor/grok-4.6',
  fallbackThinking: 'high' as const,
};

const route = (members: string[]): CodexPoolRoute => ({
  name: 'finc',
  modelId: 'gpt-5.6-terra',
  members,
  allConfiguredMembersExhausted: false,
  fallbackModel: 'cursor/grok-4.6',
  fallbackThinking: 'high',
});

describe('codex-pool.ts', () => {
  beforeEach(() => {
    virtualFiles.clear();
  });

  it('loads the named round-robin pool and skips persisted cooldowns', () => {
    virtualFiles.set(
      '/mock/agent/multi-pass.json',
      JSON.stringify({
        pools: [
          {
            name: 'finc',
            baseProvider: 'openai-codex',
            members: ['openai-codex', 'openai-codex-2', 'openai-codex-3'],
            enabled: true,
            strategy: 'round-robin',
          },
        ],
      }),
    );
    virtualFiles.set(
      '/mock/agent/multi-pass.state.json',
      JSON.stringify({
        pools: { finc: { 'openai-codex-2': 2_000 } },
      }),
    );

    const loaded = loadCodexPoolRoute(
      poolConfig,
      'openai-codex',
      'gpt-5.6-terra',
      '/project',
      1_000,
    );

    expect(loaded?.members).toEqual(['openai-codex', 'openai-codex-3']);
    expect(loaded?.fallbackThinking).toBe('high');
  });

  it('uses a project pool and allowed subscription list when present', () => {
    virtualFiles.set(
      '/mock/agent/multi-pass.json',
      JSON.stringify({
        pools: [
          {
            name: 'finc',
            baseProvider: 'openai-codex',
            members: ['openai-codex'],
            enabled: true,
            strategy: 'round-robin',
          },
        ],
      }),
    );
    virtualFiles.set(
      '/project/.pi/multi-pass.json',
      JSON.stringify({
        pools: [
          {
            name: 'finc',
            baseProvider: 'openai-codex',
            members: ['openai-codex-2', 'openai-codex-3'],
            enabled: true,
            strategy: 'round-robin',
          },
        ],
        allowedSubs: ['openai-codex-3'],
      }),
    );

    const loaded = loadCodexPoolRoute(
      poolConfig,
      'openai-codex',
      'gpt-5.6-terra',
      '/project',
    );

    expect(loaded?.members).toEqual(['openai-codex-3']);
  });

  it('round-robins new turns and preserves the selected member for a tool continuation', () => {
    const selector = createCodexPoolSelector();
    const configuredRoute = route([
      'openai-codex',
      'openai-codex-2',
      'openai-codex-3',
    ]);

    const first = selector.select(configuredRoute, false, 1_000);
    expect(first.providers).toEqual([
      'openai-codex',
      'openai-codex-2',
      'openai-codex-3',
    ]);
    selector.commit(configuredRoute, 'openai-codex');

    const second = selector.select(configuredRoute, false, 1_001);
    expect(second.providers[0]).toBe('openai-codex-2');
    selector.commit(configuredRoute, 'openai-codex-2');

    const continuation = selector.select(configuredRoute, true, 1_002);
    expect(continuation.providers[0]).toBe('openai-codex-2');
  });

  it('skips a rate-limited member for its retry-after window', () => {
    const selector = createCodexPoolSelector();
    const configuredRoute = route(['openai-codex', 'openai-codex-2']);

    selector.markExhausted(
      configuredRoute,
      'openai-codex',
      'Usage limit reached. Retry after 120 seconds.',
      1_000,
    );

    expect(selector.select(configuredRoute, false, 1_001).providers).toEqual([
      'openai-codex-2',
    ]);
    expect(
      selector.select(configuredRoute, false, 121_001).providers,
    ).toContain('openai-codex');
  });

  it('recognizes Codex quota and overload failures', () => {
    expect(isCodexPoolExhaustionError('The usage limit has been reached')).toBe(
      true,
    );
    expect(isCodexPoolExhaustionError('HTTP 503 capacity')).toBe(true);
    expect(isCodexPoolExhaustionError('invalid tool arguments')).toBe(false);
  });
});
