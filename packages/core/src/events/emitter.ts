/**
 * Typed Event Emitter
 * Browser-compatible event system with full type safety
 * Works in both browser and Node.js environments
 */

import type { ExawattAgent, AgentActivity } from '../types/agent';
import type { FleetState } from '../types/fleet';

type Handler<T> = (data: T) => void;

/**
 * Core event map for Exawatt events
 * Uses Exawatt model types (agent, fleet, activity)
 */
export interface CoreEventMap extends Record<string, unknown> {
  'agent:updated': ExawattAgent;
  'agent:created': ExawattAgent;
  'agent:removed': string; // agent id
  'fleet:updated': FleetState;
  'chat:message': { agentId: string; activity: AgentActivity };
  'chat:tool': { agentId: string; activity: AgentActivity };
  'connection:status': 'connecting' | 'connected' | 'disconnected' | 'error';
  'connection:error': Error;
}

/**
 * TypedEmitter — Generic typed event emitter
 * Provides type-safe on/off/emit/once/removeAllListeners
 */
export class TypedEmitter<EventMap extends Record<string, unknown>> {
  private handlers = new Map<keyof EventMap, Set<Handler<unknown>>>();

  /**
   * Register a handler for an event
   */
  on<E extends keyof EventMap>(event: E, handler: Handler<EventMap[E]>): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as Handler<unknown>);
  }

  /**
   * Unregister a handler for an event
   */
  off<E extends keyof EventMap>(event: E, handler: Handler<EventMap[E]>): void {
    this.handlers.get(event)?.delete(handler as Handler<unknown>);
  }

  /**
   * Emit an event to all registered handlers
   */
  emit<E extends keyof EventMap>(event: E, data: EventMap[E]): void {
    const eventHandlers = this.handlers.get(event);
    if (eventHandlers) {
      for (const h of eventHandlers) {
        h(data);
      }
    }
  }

  /**
   * Register a handler that fires exactly once
   */
  once<E extends keyof EventMap>(
    event: E,
    handler: Handler<EventMap[E]>
  ): void {
    const wrapper: Handler<EventMap[E]> = data => {
      handler(data);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
  }

  /**
   * Remove all listeners for an event, or all events if not specified
   */
  removeAllListeners(event?: keyof EventMap): void {
    if (event !== undefined) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }
}

/**
 * Convenience type alias for CoreEmitter
 */
export type CoreEmitter = TypedEmitter<CoreEventMap>;
