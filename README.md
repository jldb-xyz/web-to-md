# 🕷️ Web-to-MD: Your Friendly Neighborhood Web Crawler and Markdown Converter 🕸️

Welcome to Web-to-MD, the CLI tool that turns websites into your personal Markdown library! 🚀

## 🌟 Why Web-to-MD?

Ever wished you could magically transform entire websites into neatly organized Markdown files? Well, wish no more! Web-to-MD is here to save the day (and your sanity)!

## 🎭 Features That'll Make You Go "Wow!"

- 🔍 Crawls websites like a pro detective
- 🧙‍♂️ Magically transforms HTML into beautiful Markdown
- 🏃‍♂️ Resumes interrupted crawls (because life happens!)
- 📚 Creates separate Markdown files or one big book of knowledge
- 🎨 Shows fancy progress bars (because who doesn't love those?)
- 🚦 Respects rate limits (we're polite crawlers here!)
- 🌳 Preserves directory structure (if you're into that sort of thing)
- 🔒 Handles authentication gracefully (no trespassing allowed!)
- 👥 Multi-worker support (because teamwork makes the dream work!)
- 🔄 Smart content change detection (no need to crawl what hasn't changed!)

## 🛠️ Installation

1. Clone this repo (it won't bite, promise!)
2. Run `npm install` (sit back and watch the magic happen)
3. Run `npm run build` to compile the TypeScript code

## 🚀 Usage

Fire up Web-to-MD with this incantation:

```bash
npm start -- -u <url> -o <output_directory> [options]
```

### 🎛️ Options (Mix and Match to Your Heart's Content)

- `-u, --url <url>`: The URL of your web treasure trove (required)
- `-o, --output <output>`: Where to stash your Markdown gold (required)
- `-c, --combine`: Merge all pages into one massive scroll of knowledge
- `-e, --exclude <paths>`: Comma-separated list of paths to skip (shh, we won't tell)
- `-r, --rate <rate>`: Max pages per second (default: 5, for the speed demons)
- `-d, --depth <depth>`: How deep should we dig? (default: 3, watch out for dragons)
- `-m, --max-file-size <size>`: Max file size in MB for combined output (default: 2)
- `-n, --name <name>`: Name your combined file (get creative!)
- `-p, --preserve-structure`: Keep the directory structure (for the neat freaks)
- `-t, --timeout <timeout>`: Timeout in seconds for page navigation (default: 3.5)
- `-i, --initial-timeout <initialTimeout>`: Initial timeout for the first page (default: 60)
- `-re, --retries <retries>`: Number of retries for initial page load (default: 3)
- `-w, --workers <workers>`: Number of concurrent workers (default: 1, for the multitaskers)

### 🌟 Example (Because We All Need a Little Guidance)

```bash
npm start -- -u https://docs.example.com -o ./my_docs -c -d 5 -r 3 -n "ExampleDocs" -w 3
```

This will:

1. Crawl https://docs.example.com
2. Save Markdown files to ./my_docs
3. Combine all pages into one file
4. Crawl up to 5 levels deep
5. Respect a rate limit of 3 pages per second
6. Name the combined file "ExampleDocs"
7. Use 3 concurrent workers for faster crawling

## 🔧 Config Magic: Resuming and Customizing Your Crawls

Web-to-MD comes with a nifty config feature that lets you resume interrupted crawls and customize your crawling experience. Here's how it works:

### 📁 Config File

After a crawl (complete or interrupted), Web-to-MD saves a `config.json` file in your output directory. This file contains all the settings and state information from your last crawl.

### 🔄 Resuming a Crawl

To resume an interrupted crawl, simply run Web-to-MD with the same output directory. The tool will automatically detect the `config.json` file and pick up where it left off.

### 🎛️ Customizing Your Crawl

You can manually edit the `config.json` file to customize your next crawl. Here are the available options and their default values:

| Option | Description | Default Value |
|--------|-------------|---------------|
| `url` | Starting URL for the crawl | (Required) |
| `outputDir` | Output directory for Markdown files | (Required) |
| `excludePaths` | Paths to exclude from crawling | `[]` |
| `maxPagesPerSecond` | Maximum pages to crawl per second | `5` |
| `maxDepth` | Maximum depth to crawl | `3` |
| `maxFileSizeMB` | Maximum file size in MB for combined output | `2` |
| `combine` | Combine all pages into a single file | `false` |
| `name` | Name for the combined output file | `undefined` |
| `preserveStructure` | Preserve directory structure | `false` |
| `timeout` | Timeout in seconds for page navigation | `3.5` |
| `initialTimeout` | Initial timeout in seconds for the first page load | `60` |
| `retries` | Number of retries for initial page load | `3` |
| `numWorkers` | Number of concurrent workers | `1` |

You can modify these settings in the `config.json` file to customize your crawl. For example:

```json
{
  "settings": {
    "url": "https://docs.example.com",
    "outputDir": "./my_docs",
    "excludePaths": ["/blog", "/forum"],
    "maxPagesPerSecond": 5,
    "maxDepth": 4,
    "numWorkers": 3
  }
}
```

### 🌟 Example Workflow

1. Start an initial crawl:
   ```bash
   npm start -- -u https://docs.example.com -o ./my_docs -d 3 -w 2
   ```

2. If the crawl is interrupted, Web-to-MD will save the state in `./my_docs/config.json`.

3. To resume, simply run:
   ```bash
   npm start -- -o ./my_docs
   ```

4. To customize, edit `./my_docs/config.json` to change the crawl settings as needed. For example:

```json
{
  "settings": {
    "url": "https://docs.example.com",
    "outputDir": "./my_docs",
    "excludePaths": ["/blog", "/forum"],
    "maxPagesPerSecond": 5,
    "maxDepth": 4,
    "numWorkers": 3
  }
}
```

5. Run the crawl again with the updated config:
   ```bash
   npm start -- -o ./my_docs
   ```

This workflow allows you to fine-tune your crawls and easily pick up where you left off!

## 🎭 Contributing

Got ideas? Found a bug? We're all ears! Open an issue or send a pull request. Let's make Web-to-MD even more awesome together! 🤝

## 📜 License

ISC (It's So Cool) License

## 🙏 Acknowledgements

A big thank you to all the open-source projects that made Web-to-MD possible. You rock! 🎸

Now go forth and crawl some docs! 🕷️📚