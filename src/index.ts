import { Command } from 'commander';
import * as puppeteer from 'puppeteer';
import TurndownService from 'turndown';
import * as fs from 'fs';
import * as path from 'path';
import CliProgress from 'cli-progress';
import colors from 'ansi-colors';
import crypto from 'crypto';
import * as os from 'os';
import { TimeoutError } from 'puppeteer';
import { EventEmitter } from 'events';
import { exit } from 'process';

const program = new Command();

program
  .version('1.0.0')
  .description('A CLI tool to crawl documentation websites and convert them to Markdown')
  .option('-u, --url <url>', 'URL of the documentation website to crawl')
  .option('-o, --output <output>', 'Output directory')
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
  .parse(process.argv);

const options = program.opts();
const excludePaths = options.exclude ? options.exclude.split(',') : [];

interface CrawlState {
  visited: string[];
  queue: [string, number, string][]; // Add title to the queue
  jobId: string;
  settings: {
    url: string;
    outputDir: string;
    excludePaths: string[];
    maxPagesPerSecond: number;
    maxDepth: number;
    maxFileSizeMB: number;
    combine: boolean;
    name: string | undefined;
    preserveStructure: boolean;
    timeout: number;
    initialTimeout: number;
    retries: number;
  };
}

function getJobDirectory(baseDir: string, url: string): string {
  const urlHash = crypto.createHash('md5').update(url).digest('hex');
  return path.join(baseDir, `job_${urlHash}`);
}

// Create a new EventEmitter for state updates
const stateEmitter = new EventEmitter();

// Modify the saveState function to emit an event
function saveState(jobDir: string, state: CrawlState): void {
  fs.writeFileSync(path.join(jobDir, 'state.json'), JSON.stringify(state));
  stateEmitter.emit('stateUpdated', state);
}

function loadState(jobDir: string): CrawlState | null {
  const statePath = path.join(jobDir, 'state.json');
  if (fs.existsSync(statePath)) {
    return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  }
  return null;
}

function isExcluded(url: string, baseUrl: string, excludePaths: string[]): boolean {
  const urlPath = new URL(url).pathname;
  return excludePaths.some(excludePath => urlPath.startsWith(excludePath));
}

async function saveToFile(content: string, filePath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, content);
}

async function combineFiles(jobDir: string, outputDir: string, maxFileSizeMB: number, name: string | undefined): Promise<void> {
  const files = await fs.promises.readdir(jobDir);
  const mdFiles = files.filter(file => file.endsWith('.md'));
  
  let combinedContent = '';
  let currentFileSize = 0;
  let fileCounter = 1;

  const baseFileName = name || 'combined';

  for (const file of mdFiles) {
    const content = await fs.promises.readFile(path.join(jobDir, file), 'utf-8');
    const fileContent = `\n\n# ${file}\n\n${content}`;
    const contentSize = Buffer.byteLength(fileContent, 'utf-8');

    if (currentFileSize + contentSize > maxFileSizeMB * 1024 * 1024) {
      // Save current combined content and start a new file
      await saveToFile(combinedContent.trim(), path.join(outputDir, `${baseFileName}_${fileCounter}.md`));
      combinedContent = '';
      currentFileSize = 0;
      fileCounter++;
    }

    combinedContent += fileContent;
    currentFileSize += contentSize;
  }

  // Save any remaining content
  if (combinedContent) {
    await saveToFile(combinedContent.trim(), path.join(outputDir, `${baseFileName}_${fileCounter}.md`));
  }
}

async function moveFiles(jobDir: string, outputDir: string, preserveStructure: boolean): Promise<void> {
  const files = await fs.promises.readdir(jobDir);
  await Promise.all(
    files
      .filter(file => file.endsWith('.md'))
      .map(file => {
        const filePath = path.join(jobDir, file);
        const fileName = path.basename(file);
        const newFilePath = preserveStructure
          ? path.join(outputDir, path.dirname(file), fileName)
          : path.join(outputDir, fileName);
        return fs.promises.rename(filePath, newFilePath);
      })
  );
}

async function savePageContent(page: puppeteer.Page, url: string, jobDir: string, turndownService: TurndownService): Promise<string> {
  const content = await page.content();
  const markdown = turndownService.turndown(content);
  const title = await page.title();
  const sanitizedTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const fileName = `${sanitizedTitle}_${crypto.createHash('md5').update(url).digest('hex')}.md`;
  const filePath = path.join(jobDir, fileName);
  await saveToFile(markdown, filePath);
  return sanitizedTitle;
}

