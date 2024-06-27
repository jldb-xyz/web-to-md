import { injectable } from 'inversify';
import { IMarkdownConverter } from '../interfaces';
import TurndownService from 'turndown';

@injectable()
export class MarkdownConverter implements IMarkdownConverter {
  private turndownService: TurndownService;

  constructor() {
    this.turndownService = new TurndownService();
  }

  convert(html: string): string {
    return this.turndownService.turndown(html);
  }
}