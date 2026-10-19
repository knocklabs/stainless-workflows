// Turns an OpenAPI bump into the spec-PR title that release-please later
// prints as the SDK changelog bullet. oasdiff plus a schema walk produce a
// few KB of facts; a pinned cheap model rewrites those into one subject.
// Any failure keeps today's version-only title so a publish is never blocked.

import { execFile } from 'node:child_process'
import { readFileSync, appendFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const execFileAsync = promisify(execFile)

export const MODEL_ID = 'anthropic/claude-haiku-5.5'
const MAX_CHANGES = 40
const MAX_OPS_PER_CHANGE = 8
export const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/messages'

const TOOL = {
  name: 'changelog_summary',
  description: 'SDK changelog subject and short bullets for one OpenAPI spec bump.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      subject: {
        type: 'string',
        description: 'One conventional-commit subject, "feat: " or "fix: ", with no version and no trailing period.',
      },
      bullets: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 5,
        description: 'Up to five short phrases naming concrete additions or removals.',
      },
      breaking: {
        type: 'boolean',
        description: 'True only when the input breaking list is non-empty. Never a reason to use feat!:.',
      },
    },
    required: ['subject', 'bullets', 'breaking'],
  },
}

export function fallbackTitle(specLabel, version) {
  const label = String(specLabel || 'api').trim() || 'api'
  const ver = String(version || '').trim()
  return ver ? `feat: update ${label} spec to ${ver}` : `feat: update ${label} spec`
}

export function isNoiseChange(change) {
  return /(description|example)/i.test(String(change?.id ?? ''))
}

