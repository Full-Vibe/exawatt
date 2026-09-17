/**
 * The HUD colour a lifecycle tone paints in (ENG-015 S6.4). The vocabulary
 * in `@exawatt/ui-model` names the tone; this is the only place the tone
 * becomes a colour, so the tab chip, the pane's word, and the Team tile
 * cannot shade the same state differently.
 */
import type { SessionLifecycleTone } from '@exawatt/ui-model';
import { WORKSPACE_HUD as HUD } from './workspace-theme';

export function lifecycleToneColor(tone: SessionLifecycleTone): string {
  switch (tone) {
    case 'fault':
      return HUD.red;
    case 'warn':
      return HUD.amber;
    case 'neutral':
      return HUD.textDim;
  }
}
