import { injectable } from 'inversify';
import { IHtmlCleanser } from '../interfaces';
import * as cheerio from 'cheerio';

@injectable()
export class HtmlCleanser implements IHtmlCleanser {
  cleanseHTML(html: string): string {
    const $ = cheerio.load(html);

    // Remove scripts
    $('script').remove();

    // Remove styles
    $('style').remove();

    // Remove comments
    $('*').contents().filter(function() {
      return this.type === 'comment';
    }).remove();

    return $.html();
  }
}