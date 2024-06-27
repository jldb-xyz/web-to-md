import { CrawlOptions } from '../types';

export const defaultConfig: CrawlOptions = {
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

export { ConfigService } from '../services/configService';