function backtickLeaves(text) {
  const leaves = []
  for (const match of String(text ?? '').matchAll(/`([^`]+)`/g)) {
    const leaf = match[1].split('/').pop().split('.').pop()
    if (leaf && !leaves.includes(leaf)) leaves.push(leaf)
  }
  leaves.sort()
  return leaves.join('|')
}

export function collapseChanges(changes, limit = MAX_CHANGES) {
  const groups = new Map()
  for (const change of changes ?? []) {
    if (!change || isNoiseChange(change)) continue
    const key = `${change.id}|${backtickLeaves(change.text)}`
    let group = groups.get(key)
    if (!group) {
      group = {
        id: change.id,
        level: change.level ?? 0,
        text: String(change.text ?? ''),
        operations: [],
      }
      groups.set(key, group)
    }
    group.level = Math.max(group.level, change.level ?? 0)
    const text = String(change.text ?? '')
    if (text && text.length < group.text.length) group.text = text
    const operation = {
      operationId: change.operationId || '',
      method: change.operation || '',
      path: change.path || '',
    }
    if (!operation.operationId && !operation.path) continue
    const signature = `${operation.method} ${operation.path} ${operation.operationId}`
    if (!group.operations.some((existing) => `${existing.method} ${existing.path} ${existing.operationId}` === signature)) {
      group.operations.push(operation)
    }
  }

  let list = [...groups.values()]
  list.sort((a, b) => (b.level - a.level) || a.text.localeCompare(b.text))
  const truncated = list.length > limit
  list = list.slice(0, limit)
  for (const group of list) {
    if (group.operations.length > MAX_OPS_PER_CHANGE) {
      const omitted = group.operations.length - MAX_OPS_PER_CHANGE
      group.operations = group.operations.slice(0, MAX_OPS_PER_CHANGE)
      group.operations_omitted = omitted
    }
  }
  return { changes: list, truncated }
}

function clip(text) {
  if (typeof text !== 'string' || !text.trim()) return ''
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= 180 ? one : `${one.slice(0, 177)}...`
}

function walkSchema(schema, visit, prefix = '') {
  if (!schema || typeof schema !== 'object' || schema.$ref) return
  visit(schema, prefix)
  if (schema.properties && typeof schema.properties === 'object') {
    for (const [name, child] of Object.entries(schema.properties)) {
      walkSchema(child, visit, prefix ? `${prefix}.${name}` : name)
    }
  }
  if (schema.items) walkSchema(schema.items, visit, prefix ? `${prefix}[]` : '[]')
  for (const key of ['allOf', 'anyOf', 'oneOf']) {
    if (Array.isArray(schema[key])) {
      for (const child of schema[key]) walkSchema(child, visit, prefix)
    }
  }
}

function snapshotSchema(schema) {
  const props = new Set()
  const descriptions = new Map()
  const enums = []
  walkSchema(schema, (node, prefix) => {
    if (node.properties && typeof node.properties === 'object') {
      for (const [name, child] of Object.entries(node.properties)) {
        const propPath = prefix ? `${prefix}.${name}` : name
        props.add(propPath)
        if (child && typeof child.description === 'string') descriptions.set(propPath, child.description)
      }
    }
    if (Array.isArray(node.enum)) {
      enums.push({
        path: prefix || '$',
        values: node.enum.map((value) => (typeof value === 'string' ? value : JSON.stringify(value))),
      })
    }
  })
  return { props, descriptions, enums }
}

function enumMap(list) {
  const map = new Map()
  for (const item of list) map.set(item.path, new Set(item.values))
  return map
}

export function schemaFacts(previous, current) {
  const prev = previous?.components?.schemas ?? {}
  const next = current?.components?.schemas ?? {}
  const added = []
  const removed = []
  const propertiesAdded = []
  const propertiesRemoved = []
  const enumValuesAdded = []
  const enumValuesRemoved = []

  for (const name of Object.keys(next)) {
    if (!(name in prev)) {
      const fact = { name }
      const description = clip(next[name]?.description)
      if (description) fact.description = description
      added.push(fact)
    }
  }
  for (const name of Object.keys(prev)) {
    if (!(name in next)) removed.push({ name })
  }
  for (const name of Object.keys(next)) {
    if (!(name in prev)) continue
    const before = snapshotSchema(prev[name])
    const after = snapshotSchema(next[name])
    for (const propPath of after.props) {
      if (before.props.has(propPath)) continue
      const fact = { schema: name, path: propPath }
      const description = clip(after.descriptions.get(propPath))
      if (description) fact.description = description
      propertiesAdded.push(fact)
    }
    for (const propPath of before.props) {
      if (!after.props.has(propPath)) propertiesRemoved.push({ schema: name, path: propPath })
    }
    const beforeEnums = enumMap(before.enums)
    const afterEnums = enumMap(after.enums)
    for (const propPath of new Set([...beforeEnums.keys(), ...afterEnums.keys()])) {
      const oldValues = beforeEnums.get(propPath) ?? new Set()
      const newValues = afterEnums.get(propPath) ?? new Set()
      const plus = [...newValues].filter((value) => !oldValues.has(value))
      const minus = [...oldValues].filter((value) => !newValues.has(value))
      if (plus.length) enumValuesAdded.push({ schema: name, path: propPath, values: plus.slice(0, 15) })
      if (minus.length) enumValuesRemoved.push({ schema: name, path: propPath, values: minus.slice(0, 15) })
    }
  }

  return {
    added: added.slice(0, 20),
    removed: removed.slice(0, 20),
    properties_added: propertiesAdded.slice(0, 40),
    properties_removed: propertiesRemoved.slice(0, 40),
    enum_values_added: enumValuesAdded.slice(0, 20),
    enum_values_removed: enumValuesRemoved.slice(0, 20),
    truncated: added.length > 20 || removed.length > 20 || propertiesAdded.length > 40
      || propertiesRemoved.length > 40 || enumValuesAdded.length > 20 || enumValuesRemoved.length > 20,
  }
}

function operationIndex(spec) {
  const index = new Map()
  for (const [specPath, item] of Object.entries(spec?.paths ?? {})) {
    if (!item || typeof item !== 'object') continue
    for (const [method, operation] of Object.entries(item)) {
      if (!operation || typeof operation !== 'object' || !operation.operationId) continue
      index.set(operation.operationId, {
        summary: typeof operation.summary === 'string' ? operation.summary : '',
        method: method.toUpperCase(),
        path: specPath,
      })
    }
  }
  return index
}

function attachSummaries(change, index) {
  return {
    ...change,
    operations: change.operations.map((operation) => {
      const known = index.get(operation.operationId)
      if (!known) return operation
      return {
        ...operation,
        method: operation.method || known.method,
        path: operation.path || known.path,
        summary: known.summary,
      }
    }),
  }
}

export function readMethods(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('+ client.'))
    .map((line) => line.slice(2))
    .slice(0, 20)
}

export function buildPayload({ previous, current, changelog, breaking, methods, specLabel, version }) {
  const collapsed = collapseChanges(changelog)
  const collapsedBreaking = collapseChanges(breaking)
  const index = operationIndex(current)
  const schemas = schemaFacts(previous, current)
  return {
    spec_label: specLabel,
    version,
    changes: collapsed.changes.map((change) => attachSummaries(change, index)),
    breaking: collapsedBreaking.changes.map((change) => attachSummaries(change, index)),
    schemas,
    new_sdk_methods: readMethods(methods),
    truncated: collapsed.truncated || collapsedBreaking.truncated || schemas.truncated,
  }
}

export function hasBehavioralChanges(payload) {
  const schemas = payload.schemas
  return payload.changes.length > 0
    || payload.breaking.length > 0
    || schemas.added.length > 0
    || schemas.removed.length > 0
    || schemas.properties_added.length > 0
    || schemas.properties_removed.length > 0
    || schemas.enum_values_added.length > 0
    || schemas.enum_values_removed.length > 0
}

// Changelog subjects land in `git commit` and `gh pr create`. Keep them to
// plain prose so a model reply cannot break out of the shell quoting.
const SUBJECT_BODY = /^[A-Za-z0-9][A-Za-z0-9 .,:'/+_#()&-]{9,99}$/

export function acceptSubject(raw) {
  let subject = String(raw ?? '').trim().replace(/\s+/g, ' ')
  subject = subject.replace(/^(feat|fix)(\([^)\n]+\))?!:\s*/, '$1$2: ')
  subject = subject.replace(/\.$/, '')
  if (!/^(feat|fix)(\([A-Za-z0-9][A-Za-z0-9 ._/-]{0,40}\))?: /.test(subject)) return null
  const body = subject.replace(/^(feat|fix)(\([^)]+\))?:\s+/, '')
  if (!SUBJECT_BODY.test(body)) return null
  return subject
}

export function withVersion(subject, version) {
  const ver = String(version || '').trim()
  if (!ver || subject.includes(ver)) return subject
  const titled = `${subject} (${ver})`
  return titled.length <= 240 ? titled : null
}

function cleanBullets(bullets) {
  if (!Array.isArray(bullets)) return []
  const cleaned = []
  for (const bullet of bullets) {
    const text = String(bullet ?? '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    cleaned.push(text.length <= 160 ? text : `${text.slice(0, 157)}...`)
    if (cleaned.length === 5) break
  }
  return cleaned
}

function diffLines(payload) {
  const lines = []
  for (const change of payload.changes.slice(0, 20)) {
    const shown = change.operations.slice(0, 4)
    const hidden = change.operations.length - shown.length + (change.operations_omitted || 0)
    const labels = shown
      .map((operation) => (operation.summary ? `${operation.operationId} (${operation.summary})` : operation.operationId))
      .filter(Boolean)
    const where = labels.length
      ? ` — ${labels.join(', ')}${hidden > 0 ? ` (+${hidden} more)` : ''}`
      : ''
    lines.push(`- ${change.text}${where}`)
  }
  for (const schema of payload.schemas.added) lines.push(`- added schema \`${schema.name}\``)
  for (const schema of payload.schemas.removed) lines.push(`- removed schema \`${schema.name}\``)
  for (const prop of payload.schemas.properties_added) lines.push(`- added \`${prop.schema}.${prop.path}\``)
  for (const prop of payload.schemas.properties_removed) lines.push(`- removed \`${prop.schema}.${prop.path}\``)
  for (const item of payload.schemas.enum_values_added) {
    lines.push(`- added enum ${item.values.map((value) => `\`${value}\``).join(', ')} on \`${item.schema}.${item.path}\``)
  }
  for (const item of payload.schemas.enum_values_removed) {
    lines.push(`- removed enum ${item.values.map((value) => `\`${value}\``).join(', ')} on \`${item.schema}.${item.path}\``)
  }
  return lines.slice(0, 30)
}

