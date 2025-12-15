import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import zlib from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { execSync } from 'node:child_process';
import { defineConfig, type PluginOption } from 'vite';

const repoName = process.env.GITHUB_REPOSITORY?.split('/').pop();
const base =
  process.env.VITE_BASE_PATH ??
  (process.env.GITHUB_ACTIONS && repoName ? `/${repoName}/` : '/');
const defaultRepo = process.env.GITHUB_REPOSITORY || 'darknessest/scrabble-wpa';

const DEV_DICT_BASE_PATH = '/dev-dicts';
const DEV_DICT_MOCK_BASE_PATH = '/dev-dicts-mock';
const dirname = path.dirname(fileURLToPath(import.meta.url));
const devCacheRoot = path.join(dirname, '.dev-assets');
const realDictDir = path.join(devCacheRoot, 'dicts');
const mockDictDir = path.join(devCacheRoot, 'dicts-mock');

type DictionarySource = { filename: string; url: string };
type MockDictionary = { name: string; entries: Array<Record<string, unknown>> };
type ConnectMiddleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

function pad(v: number) {
  return v.toString().padStart(2, '0');
}

function getVersion() {
  try {
    const raw = execSync('git log -1 --format=%ct\\ %h', { encoding: 'utf8' }).trim();
    const [ts, hash] = raw.split(' ');
    const date = new Date(Number(ts) * 1000);
    const formatted = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(
      date.getUTCDate()
    )}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
    return `${formatted}-${hash}`;
  } catch (err) {
    console.warn('Version generation failed, falling back to dev:', err);
    return 'dev';
  }
}

function dictionarySources(repo: string): DictionarySource[] {
  const baseUrl = `https://raw.githubusercontent.com/${repo}/assets/dicts`;
  return [
    { filename: 'en.json.gz', url: `${baseUrl}/en.json.gz` },
    { filename: 'ru.json.gz', url: `${baseUrl}/ru.json.gz` },
    { filename: 'ru-strict.json.gz', url: `${baseUrl}/ru-strict.json.gz` }
  ];
}

const mockDictionaries: MockDictionary[] = [
  {
    name: 'en',
    entries: [
      { word: 'CAT', pos: ['noun'], plural: 'CATS' },
      { word: 'DOG', pos: ['noun'], plural: 'DOGS' },
      { word: 'PLAY', pos: ['verb'], forms: ['PLAYS', 'PLAYED', 'PLAYING'] },
      { word: 'QUIZ', pos: ['noun'], plural: 'QUIZZES', forms: ['QUIZZED', 'QUIZZING'] },
      { word: 'JAZZ', pos: ['noun'], plural: 'JAZZES' }
    ]
  },
  {
    name: 'ru',
    entries: [
      { word: 'КОТ', pos: ['noun'], plural: 'КОТЫ' },
      { word: 'СЛОВО', pos: ['noun'], plural: 'СЛОВА' },
      { word: 'ИГРА', pos: ['noun'], plural: 'ИГРЫ' },
      { word: 'КОД', pos: ['noun'], plural: 'КОДЫ' },
      { word: 'ПИСАТЬ', pos: ['verb'], base: 'ПИСАТЬ', forms: ['ПИШУ', 'ПИШЕШЬ'] }
    ]
  },
  {
    name: 'ru-strict',
    entries: [
      { word: 'КОТ', pos: ['noun'], plural: 'КОТЫ' },
      { word: 'МИР', pos: ['noun'], plural: 'МИРЫ' },
      { word: 'ЛУНА', pos: ['noun'], plural: 'ЛУНЫ' },
      { word: 'КОД', pos: ['noun'], plural: 'КОДЫ' }
    ]
  }
];

async function downloadFile(url: string, dest: string) {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  return new Promise<void>((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          // Redirect
          downloadFile(response.headers.location, dest).then(resolve).catch(reject);
          return;
        }
        if (response.statusCode !== 200 || !response.pipe) {
          reject(new Error(`Failed to download ${url}: ${response.statusCode ?? 'unknown'} ${response.statusMessage ?? ''}`));
          return;
        }

        const fileStream = fs.createWriteStream(dest);
        pipeline(response, fileStream)
          .then(() => resolve())
          .catch((err) => {
            void fs.promises.unlink(dest).catch(() => {});
            reject(err);
          });
      })
      .on('error', reject);
  });
}

