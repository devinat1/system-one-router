import type { ThinkingLevel } from '@earendil-works/pi-agent-core';

export type RouterTier = 'high' | 'medium' | 'low';
export type RouterPin = RouterTier | 'auto';
export type RouterPhase = 'planning' | 'implementation' | 'lightweight';
export type RouterPinByProfile = Partial<Record<string, RouterTier>>;
export type RouterThinkingByTier = Partial<Record<RouterTier, ThinkingLevel>>;
export type RouterThinkingByProfile = Record<string, RouterThinkingByTier>;

export interface RoutingRule {
  matches: string | string[];
  tier: RouterTier;
  reason?: string;
}

export interface ModelDefinition {
  model: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  thinkingLevels?: ThinkingLevel[];
}

export interface ClassifierConfig {
  model: string;
  thinking?: ThinkingLevel;
}

/** Optional TypeSafe System One classifier configuration. */
export interface SystemOneClassifierConfig {
  provider: 'typesafe';
  type: 'system-one';
  model: string;
  timeoutMs: number;
}

/**
 * Local bridge configuration for a pi-codex-multi pool. The router keeps the
 * selected Codex model and thinking level while choosing a pool member.
 */
export interface CodexPoolConfig {
  name: string;
  fallbackModel: string;
  fallbackThinking: ThinkingLevel;
}

export interface RoutedTierConfig {
  model: string;
  thinking?: ThinkingLevel;
  fallbacks?: string[];
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  thinkingLevels?: ThinkingLevel[];
  resolvedContextWindow?: number;
  resolvedMaxTokens?: number;
  resolvedThinkingLevels?: ThinkingLevel[];
}

export interface RouterProfile {
  high?: RoutedTierConfig;
  medium?: RoutedTierConfig;
  low?: RoutedTierConfig;
}

export interface RouterConfig {
  debug?: boolean;
  /**
   * Runs before classifierModel. `null` is retained while raw configs are
   * merged so a project config can explicitly disable an inherited classifier.
   */
  classifier?: SystemOneClassifierConfig | null;
  classifierModel?: ClassifierConfig;
  phaseBias?: number;
  maxSessionBudget?: number;
  rules?: RoutingRule[];
  codexPool?: CodexPoolConfig;
  profiles: Record<string, RouterProfile>;
  models?: Record<string, ModelDefinition>;
}

export interface RoutingDecision {
  profile: string;
  tier: RouterTier;
  phase: RouterPhase;
  targetProvider: string;
  targetModelId: string;
  targetLabel: string;
  reasoning: string;
  thinking: ThinkingLevel;
  timestamp: number;
  isClassifier?: boolean;
  isFallback?: boolean;
  isBudgetForced?: boolean;
  isRuleMatched?: boolean;
}

export interface RouterPersistedState {
  enabled: boolean;
  selectedProfile: string;
  pinTier?: RouterTier;
  pinByProfile?: RouterPinByProfile;
  thinkingByProfile?: RouterThinkingByProfile;
  debugEnabled?: boolean;
  widgetEnabled?: boolean;
  debugHistory?: RoutingDecision[];
  lastPhase?: RouterPhase;
  lastDecision?: RoutingDecision;
  lastNonRouterModel?: string;
  accumulatedCost?: number;
  timestamp: number;
}

export interface ConfigLoadResult {
  config: RouterConfig;
  warnings: string[];
}

export interface ParsedConfigFile {
  config: Partial<RouterConfig>;
  warnings: string[];
}

export interface CustomSessionEntry {
  type: string;
  customType?: string;
  data?: unknown;
}