export function renderBody({ payload, bullets, reason }) {
  if (!hasBehavioralChanges(payload)) return ''
  const lines = ['## API changes', '']
  if (reason) {
    lines.push(reason, '')
  }
  if (bullets?.length) {
    for (const bullet of bullets) lines.push(`- ${bullet}`)
    lines.push('')
  }
  const facts = diffLines(payload)
  if (facts.length) {
    lines.push('OpenAPI diff:', '', ...facts, '')
  }
  if (payload.breaking.length) {
    lines.push(
      '> [!WARNING]',
      '> oasdiff reports changes it treats as breaking. This PR stays `feat:` so merging will not cut a major SDK version. Retitle to `feat!:` before merging if that bump is intended.',
      '>',
    )
    for (const change of payload.breaking.slice(0, 10)) lines.push(`> - ${change.text}`)
    lines.push('')
  }
  return `${lines.join('\n').trim()}\n`
}

const NO_KEY_REASON = 'No AI Gateway API key is configured, so the commit subject keeps the spec version. The notes below are the OpenAPI diff.'
const INVALID_REASON = 'The changelog subject fell back to the spec version because the summary was missing or invalid.'

export function summaryFromModel({ payload, specLabel, version, modelInput, failureReason }) {
  const fallback = fallbackTitle(specLabel, version)
  if (!hasBehavioralChanges(payload)) {
    return { title: fallback, bodyNotes: '', usedFallback: true, breaking: false }
  }
  const accepted = modelInput ? acceptSubject(modelInput.subject) : null
  const title = accepted ? withVersion(accepted, version) : null
  if (!title) {
    return {
      title: fallback,
      bodyNotes: renderBody({ payload, bullets: [], reason: failureReason || INVALID_REASON }),
      usedFallback: true,
      breaking: payload.breaking.length > 0,
    }
  }
  return {
    title,
    bodyNotes: renderBody({ payload, bullets: cleanBullets(modelInput.bullets) }),
    usedFallback: false,
    breaking: payload.breaking.length > 0,
  }
}

