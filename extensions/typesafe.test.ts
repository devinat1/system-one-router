import { describe, expect, it, vi } from 'vitest';
import type { Context } from '@earendil-works/pi-ai';
import type { RouterTier, SystemOneClassifierConfig } from './types';
import {
  runSystemOneClassifier,
  type SystemOneFetch,
} from './typesafe';

const config: SystemOneClassifierConfig = {
  provider: 'typesafe',
  type: 'system-one',
  model: 'jev-latest',
  timeoutMs: 30,
};

const context: Context = {
  messages: [
    { role: 'user', content: 'Classify this request.', timestamp: Date.now() },
  ],
};

const responseFor = (
  choice: RouterTier,
  confidence = 0.8,
  probabilities: Record<RouterTier, number> = {
    high: 0.1,
    medium: 0.2,
    low: 0.7,
  },
) => ({
  ok: true,
  status: 200,
  json: async () => ({
    model: 'jev-latest',
    answers: {
      tier: { type: 'choice', choice, confidence, probabilities },
    },
    usage: { input_tokens: 10, output_tokens: 5 },
  }),
});

describe('typesafe.ts', () => {
  it.each(['high', 'medium', 'low'] as const)(
    'accepts the %s tier, including zero confidence',
    async (tier) => {
      const probabilities: Record<RouterTier, number> = {
        high: tier === 'high' ? 0.8 : 0.1,
        medium: tier === 'medium' ? 0.8 : 0.1,
        low: tier === 'low' ? 0.8 : 0.1,
      };
      const result = await runSystemOneClassifier(config, context, undefined, {
        apiKey: 'test-key',
        fetch: vi.fn(async () => responseFor(tier, 0, probabilities)) as unknown as SystemOneFetch,
      });

      expect(result).toEqual({
        ok: true,
        classification: { tier, confidence: 0, probability: 0.8 },
      });
    },
  );

  it('uses the returned choice to resolve tied probabilities and bounds state', async () => {
    const request = vi.fn(async (_input: string, _init: RequestInit) => responseFor('low', 0, {
      high: 0.5,
      medium: 0,
      low: 0.5,
    }));
    const longContext: Context = {
      messages: [
        { role: 'user', content: 'x'.repeat(9_000), timestamp: Date.now() },
      ],
    };

    const result = await runSystemOneClassifier(config, longContext, 'planning', {
      apiKey: 'test-key',
      fetch: request as unknown as SystemOneFetch,
    });
    expect(result).toEqual({
      ok: true,
      classification: { tier: 'low', confidence: 0, probability: 0.5 },
    });

    const call = request.mock.calls[0];
    if (!call) throw new Error('Expected TypeSafe fetch to be called.');
    const [, init] = call;
    const body = JSON.parse(init.body as string) as {
      state: { latestMessage: string; recentHistory: string; currentPhase: string };
      questions: { tier: { type: string } };
    };
    expect(body.state.latestMessage).toHaveLength(8_000);
    expect(body.state.recentHistory).toHaveLength(8_000);
    expect(body.state.currentPhase).toBe('planning');
    expect(body.questions.tier.type).toBe('choice');
  });

  it('returns sanitized failures for missing credentials, HTTP errors, and malformed output', async () => {
    const missingKey = await runSystemOneClassifier(config, context, undefined, {
      apiKey: '   ',
    });
    expect(missingKey).toEqual({ ok: false, reason: 'missing-api-key' });

    const httpError = await runSystemOneClassifier(config, context, undefined, {
      apiKey: 'test-key',
      fetch: vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as SystemOneFetch,
    });
    expect(httpError).toEqual({ ok: false, reason: 'http-error' });

    const malformedJson = await runSystemOneClassifier(config, context, undefined, {
      apiKey: 'test-key',
      fetch: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('malformed JSON');
        },
      })) as unknown as SystemOneFetch,
    });
    expect(malformedJson).toEqual({ ok: false, reason: 'invalid-response' });

    const invalidTier = await runSystemOneClassifier(config, context, undefined, {
      apiKey: 'test-key',
      fetch: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ answers: { tier: { type: 'choice', choice: 'invalid' } } }),
      })) as unknown as SystemOneFetch,
    });
    expect(invalidTier).toEqual({ ok: false, reason: 'invalid-response' });

    const nonFiniteFields = await runSystemOneClassifier(config, context, undefined, {
      apiKey: 'test-key',
      fetch: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          answers: {
            tier: {
              type: 'choice',
              choice: 'low',
              confidence: Number.NaN,
              probabilities: { high: 0.1, medium: 0.2, low: Number.NaN },
            },
          },
        }),
      })) as unknown as SystemOneFetch,
    });
    expect(nonFiniteFields).toEqual({ ok: false, reason: 'invalid-response' });

    const networkError = await runSystemOneClassifier(config, context, undefined, {
      apiKey: 'secret-key',
      fetch: vi.fn(async () => {
        throw new Error('secret-key leaked by transport');
      }) as unknown as SystemOneFetch,
    });
    expect(networkError).toEqual({ ok: false, reason: 'network-error' });
  });

  it('treats timeout and caller cancellation as terminal failures', async () => {
    const waitingFetch = vi.fn((_, init: RequestInit) => new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as SystemOneFetch;

    const timeout = await runSystemOneClassifier(
      { ...config, timeoutMs: 1 },
      context,
      undefined,
      { apiKey: 'test-key', fetch: waitingFetch },
    );
    expect(timeout).toEqual({ ok: false, reason: 'request-timeout' });

    const controller = new AbortController();
    const cancelledRequest = runSystemOneClassifier(config, context, undefined, {
      apiKey: 'test-key',
      fetch: waitingFetch,
      signal: controller.signal,
    });
    controller.abort();
    await expect(cancelledRequest).resolves.toEqual({
      ok: false,
      reason: 'request-cancelled',
    });
  });
});
