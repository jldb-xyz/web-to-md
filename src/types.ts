import type { Page } from "puppeteer";

export interface CrawlOptions {
  url: string;
  output: string;
  combine?: boolean;
  exclude?: string;
  rate?: string;
  depth: string;
  maxFileSize?: string;
  name?: string;
  preserveStructure?: boolean;
  timeout: string;
  initialTimeout: string;
  retries?: string;
  workers?: string;
  logLevel?: 'silent' | 'error' | 'warn' | 'info' | 'debug';
}

export interface CrawlState {
  visited: Set<string>;
  queue: [string, number, string][];
  contentHashes: { [normalizedUrl: string]: string };
}

export interface PageResult {
  title: string;
  markdown: string;
}

export interface WorkerPool {
  [workerId: number]: Page;
}