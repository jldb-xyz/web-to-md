import { injectable } from 'inversify';
import * as fs from 'fs';
import * as path from 'path';
import { CrawlOptions } from '../types';
import { IConfigService } from '../interfaces';

@injectable()
export class ConfigService implements IConfigService {
  private config: CrawlOptions;
  private configPath!: string;

  constructor() {
    this.config = this.getDefaultConfig();
  }

  public getConfig(): CrawlOptions {
    return this.config;
  }

  public setConfig(partialConfig: Partial<CrawlOptions>): void {
    this.config = { ...this.getDefaultConfig(), ...this.loadConfig(), ...partialConfig };
    this.configPath = path.join(this.config.output, 'config.json');
    this.saveConfig();
  }

  private loadConfig(): CrawlOptions {
    if (fs.existsSync(this.configPath)) {
      const configFile = fs.readFileSync(this.configPath, 'utf-8');
      return { ...this.getDefaultConfig(), ...JSON.parse(configFile) };
    }
    return this.getDefaultConfig();
  }

  private saveConfig(): void {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
  }

  private getDefaultConfig(): CrawlOptions {
    return {
      url: '',
      output: 'output',
      combine: false,
      exclude: '',
      rate: '5',
      depth: '3',
      maxFileSize: '2',
      name: '',
      preserveStructure: false,
      timeout: '30000',
      initialTimeout: '60000',
      retries: '3',
      workers: '1',
      logLevel: 'silent',
    };
  }
}