function modelView(payload) {
  const viewChange = (change) => {
    const view = {
      id: change.id,
      level: change.level,
      text: change.text,
      operations: change.operations.map((operation) => ({
        operationId: operation.operationId,
        method: operation.method,
        path: operation.path,
        summary: operation.summary || '',
      })),
    }
    if (change.operations_omitted) view.operations_omitted = change.operations_omitted
    return view
  }
  return {
    spec_label: payload.spec_label,
    version: payload.version,
    changes: payload.changes.map(viewChange),
    breaking: payload.breaking.map(viewChange),
    schemas: payload.schemas,
    new_sdk_methods: payload.new_sdk_methods,
    truncated: payload.truncated,
  }
}

function promptFor(payload) {
  return [
    'Write the SDK changelog subject for this OpenAPI release.',
    'The subject is the only line developers see in the SDK changelog.',
    'Describe what a developer can do now. Prefer operation summaries and SDK method names over raw paths.',
    'Do not mention anyOf, status codes, or exploded schema paths.',
    'subject must start with "feat: " or "fix: ". Never use "feat!:" — a human decides major bumps.',
    'One line, no trailing period, and do not include the version number.',
    'The words after the prefix must be 10 to 100 characters of plain prose.',
    'bullets: at most 5 short phrases, only facts present in the input.',
    'breaking: true only when the breaking list is non-empty.',
    '',
    JSON.stringify(modelView(payload)),
  ].join('\n')
}

export function parseModelMessage(json) {
  const blocks = json?.content
  if (!Array.isArray(blocks)) return null
  const tool = blocks.find((block) => block?.type === 'tool_use' && block.name === 'changelog_summary')
  if (tool?.input && typeof tool.input === 'object') return tool.input
  const text = blocks.filter((block) => block?.type === 'text').map((block) => block.text).join('\n')
  return parseJsonContent(text)
}

function parseJsonContent(text) {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1] : text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
}

async function callModel({ apiKey, model, payload, fetchImpl }) {
  const fetchFn = fetchImpl ?? globalThis.fetch
  const response = await fetchFn(GATEWAY_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || MODEL_ID,
      max_tokens: 1024,
      // Haiku 5.5 rejects any temperature other than 1, and adaptive thinking
      // is on unless effort is lowered. Forced tool_choice returns the changelog
      // tool call with no thinking block.
      output_config: { effort: 'low' },
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'changelog_summary' },
      messages: [{ role: 'user', content: promptFor(payload) }],
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`model HTTP ${response.status}: ${text.slice(0, 300)}`)
  }
  return parseModelMessage(await response.json())
}

