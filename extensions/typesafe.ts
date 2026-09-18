import type { Context } from '@earendil-works/pi-ai';
import type {
  RouterPhase,
  RouterTier,
  SystemOneClassifierConfig,
} from './types';
import { isRouterTier } from './config';
import { getLastUserText, getRecentConversationText } from './routing';

const TYPESAFE_SYSTEM_ONE_URL = 'https://api.typesafe.ai/v1/systemone';
const MAX_CLASSIFIER_TEXT_LENGTH = 8_000;

export type SystemOneClassifierFailure =
  | 'missing-api-key'
  | 'request-cancelled'
  | 'request-timeout'
  | 'http-error'
  | 'network-error'
  | 'invalid-response';

export interface SystemOneClassification {
  tier: RouterTier;
  confidence: number;
  probability: number;
}

export type SystemOneClassifierResult =
  | { ok: true; classification: SystemOneClassification }
  | { ok: false; reason: SystemOneClassifierFailure };

export interface SystemOneResponse {
  readonly ok: boolean;
  readonly status: number;
  json: () => Promise<unknown>;
}

export type SystemOneFetch = (
  input: string,
  init: RequestInit,
) => Promise<SystemOneResponse>;

export interface SystemOneClassifierOptions {
  apiKey?: string;
  fetch?: SystemOneFetch;
  signal?: AbortSignal;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isProbability = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

const limitStart = (value: string): string =>
  value.slice(0, MAX_CLASSIFIER_TEXT_LENGTH);

const limitEnd = (value: string): string =>
  value.slice(-MAX_CLASSIFIER_TEXT_LENGTH);

const parseClassification = (
  value: unknown,
): SystemOneClassification | undefined => {
  if (!isRecord(value) || !isRecord(value.answers) || !isRecord(value.answers.tier)) {
    return undefined;
  }

  const answer = value.answers.tier;
  if (answer.type !== 'choice' || !isRouterTier(answer.choice)) return undefined;
  if (!isProbability(answer.confidence) || !isRecord(answer.probabilities)) {
    return undefined;
  }

  const probabilities = answer.probabilities;
  const tiers: RouterTier[] = ['high', 'medium', 'low'];
  if (!tiers.every((tier) => isProbability(probabilities[tier]))) {
    return undefined;
  }
  const probability = probabilities[answer.choice];
  if (!isProbability(probability)) return undefined;

  return {
    // Choice is the System One API's highest-probability result, including ties.
    tier: answer.choice,
    confidence: answer.confidence,
    probability,
  };
};

const defaultFetch: SystemOneFetch = (input, init) => fetch(input, init);

export const runSystemOneClassifier = async (
  config: SystemOneClassifierConfig,
  context: Context,
  currentPhase: RouterPhase | undefined,
  options: SystemOneClassifierOptions = {},
): Promise<SystemOneClassifierResult> => {
  const apiKey = (options.apiKey ?? process.env.TYPESAFE_API_KEY)?.trim();
  if (!apiKey) return { ok: false, reason: 'missing-api-key' };
  if (options.signal?.aborted) {
    return { ok: false, reason: 'request-cancelled' };
  }

  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.timeoutMs);

  try {
    const response = await (options.fetch ?? defaultFetch)(
      TYPESAFE_SYSTEM_ONE_URL,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: config.model,
          state: {
            latestMessage: limitStart(getLastUserText(context)),
            recentHistory: limitEnd(getRecentConversationText(context, 4)),
            currentPhase: currentPhase ?? null,
          },
          questions: {
            tier: {
              type: 'choice',
              instructions:
                'Classify the user\'s latest request into the routing tier that best fits its scope. Use the current conversation phase as context, but choose based on the request itself.',
              criteria: {
                high: 'Architecture, design, planning, tradeoff analysis, broad debugging, large refactors, codebase research.',
                medium: 'Implementation of a known plan, multi-file edits, normal coding work, focused debugging, tests or fixes.',
                low: 'Summaries, changelogs, formatting, quick explanations, small bounded transforms, simple read-only lookup.',
              },
            },
          },
        }),
      },
    );

    if (!response.ok) return { ok: false, reason: 'http-error' };

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, reason: 'invalid-response' };
    }

    const classification = parseClassification(body);
    return classification
      ? { ok: true, classification }
      : { ok: false, reason: 'invalid-response' };
  } catch {
    if (options.signal?.aborted) {
      return { ok: false, reason: 'request-cancelled' };
    }
    return {
      ok: false,
      reason: timedOut ? 'request-timeout' : 'network-error',
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
};