// Add these variables before the crawlWebsite function
const crawlerEvents = new EventEmitter();
let activeWorkers = 0;
let isFinishing = false;

// Add these variables at the global scope
let multibar: CliProgress.MultiBar;
let browser: puppeteer.Browser;
let isCleaningUp = false;

async function crawlWebsite(url: string, outputDir: string, excludePaths: string[], maxPagesPerSecond: number, maxDepth: number, maxFileSizeMB: number, combine: boolean, name: string | undefined, preserveStructure: boolean, timeout: number, initialTimeout: number, retries: number): Promise<void> {
  const jobDir = getJobDirectory(outputDir, url);
  fs.mkdirSync(jobDir, { recursive: true });

  const turndownService = new TurndownService();

  let state = loadState(jobDir) || {
    visited: [],
    queue: [[url, 0, '']],
    jobId: crypto.randomUUID(),
    settings: {
      url,
      outputDir,
      excludePaths,
      maxPagesPerSecond,
      maxDepth,
      maxFileSizeMB,
      combine,
      name,
      preserveStructure,
      timeout,
      initialTimeout,
      retries
    }
  };

  // Use saved settings if resuming
  ({url, outputDir, excludePaths, maxPagesPerSecond, maxDepth, maxFileSizeMB, combine, name, preserveStructure, timeout, initialTimeout, retries} = state.settings);

  const visited = new Set<string>(state.visited);
  const queue: [string, number, string][] = state.queue;

  browser = await puppeteer.launch({});
  multibar = new CliProgress.MultiBar({
    clearOnComplete: true,
    hideCursor: true,
    format: (options, params, payload) => {
      const bar = options.barCompleteString?.substr(0, Math.round(params.progress * (options.barsize ?? 0))) ?? '';
      if (payload.type === 'main') {
        const percentage = Math.round((params.value / params.total) * 100);
        return `${colors.cyan(bar)} ${colors.cyan(params.value + '/' + params.total)} | ${colors.yellow(percentage + '%')} | ${colors.green(payload.status)}`;
      } else {
        return colors.magenta(payload.status);
      }
    },
  }, CliProgress.Presets.shades_classic);

  let overallProgress: CliProgress.SingleBar;
  overallProgress = multibar.create(queue.length + visited.size, visited.size, { status: 'Resuming...', type: 'main' });

  const workerBars = new Map();

  const numWorkers = Math.min(os.cpus().length, maxPagesPerSecond, 5);
  const workerPool = await Promise.all(
    Array(numWorkers).fill(null).map(async (_, id) => ({
      page: await browser.newPage(),
      id: id + 1
    }))
  );

  for (let i = 0; i < numWorkers; i++) {
    workerBars.set(i + 1, multibar.create(1, 0, { status: `Worker ${i + 1}: Idle`, type: 'worker' }));
  }

  activeWorkers = numWorkers;

  async function crawlPage(worker: puppeteer.Page, workerId: number): Promise<void> {
    const workerBar = workerBars.get(workerId);
    const workerCrawlInterval = 1000 / maxPagesPerSecond;
    let lastCrawlTime = Date.now();

    while (!isFinishing) {
      // Update overall progress at the start of each iteration
      overallProgress.update(visited.size, { status: `Crawled: ${visited.size}, Queued: ${queue.length}` });
      
      const item = queue.shift();
      if (!item) {
        // No items in the queue, wait and check again
        workerBar.update(0, { status: `Worker ${workerId}: Waiting for new URLs` });
        await new Promise(resolve => setTimeout(resolve, 1000));
        crawlerEvents.emit('workerIdle', workerId);
        continue;
      }

      crawlerEvents.emit('workerBusy', workerId);

      const [currentUrl, depth, parentTitle] = item;
      
      if (visited.has(currentUrl) || isExcluded(currentUrl, url, excludePaths) || depth > maxDepth) {
        continue;
      }

      visited.add(currentUrl);

      workerBar.update(0, { status: `Worker ${workerId}: 🔍 Crawling ${colors.cyan(currentUrl)}` });

      try {
        let navigated = false;
        if (await canClickTo(worker, currentUrl)) {
          workerBar.update(0, { status: `Worker ${workerId}: 🖱️ Clicking to ${colors.cyan(currentUrl)}` });
          await clickAndWait(worker, currentUrl, timeout * 1000, workerId, depth, parentTitle);
          navigated = true;
        }

        if (!navigated) {
          workerBar.update(0, { status: `Worker ${workerId}: 🌐 Navigating to ${colors.cyan(currentUrl)}` });
          const isInitialNavigation = visited.size === 1;
          const navigationTimeout = isInitialNavigation ? initialTimeout * 1000 : timeout * 1000;
          const maxRetries = isInitialNavigation ? retries : 1;

          let success = false;
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              const response = await worker.goto(currentUrl, { waitUntil: 'networkidle0', timeout: navigationTimeout });
              success = true;

              // Check for redirects
              const finalUrl = worker.url();
              if (finalUrl !== currentUrl) {
                workerBar.update(0, { status: `Worker ${workerId}: 🔀 Redirected from ${colors.yellow(currentUrl)} to ${colors.green(finalUrl)}` });
                visited.add(finalUrl);
                if (!isExcluded(finalUrl, url, excludePaths)) {
                  queue.push([finalUrl, depth, parentTitle]);
                }
              }

              break; // If successful, exit the retry loop
            } catch (error) {
              if (error instanceof TimeoutError && attempt < maxRetries) {
                workerBar.update(0, { status: `Worker ${workerId}: ⏱️ Timeout on attempt ${attempt}/${maxRetries} for ${colors.yellow(currentUrl)} - Retrying...` });
                await worker.reload({ waitUntil: 'networkidle0', timeout: navigationTimeout });
              } else {
                throw error; // Rethrow if it's not a timeout or we've exhausted retries
              }
            }
          }

          if (!success) {
            throw new Error(`Failed to load ${currentUrl} after ${maxRetries} attempts`);
          }
        }

        const pageTitle = await savePageContent(worker, currentUrl, jobDir, turndownService);
        workerBar.update(0, { status: `Worker ${workerId}: 💾 Saved ${colors.green(pageTitle)}` });

        if (depth < maxDepth) {
          const newUrls = await worker.evaluate((baseUrl) => {
            const links = Array.from(document.querySelectorAll('a'));
            return links
              .map(link => ({ href: link.href, text: link.textContent || '' }))
              .filter(({href}) => href.startsWith(baseUrl) && !href.includes('#'));
          }, url);

          let addedUrls = 0;
          for (const {href: newUrl, text: linkText} of newUrls) {
            if (!visited.has(newUrl) && !isExcluded(newUrl, url, excludePaths) && !isInQueue(newUrl)) {
              queue.push([newUrl, depth + 1, linkText]);
              addedUrls++;
              overallProgress.setTotal(queue.length + visited.size);
            }
          }
          workerBar.update(0, { status: `Worker ${workerId}: ➕ Added ${colors.yellow(addedUrls.toString())} new URLs` });
        }

        overallProgress.update(visited.size, { status: `Crawled: ${visited.size}, Queued: ${queue.length}` });
        workerBar.update(0, { status: `Worker ${workerId}: ✅ Completed ${colors.green(currentUrl)}` });
      } catch (error) {
        if (error instanceof puppeteer.TimeoutError) {
          workerBar.update(0, { status: `Worker ${workerId}: ⏱️ Timeout: ${colors.yellow(currentUrl)} - Requeueing` });
          queue.push([currentUrl, depth, parentTitle]);
        } else if (
          error instanceof Error &&
          'name' in error &&
          error.name === 'HttpError' &&
          'response' in error &&
          typeof error.response === 'object' &&
          error.response !== null &&
          'status' in error.response &&
          error.response.status === 401
        ) {
          workerBar.update(0, { status: `Worker ${workerId}: 🚫 Unauthorized: ${colors.red(currentUrl)} - Exiting` });
          process.exit(1);
        } else {
          workerBar.update(0, { status: `Worker ${workerId}: ❌ Error: ${colors.red(currentUrl)} - ${colors.red(error instanceof Error ? error.message : 'Unknown error')}` });
        }
      }

      const now = Date.now();
      const timeToWait = Math.max(0, workerCrawlInterval - (now - lastCrawlTime));
      await new Promise(resolve => setTimeout(resolve, timeToWait));
      lastCrawlTime = Date.now();

      // Update and save state after processing each URL
      updateAndSaveState();
    }

    workerBar.update(1, { status: `Worker ${workerId}: 🏁 Finished` });
  }

  async function canClickTo(page: puppeteer.Page, url: string): Promise<boolean> {
    return page.evaluate((targetUrl) => {
      const link = Array.from(document.querySelectorAll('a')).find(a => a.href === targetUrl);
      return !!link && link.offsetParent !== null;
    }, url);
  }

  async function clickAndWait(page: puppeteer.Page, url: string, timeout: number, workerId: number, depth: number, parentTitle: string): Promise<void> {
    try {
      await Promise.race([
        Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle0', timeout }),
          page.evaluate((targetUrl) => {
            const link = Array.from(document.querySelectorAll('a')).find(a => a.href === targetUrl);
            if (link) link.click();
            else throw new Error('Link not found');
          }, url),
        ]),
        new Promise((_, reject) => setTimeout(() => reject(new TimeoutError('Navigation timeout')), timeout + 5000))
      ]);
    } catch (error) {
      workerBars.get(workerId).update(0, { status: `Worker ${workerId}: ⚠️ Click and wait failed for ${colors.yellow(url)}: ${colors.red(error instanceof Error ? error.message : 'Unknown error')}` });
      // Fallback to direct navigation
      await page.goto(url, { waitUntil: 'networkidle0', timeout });
    }

    // Check if we've been redirected
    const currentUrl = page.url();
    if (currentUrl !== url) {
      workerBars.get(workerId).update(0, { status: `Worker ${workerId}: 🔀 Redirected from ${colors.yellow(url)} to ${colors.green(currentUrl)}` });
      visited.add(currentUrl);
      if (!isExcluded(currentUrl, state.settings.url, state.settings.excludePaths)) {
        queue.push([currentUrl, depth, parentTitle]);
      }
    }
  }

  function isInQueue(url: string): boolean {
    return queue.some(([queuedUrl]) => queuedUrl === url);
  }

  function updateAndSaveState() {
    state = {
      visited: Array.from(visited),
      queue: queue,
      jobId: state.jobId,
      settings: state.settings
    };
    saveState(jobDir, state);
    
    // Update overall progress when state is saved
    overallProgress.setTotal(queue.length + visited.size);
    overallProgress.update(visited.size, { status: `Crawled: ${visited.size}, Queued: ${queue.length}` });
  }

  try {
    // Create a promise for each worker
    const workerPromises = workerPool.map(({ page, id }) => crawlPage(page, id));

    // Set up an interval to periodically save the state
    const saveInterval = setInterval(() => {
      updateAndSaveState();
    }, 60000); // Save every minute

    // Set up event listeners
    crawlerEvents.on('workerIdle', (workerId) => {
      activeWorkers--;
      if (queue.length === 0 && activeWorkers === 0) {
        isFinishing = true;
      }
    });

    crawlerEvents.on('workerBusy', (workerId) => {
      activeWorkers++;
      isFinishing = false;
    });

    // Wait for all workers to finish
    await Promise.all(workerPromises);

    // Clear the save interval
    clearInterval(saveInterval);

    overallProgress.update(visited.size, { status: 'Complete!' });
    multibar.stop();

    if (combine) {
      await combineFiles(jobDir, outputDir, maxFileSizeMB, name);
    } else {
      await moveFiles(jobDir, outputDir, preserveStructure);
    }

    console.log('Crawling completed successfully.');
  } catch (error) {
    console.error('Error during crawling:', error);
  } finally {
    // Cleanup
    await cleanup();
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

// Add this function to handle cleanup
async function cleanup() {
  if (isCleaningUp) return; // Prevent multiple cleanup calls
  isCleaningUp = true;

  console.log('\nCleaning up...');
  if (multibar) {
    multibar.stop();
  }
  if (browser) {
    await browser.close();
  }
  console.log('Cleanup completed.');
}

// Modify event listeners
process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT. Initiating graceful shutdown...');
  await cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM. Initiating graceful shutdown...');
  await cleanup();
  process.exit(0);
});

process.on('uncaughtException', async (error) => {
  console.error('Uncaught Exception:', error);
  await cleanup();
  process.exit(1);
});

// Modify the main function to handle errors
async function main() {
  try {
    const maxPagesPerSecond = parseFloat(options.rate);
    const maxDepth = parseInt(options.depth);
    const maxFileSizeMB = parseFloat(options.maxFileSize);
    const timeout = parseFloat(options.timeout);
    const initialTimeout = parseFloat(options.initialTimeout);
    const retries = parseInt(options.retries);

    await crawlWebsite(options.url, options.output, excludePaths, maxPagesPerSecond, maxDepth, maxFileSizeMB, options.combine, options.name, options.preserveStructure, timeout, initialTimeout, retries);
    console.log('Crawling process completed.');
  } catch (error) {
    console.error('Fatal error during crawling:', error);
  } finally {
    await cleanup();
  }
}

// Execute the main function
main();