function asChanges(raw) {
  if (!raw || !String(raw).trim()) return []
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) return parsed
  if (Array.isArray(parsed?.changes)) return parsed.changes
  return []
}

async function tryOasdiff(bin, args) {
  if (!bin) return []
  try {
    const { stdout } = await execFileAsync(bin, args, { maxBuffer: 20 * 1024 * 1024 })
    return asChanges(stdout)
  } catch (error) {
    if (error.stdout) {
      try {
        return asChanges(error.stdout)
      } catch {
        // The process failed and stdout was not a changelog.
      }
    }
    console.error(`oasdiff failed: ${error.message}`)
    return []
  }
}

export async function summarize(options) {
  const specLabel = options.specLabel
  const version = options.version
  const fallback = fallbackTitle(specLabel, version)
  try {
    const previous = JSON.parse(await readFile(options.previous, 'utf8'))
    const current = JSON.parse(await readFile(options.current, 'utf8'))
    const [changelog, breaking] = await Promise.all([
      tryOasdiff(options.oasdiff, ['changelog', options.previous, options.current, '--format', 'json']),
      tryOasdiff(options.oasdiff, ['breaking', options.previous, options.current, '--format', 'json']),
    ])
    const payload = buildPayload({
      previous,
      current,
      changelog,
      breaking,
      methods: options.methods ?? '',
      specLabel,
      version,
    })
    if (!hasBehavioralChanges(payload)) {
      return { title: fallback, bodyNotes: '', usedFallback: true, breaking: false }
    }
    if (!options.apiKey) {
      return summaryFromModel({ payload, specLabel, version, modelInput: null, failureReason: NO_KEY_REASON })
    }
    try {
      const modelInput = await callModel({
        apiKey: options.apiKey,
        model: options.model,
        payload,
        fetchImpl: options.fetchImpl,
      })
      return summaryFromModel({
        payload,
        specLabel,
        version,
        modelInput,
        failureReason: INVALID_REASON,
      })
    } catch (error) {
      console.error(`changelog model failed: ${error.message}`)
      return summaryFromModel({ payload, specLabel, version, modelInput: null, failureReason: INVALID_REASON })
    }
  } catch (error) {
    console.error(`spec diff summary failed: ${error.message}`)
    return { title: fallback, bodyNotes: '', usedFallback: true, breaking: false }
  }
}

export function writeGithubOutput(file, fields) {
  const delim = `SPEC_DIFF_${Date.now()}_${Math.random().toString(16).slice(2)}`
  let out = ''
  for (const [key, value] of Object.entries(fields)) {
    const text = value == null ? '' : String(value).replaceAll(delim, '')
    if (/[\r\n]/.test(text)) out += `${key}<<${delim}\n${text}\n${delim}\n`
    else out += `${key}=${text}\n`
  }
  appendFileSync(file, out)
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const value = argv[i + 1]
    if (value == null || value.startsWith('--')) args[key] = ''
    else {
      args[key] = value
      i += 1
    }
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  let methods = ''
  if (args['methods-file']) {
    try {
      methods = readFileSync(args['methods-file'], 'utf8')
    } catch {
      methods = ''
    }
  }
  const result = await summarize({
    previous: args.previous,
    current: args.current,
    oasdiff: args.oasdiff || '',
    specLabel: args['spec-label'],
    version: args.version,
    methods,
    apiKey: process.env.AI_GATEWAY_API_KEY || '',
    model: process.env.CHANGELOG_MODEL || MODEL_ID,
  })
  if (args['github-output']) {
    writeGithubOutput(args['github-output'], {
      title: result.title,
      'body-notes': result.bodyNotes,
      breaking: result.breaking ? 'true' : 'false',
      fallback: result.usedFallback ? 'true' : 'false',
    })
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  }
  console.error(`changelog title: ${result.title}${result.usedFallback ? ' (fallback)' : ''}`)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  main().catch((error) => {
    console.error(`spec diff summary failed: ${error.message}`)
    process.exitCode = 0
  })
}
