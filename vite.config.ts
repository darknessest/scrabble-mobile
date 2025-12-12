import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

const repoName = process.env.GITHUB_REPOSITORY?.split('/').pop();
const base =
  process.env.VITE_BASE_PATH ??
  (process.env.GITHUB_ACTIONS && repoName ? `/${repoName}/` : '/');

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

const version = getVersion();

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(version)
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/dictionary/**']
    }
  }
});


