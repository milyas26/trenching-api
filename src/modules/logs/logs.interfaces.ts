import type { LogLevel } from '../../generated/prisma/enums.ts';

export type { LogLevel };

export interface LogEntry {
  id: number;
  level: LogLevel;
  message: string;
  createdAt: Date;
}

export interface ILogsRepository {
  create(level: LogLevel, message: string): Promise<void>;
  latest(limit: number): Promise<LogEntry[]>;
}
