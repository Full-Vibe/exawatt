import type { ShortcutDefinition } from '@/types/shortcuts';
import { keyboardCommandVerbs } from '@exawatt/core';

/**
 * Default shortcut definitions.
 *
 * Nothing is declared here. Every rebindable verb the product offers lives in
 * the command-verb manifest (`@exawatt/core` → `shortcuts/command-verbs.ts`),
 * which also declares that verb's command-palette row and its native macOS
 * menu item — or writes down why it has neither. This file is the registry's
 * projection of that manifest, so a verb cannot enter the keyboard layer
 * without having answered for all three surfaces (ENG-016 D44, FIX-012).
 *
 * Actions are bound at runtime by the ShortcutProvider.
 *
 * Positional ordinals, arrangement chords, and focus-boundary keys are the
 * reserved families that never enter this registry; `fixed-families.ts` is
 * their behaviour and help manifest, under the same discoverability contract.
 */
export const defaultShortcuts: ShortcutDefinition[] = keyboardCommandVerbs().map(
  verb => ({
    id: verb.id,
    keys: verb.keys,
    label: verb.label,
    description: verb.description,
    category: verb.category,
    contexts: [...verb.contexts],
    ...(verb.bindingPolicy ? { bindingPolicy: verb.bindingPolicy } : {}),
  })
);

/**
 * Get a shortcut definition by ID
 */
export function getDefaultShortcut(id: string): ShortcutDefinition | undefined {
  return defaultShortcuts.find(s => s.id === id);
}
