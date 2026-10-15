import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('the actual workflow creates an isolated data branch and restores it on the next run', (t) => {
  const project = fileURLToPath(new URL('../', import.meta.url));
  const scratch = path.join(project, '.wrangler');
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(path.join(scratch, 'daily-workflow-'));
  // Every mutation and recursive cleanup is confined to this newly created fixture.
  assert.ok(path.resolve(root).startsWith(path.resolve(scratch) + path.sep));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  if (process.platform === 'win32' && !existsSync(bash)) return t.skip('Git Bash unavailable');
  const run = (cmd, args, cwd, env = {}) => {
    assert.ok(path.resolve(cwd).startsWith(path.resolve(root)));
    const result = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return result.stdout;
  };
  const git = (cwd, ...args) => run('git', args, cwd);
  const remote = path.join(root, 'remote.git');
  git(root, 'init', '--bare', '--initial-branch=main', remote);
  const initial = path.join(root, 'initial');
  git(root, 'clone', remote, initial);
  git(initial, 'config', 'user.name', 'Workflow test');
  git(initial, 'config', 'user.email', 'workflow@example.invalid');
  git(initial, 'config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(initial, 'source-marker.txt'), 'application source');
  git(initial, 'add', '.'); git(initial, 'commit', '-m', 'Initial source');
  git(initial, 'push', 'origin', 'main');
  const workflow = readFileSync(new URL('../.github/workflows/history.yml', import.meta.url), 'utf8');
  const block = (name) => {
    const text = workflow.split(`- name: ${name}\n`)[1];
    assert.ok(text, `Missing workflow step: ${name}`);
    return text.split('        run: |\n')[1].split('\n      - name:')[0]
      .split('\n').map((line) => line.replace(/^          /, '')).join('\n');
  };
  for (let pass = 1; pass <= 2; pass++) {
    const repo = path.join(root, `runner-${pass}`);
    git(root, 'clone', remote, repo);
    git(repo, 'config', 'commit.gpgsign', 'false');
    const temp = path.join(root, `temp-${pass}`); mkdirSync(temp);
    const env = { RUNNER_TEMP: temp.replaceAll('\\', '/'), HISTORY_TERM: '02027' };
    run(bash, ['-c', block('Restore persistent history branch')], repo, env);
    const output = path.join(temp, 'daily-history', 'history-02027.json');
    const payload = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : { observations: [] };
    payload.observations.push(pass);
    writeFileSync(output, JSON.stringify(payload));
    run(bash, ['-c', block('Publish history without rebuilding the application')], repo, env);
    assert.equal(existsSync(path.join(temp, 'daily-history', 'source-marker.txt')), false);
    assert.equal(readFileSync(path.join(repo, 'source-marker.txt'), 'utf8'), 'application source');
  }
  assert.deepEqual(JSON.parse(git(remote, 'show', 'history-data:history-02027.json')).observations, [1, 2]);
  assert.equal(JSON.parse(git(remote, 'show', 'history-data:vercel.json')).ignoreCommand, 'exit 0');
});
