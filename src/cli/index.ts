import { Command } from 'commander';

export const program = new Command();

program
  .version('1.0.0')
  .description('A CLI tool to crawl documentation websites and convert them to Markdown')
  .requiredOption('-u, --url <url>', 'URL of the documentation website to crawl', (value: string) => value)
  .requiredOption('-o, --output <output>', 'Output directory', (value: string) => value)
  .option('-c, --combine', 'Combine all pages into a single Markdown file')
  .option('-e, --exclude <paths>', 'Comma-separated list of paths to exclude from crawling')
  .option('-r, --rate <rate>', 'Maximum pages per second to crawl', '5')
  .option('-d, --depth <depth>', 'Maximum depth to crawl', '3')
  .option('-m, --max-file-size <size>', 'Maximum file size in MB for combined output', '2')
  .option('-n, --name <name>', 'Name for the combined output file')
  .option('-p, --preserve-structure', 'Preserve directory structure when not combining files')
  .option('-t, --timeout <timeout>', 'Timeout in seconds for page navigation', '3.5')
  .option('-i, --initial-timeout <initialTimeout>', 'Initial timeout in seconds for the first page load', '60')
  .option('-re, --retries <retries>', 'Number of retries for initial page load', '3')
  .option('-w, --workers <workers>', 'Number of concurrent workers', '1')
  .option('--log-level <level>', 'Set the log level (silent, error, warn, info, debug)', 'silent');

program.parse(process.argv, { from: 'user' });