// Exawatt-native cron types — independent of OC protocol types

export type CronJobStatus = 'idle' | 'running' | 'error';

export interface ExawattCronJob {
  id: string;
  name: string;
  schedule: string; // cron expression
  prompt: string;
  sessionKey?: string;
  enabled: boolean;
  lastRun?: number; // unix ms
  nextRun?: number; // unix ms
  status?: CronJobStatus;
}

export interface ExawattCronRun {
  id: string;
  jobId: string;
  startedAt: number; // unix ms
  completedAt?: number; // unix ms
  status: 'success' | 'error' | 'running';
  error?: string;
}

export interface ExawattCronJobCreate {
  name: string;
  schedule: string;
  prompt: string;
  sessionKey?: string;
  enabled?: boolean;
}
