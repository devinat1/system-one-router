import { describe, it, expect } from 'vitest';
import { isRouterPersistedState, buildPersistedState } from './state';
import type { RoutingDecision } from './types';

describe('state.ts', () => {
  describe('isRouterPersistedState', () => {
    it('should return false for non-objects or null', () => {
      expect(isRouterPersistedState(null)).toBe(false);
      expect(isRouterPersistedState('string')).toBe(false);
      expect(isRouterPersistedState(123)).toBe(false);
    });

    it('should return false if required properties are missing or wrong type', () => {
      expect(isRouterPersistedState({ enabled: true })).toBe(false);
      expect(
        isRouterPersistedState({
          enabled: 'yes',
          selectedProfile: 'p',
          timestamp: 123,
        }),
      ).toBe(false);
    });

    it('should return true for valid persisted state objects', () => {
      const state = {
        enabled: true,
        selectedProfile: 'balanced',
        timestamp: Date.now(),
      };
      expect(isRouterPersistedState(state)).toBe(true);
    });
  });

  describe('buildPersistedState', () => {
    it('should build a state object matching the interface requirements', () => {
      const decision: RoutingDecision = {
        profile: 'balanced',
        tier: 'high',
        phase: 'planning',
        targetProvider: 'google',
        targetModelId: 'gemini-2.5-pro',
        targetLabel: 'google/gemini-2.5-pro',
        reasoning: 'Rules matched',
        thinking: 'high',
        timestamp: Date.now(),
      };

      const state = buildPersistedState(
        true,
        'balanced',
        { balanced: 'high' },
        { balanced: { high: 'xhigh' } },
        true,
        false,
        [decision],
        decision,
        'openai/gpt-4o',
        0.0045,
      );

      expect(state.enabled).toBe(true);
      expect(state.selectedProfile).toBe('balanced');
      expect(state.pinTier).toBe('high');
      expect(state.pinByProfile).toEqual({ balanced: 'high' });
      expect(state.thinkingByProfile).toEqual({ balanced: { high: 'xhigh' } });
      expect(state.debugEnabled).toBe(true);
      expect(state.widgetEnabled).toBe(false);
      expect(state.debugHistory).toEqual([decision]);
      expect(state.lastPhase).toBe('planning');
      expect(state.lastDecision).toEqual(decision);
      expect(state.lastNonRouterModel).toBe('openai/gpt-4o');
      expect(state.accumulatedCost).toBe(0.0045);
      expect(state.timestamp).toBeGreaterThan(0);
    });

    it('should handle undefined selectedProfile', () => {
      const state = buildPersistedState(
        false,
        undefined,
        {},
        {},
        false,
        false,
        [],
        undefined,
        undefined,
        0,
      );
      expect(state.selectedProfile).toBe('');
      expect(state.pinTier).toBeUndefined();
    });
  });
});
