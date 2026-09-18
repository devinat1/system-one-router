import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import type { CodexPoolConfig } from './types';

const DEFAULT_EXHAUSTED_MS = 5 * 60 * 1000;
const MIN_EXHAUSTED_MS = 60 * 1000;
const MAX_EXHAUSTED_MS = 30 * 60 * 1000;

interface MultiPassPool {
  name: string;
  baseProvider: 'openai-codex';
  members: string[];
  enabled: boolean;
  strategy: 'round-robin';
}

interface MultiPassProjectConfig {
  pools?: MultiPassPool[];
  allowedSubs?: string[];
}

interface PersistedPoolState {
  pools: Record<string, Record<string, number>>;
}

export interface CodexPoolRoute {
  name: string;
  modelId: string;
  members: string[];
  allConfiguredMembersExhausted: boolean;
  fallbackModel: string;
  fallbackThinking: CodexPoolConfig['fallbackThinking'];
}

export interface CodexPoolPlan {
  providers: string[];
  allMembersExhausted: boolean;
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCodexProvider = (value: unknown): value is string =>
  typeof value === 'string' &&
  (value === 'openai-codex' || /^openai-codex-\d+$/.test(value));

const isRoundRobinPool = (value: unknown): value is MultiPassPool => {
  if (!isObjectRecord(value)) return false;
  return (
    typeof value.name === 'string' &&
    value.baseProvider === 'openai-codex' &&
    Array.isArray(value.members) &&
    value.members.every(isCodexProvider) &&
    value.enabled === true &&
    (value.strategy === undefined || value.strategy === 'round-robin')
  );
};

const parseJsonRecord = (path: string): Record<string, unknown> | undefined => {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    return isObjectRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const loadPools = (
  config: Record<string, unknown> | undefined,
): MultiPassPool[] => {
  if (!config || !Array.isArray(config.pools)) return [];
  return config.pools.filter(isRoundRobinPool).map((pool) => ({
    ...pool,
    members: [...new Set(pool.members)],
    strategy: 'round-robin',
  }));
};

const loadAllowedSubs = (
  config: Record<string, unknown> | undefined,
): string[] | undefined => {
  if (!config || !Array.isArray(config.allowedSubs)) return undefined;
  return config.allowedSubs.filter(isCodexProvider);
};

const loadPersistedState = (path: string): PersistedPoolState => {
  const parsed = parseJsonRecord(path);
  if (!parsed || !isObjectRecord(parsed.pools)) return { pools: {} };

  const pools: Record<string, Record<string, number>> = {};
  for (const [poolName, members] of Object.entries(parsed.pools)) {
    if (!isObjectRecord(members)) continue;
    const timestamps: Record<string, number> = {};
    for (const [provider, until] of Object.entries(members)) {
      if (isCodexProvider(provider) && typeof until === 'number') {
        timestamps[provider] = until;
      }
    }
    pools[poolName] = timestamps;
  }
  return { pools };
};

export const loadCodexPoolRoute = (
  config: CodexPoolConfig | undefined,
  targetProvider: string,
  targetModelId: string,
  cwd: string = process.cwd(),
  now: number = Date.now(),
): CodexPoolRoute | undefined => {
  if (!config || targetProvider !== 'openai-codex') return undefined;

  const agentDir = getAgentDir();
  const global = parseJsonRecord(join(agentDir, 'multi-pass.json'));
  const project = parseJsonRecord(join(cwd, '.pi', 'multi-pass.json'));
  const projectConfig: MultiPassProjectConfig = {
    pools: loadPools(project),
    allowedSubs: loadAllowedSubs(project),
  };
  const pools =
    projectConfig.pools && project?.pools !== undefined
      ? projectConfig.pools
      : loadPools(global);
  const pool = pools.find((candidate) => candidate.name === config.name);
  if (!pool) return undefined;

  const allowed = projectConfig.allowedSubs;
  const configuredMembers = pool.members.filter(
    (member) => !allowed || allowed.includes(member),
  );
  if (configuredMembers.length === 0) return undefined;

  const persisted = loadPersistedState(join(agentDir, 'multi-pass.state.json'));
  const exhausted = persisted.pools[pool.name] ?? {};
  const members = configuredMembers.filter((member) => {
    const exhaustedUntil = exhausted[member];
    return exhaustedUntil === undefined || exhaustedUntil <= now;
  });

  return {
    name: pool.name,
    modelId: targetModelId,
    members,
    allConfiguredMembersExhausted: members.length === 0,
    fallbackModel: config.fallbackModel,
    fallbackThinking: config.fallbackThinking,
  };
};

const getRetryAfterMs = (message: string): number => {
  const match = /retry[- ]?after\D{0,10}(\d{1,5})/i.exec(message);
  if (!match) return DEFAULT_EXHAUSTED_MS;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_EXHAUSTED_MS;
  return Math.min(Math.max(seconds * 1000, MIN_EXHAUSTED_MS), MAX_EXHAUSTED_MS);
};

export const isCodexPoolExhaustionError = (message: string): boolean =>
  /usage limit|rate[ -_]?limit|too many requests|\b429\b|quota|overloaded|capacity|\b5\d{2}\b/i.test(
    message,
  );

export const createCodexPoolSelector = () => {
  const nextIndexByPool = new Map<string, number>();
  const selectedProviderByTarget = new Map<string, string>();
  const exhaustedUntilByPool = new Map<string, Map<string, number>>();

  const targetKey = (route: CodexPoolRoute): string =>
    `${route.name}/${route.modelId}`;

  const isExhausted = (
    poolName: string,
    provider: string,
    now: number,
  ): boolean => {
    const members = exhaustedUntilByPool.get(poolName);
    const until = members?.get(provider);
    if (until === undefined) return false;
    if (until > now) return true;
    members?.delete(provider);
    return false;
  };

  const select = (
    route: CodexPoolRoute,
    isToolContinuation: boolean,
    now: number = Date.now(),
  ): CodexPoolPlan => {
    const available = route.members.filter(
      (member) => !isExhausted(route.name, member, now),
    );
    if (available.length === 0) {
      return { providers: [], allMembersExhausted: true };
    }

    const previous = selectedProviderByTarget.get(targetKey(route));
    if (isToolContinuation && previous && available.includes(previous)) {
      return {
        providers: [
          previous,
          ...available.filter((provider) => provider !== previous),
        ],
        allMembersExhausted: false,
      };
    }

    const start = (nextIndexByPool.get(route.name) ?? 0) % available.length;
    return {
      providers: [...available.slice(start), ...available.slice(0, start)],
      allMembersExhausted: false,
    };
  };

  const commit = (route: CodexPoolRoute, provider: string): void => {
    const index = route.members.indexOf(provider);
    if (index >= 0 && route.members.length > 0) {
      nextIndexByPool.set(route.name, (index + 1) % route.members.length);
    }
    selectedProviderByTarget.set(targetKey(route), provider);
  };

  const markExhausted = (
    route: CodexPoolRoute,
    provider: string,
    errorMessage: string,
    now: number = Date.now(),
  ): void => {
    if (!isCodexPoolExhaustionError(errorMessage)) return;
    const members =
      exhaustedUntilByPool.get(route.name) ?? new Map<string, number>();
    members.set(provider, now + getRetryAfterMs(errorMessage));
    exhaustedUntilByPool.set(route.name, members);
  };

  return { select, commit, markExhausted };
};
