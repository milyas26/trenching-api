import type { ILogsRepository, LogLevel, Logger } from './logs.interfaces.ts';

/** Log aktivitas bot: ditulis ke console dan tabel logs (ditampilkan di app). */
export class LogsService {
  private readonly loggers = new Map<number | null, Logger>();

  constructor(private readonly repo: ILogsRepository) {}

  latest(accountId: number, limit = 100) {
    return this.repo.latest(accountId, Math.min(Math.max(limit, 1), 500));
  }

  prune(before: Date) {
    return this.repo.prune(before);
  }

  /** Logger untuk satu akun; null = log sistem (tampil di semua akun). */
  for(accountId: number | null): Logger {
    let logger = this.loggers.get(accountId);
    if (!logger) {
      const write = (level: LogLevel) => (message: string) => this.write(accountId, level, message);
      logger = { info: write('info'), warn: write('warn'), error: write('error'), buy: write('buy'), sell: write('sell') };
      this.loggers.set(accountId, logger);
    }
    return logger;
  }

  get system(): Logger {
    return this.for(null);
  }

  private async write(accountId: number | null, level: LogLevel, message: string) {
    const tag = accountId === null ? '' : ` #${accountId}`;
    (level === 'error' ? console.error : console.log)(`[${level}${tag}] ${message}`);
    try {
      await this.repo.create(accountId, level, message);
    } catch (e) {
      console.error('gagal tulis log:', (e as Error).message);
    }
  }
}
