import type { ILogsRepository, LogLevel } from './logs.interfaces.ts';

/** Log aktivitas bot: ditulis ke console dan tabel logs (ditampilkan di app). */
export class LogsService {
  constructor(private readonly repo: ILogsRepository) {}

  latest(limit = 100) {
    return this.repo.latest(Math.min(Math.max(limit, 1), 500));
  }

  info = (message: string) => this.write('info', message);
  warn = (message: string) => this.write('warn', message);
  error = (message: string) => this.write('error', message);
  buy = (message: string) => this.write('buy', message);
  sell = (message: string) => this.write('sell', message);

  private async write(level: LogLevel, message: string) {
    (level === 'error' ? console.error : console.log)(`[${level}] ${message}`);
    try {
      await this.repo.create(level, message);
    } catch (e) {
      console.error('gagal tulis log:', (e as Error).message);
    }
  }
}
