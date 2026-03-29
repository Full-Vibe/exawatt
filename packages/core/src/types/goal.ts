/**
 * Exawatt Goal Types
 * Represents a goal that agents work toward
 */

export interface Goal {
  id: string;
  agentId: string;
  description: string;
  status: 'active' | 'paused' | 'complete';
  createdAt: number; // unix ms
  milestones?: string[];
}
