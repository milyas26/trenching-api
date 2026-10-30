import type { LogLevel } from '../../generated/prisma/enums.ts';

export type { LogLevel };

export interface LogEntry {
  id: number;
  level: LogLevel;
  message: string;
  createdAt: Date;
}

export interface ILogsRepository {
  /** accountId null = log sistem, tampil di semua akun. */
  create(accountId: number | null, level: LogLevel, message: string): Promise<void>;
  latest(accountId: number, limit: number): Promise<LogEntry[]>;
  /** Hapus log lebih lama dari `before`. Mengembalikan jumlah row yang dihapus. */
  prune(before: Date): Promise<number>;
}

export type Logger = Record<LogLevel, (message: string) => Promise<void>>;
