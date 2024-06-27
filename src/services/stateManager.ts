import { injectable } from 'inversify';
import { CrawlState } from '../types';

@injectable()
export class StateManager {
  private static instance: StateManager;
  private state: CrawlState;
  private activeWorkers: number = 0;

  public constructor() {
    this.state = {
      visited: new Set<string>(),
      queue: [],
      contentHashes: {},
    };
  }

  public static getInstance(): StateManager {
    if (!StateManager.instance) {
      StateManager.instance = new StateManager();
    }
    return StateManager.instance;
  }

  public getState(): CrawlState {
    return this.state;
  }

  public getVisitedCount(): number {
    return this.state.visited.size;
  }

  public getTotalUrlCount(): number {
    return this.state.visited.size + this.state.queue.length;
  }

  public getQueueSize(): number {
    return this.state.queue.length;
  }

  public addVisited(url: string): void {
    this.state.visited.add(url);
  }

  public isVisited(url: string): boolean {
    return this.state.visited.has(url);
  }

  public addToQueue(url: string, depth: number, parentUrl: string): void {
    this.state.queue.push([url, depth, parentUrl]);
  }

  public getNextFromQueue(): [string, number, string] | undefined {
    return this.state.queue.shift();
  }

  public setContentHash(url: string, hash: string): void {
    this.state.contentHashes[url] = hash;
  }

  public getContentHash(url: string): string | undefined {
    return this.state.contentHashes[url];
  }

  public reset(): void {
    this.state = {
      visited: new Set<string>(),
      queue: [],
      contentHashes: {},
    };
  }

  public incrementActiveWorkers(): void {
    this.activeWorkers++;
  }

  public decrementActiveWorkers(): void {
    this.activeWorkers--;
  }

  public getActiveWorkers(): number {
    return this.activeWorkers;
  }
}