async function ensureFile(url: string, dest: string) {
  try {
    const stat = await fs.promises.stat(dest);
    if (stat.size > 0) return;
  } catch {
    // continue to download
  }
  console.info(`[dev-dicts] Downloading ${url}`);
  await downloadFile(url, dest);
}

async function ensureRealDictionaries(repo: string) {
  const sources = dictionarySources(repo);
  await Promise.all(
    sources.map(({ url, filename }) => ensureFile(url, path.join(realDictDir, filename)))
  );
}

async function ensureMockDictionaries() {
  await fs.promises.mkdir(mockDictDir, { recursive: true });

  await Promise.all(
    mockDictionaries.map(async ({ name, entries }) => {
      const json = JSON.stringify(entries, null, 2);
      const jsonPath = path.join(mockDictDir, `${name}.json`);
      const gzPath = `${jsonPath}.gz`;
      await fs.promises.writeFile(jsonPath, json, 'utf8');
      await fs.promises.writeFile(gzPath, zlib.gzipSync(json));
    })
  );
}

function createDictMiddleware(basePath: string, dir: string): ConnectMiddleware {
  return async function dictMiddleware(req, res, next) {
    const url = req.url?.split('?')[0];
    if (!url || !url.startsWith(basePath)) return next();
    const relative = url.slice(basePath.length) || '/';
    const sanitized = relative.replace(/^\/+/, '');
    const filePath = path.join(dir, sanitized);
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) return next();
      if (filePath.endsWith('.gz')) {
        res.setHeader('Content-Type', 'application/gzip');
      } else if (filePath.endsWith('.json')) {
        res.setHeader('Content-Type', 'application/json');
      }
      const stream = fs.createReadStream(filePath);
      stream.on('error', next);
      stream.pipe(res);
    } catch {
      next();
    }
  };
}

function devDictionariesPlugin(repo: string): PluginOption {
  return {
    name: 'dev-dictionaries',
    apply: 'serve',
    async configureServer(server) {
      try {
        await ensureRealDictionaries(repo);
      } catch (err) {
        console.warn('[dev-dicts] Failed to download full dictionaries:', err);
      }
      try {
        await ensureMockDictionaries();
      } catch (err) {
        console.warn('[dev-dicts] Failed to prepare mock dictionaries:', err);
      }

      console.info(`[dev-dicts] Serving real dictionaries at ${DEV_DICT_BASE_PATH}`);
      console.info(`[dev-dicts] Serving mock dictionaries at ${DEV_DICT_MOCK_BASE_PATH}`);

      const realMiddleware = createDictMiddleware(DEV_DICT_BASE_PATH, realDictDir);
      const mockMiddleware = createDictMiddleware(DEV_DICT_MOCK_BASE_PATH, mockDictDir);

      server.middlewares.use(realMiddleware);
      server.middlewares.use(mockMiddleware);
    }
  };
}

const version = getVersion();

export default defineConfig(({ command }) => {
  const isServe = command === 'serve';

  const define = {
    __APP_VERSION__: JSON.stringify(version),
    ...(process.env.GITHUB_REPOSITORY && {
      'import.meta.env.VITE_GITHUB_REPO': JSON.stringify(process.env.GITHUB_REPOSITORY)
    }),
    ...(isServe && {
      'import.meta.env.VITE_DICT_BASE': JSON.stringify(DEV_DICT_BASE_PATH),
      'import.meta.env.VITE_DICT_STRICT_BASE': JSON.stringify(DEV_DICT_BASE_PATH),
      'import.meta.env.VITE_DICT_MOCK_BASE': JSON.stringify(DEV_DICT_MOCK_BASE_PATH)
    })
  };

  const plugins: PluginOption[] = [];
  if (isServe) {
    plugins.push(devDictionariesPlugin(defaultRepo));
  }

  return {
    base,
    define,
    plugins,
    test: {
      globals: true,
      environment: 'node',
      include: ['src/**/*.test.ts'],
      coverage: {
        provider: 'v8',
        include: ['src/core/**', 'src/dictionary/**']
      }
    }
  };
});


