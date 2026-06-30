import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

type FrontmatterValue = string | boolean | string[] | undefined
type Frontmatter = Record<string, FrontmatterValue>

type ParsedMarkdown = {
  frontmatter: Frontmatter
  body: string
}

type FastGptState = {
  version: 1
  updatedAt: string
  posts: Record<string, FastGptStatePost>
}

type FastGptStatePost = {
  file: string
  title: string
  slug: string
  hash: string
  collectionId: string
  lastSyncedAt: string
}

type SyncPost = {
  key: string
  file: string
  title: string
  slug: string
  hash: string
  tags: string[]
  content: string
  metadata: Record<string, unknown>
}

const projectRoot = process.cwd()
const postsDir = path.resolve(process.env.BLOG_FASTGPT_POSTS_DIR ?? path.join(projectRoot, 'src/content/posts'))
const stateFile = path.resolve(process.env.FASTGPT_STATE_FILE ?? path.join(projectRoot, '.fastgpt-sync-state.json'))
const dryRun = process.argv.includes('--dry-run')
const prune = !process.argv.includes('--no-prune')

const fastgptBaseUrl = trimTrailingSlash(process.env.FASTGPT_BASE_URL)
const fastgptApiKey = process.env.FASTGPT_API_KEY
const fastgptDatasetId = process.env.FASTGPT_DATASET_ID
const fastgptParentId = process.env.FASTGPT_PARENT_ID || null
const trainingType = process.env.FASTGPT_TRAINING_TYPE ?? 'chunk'
const chunkSettingMode = process.env.FASTGPT_CHUNK_SETTING_MODE ?? 'auto'
const qaPrompt = process.env.FASTGPT_QA_PROMPT ?? ''
const blogBaseUrl = trimTrailingSlash(process.env.FASTGPT_BLOG_BASE_URL) ?? 'https://flower4night.xyz'

function parseMarkdown(content: string): ParsedMarkdown {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { frontmatter: {}, body: content }
  }

  const normalized = content.replace(/\r\n/g, '\n')
  const end = normalized.indexOf('\n---\n', 4)
  if (end === -1) {
    return { frontmatter: {}, body: content }
  }

  return {
    frontmatter: parseFrontmatter(normalized.slice(4, end)),
    body: normalized.slice(end + '\n---\n'.length)
  }
}

function parseFrontmatter(frontmatterText: string): Frontmatter {
  const lines = frontmatterText.split('\n')
  const data: Frontmatter = {}

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim() || line.trimStart().startsWith('#')) continue

    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue

    const [, key, rawValue] = match
    if (rawValue === '') {
      const values: string[] = []
      while (index + 1 < lines.length) {
        const next = lines[index + 1]
        const item = next.match(/^\s*-\s*(.*)$/)
        if (!item) break
        values.push(parseScalar(item[1]) as string)
        index += 1
      }
      data[key] = values
      continue
    }

    data[key] = parseScalar(rawValue)
  }

  return data
}

function parseScalar(value: string): FrontmatterValue {
  const trimmed = value.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function findMarkdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry)
    if (path.relative(postsDir, fullPath).split(path.sep).includes('_assets')) return []

    const stats = statSync(fullPath)
    if (stats.isDirectory()) return findMarkdownFiles(fullPath)
    if (stats.isFile() && /\.(md|mdx)$/i.test(entry)) return [fullPath]
    return []
  })
}

function getString(data: Frontmatter, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function getBoolean(data: Frontmatter, key: string): boolean {
  return data[key] === true || data[key] === 'true'
}

function getTags(data: Frontmatter): string[] {
  const tags = data.tags
  if (Array.isArray(tags)) return tags.map((tag) => String(tag).trim()).filter(Boolean)
  if (typeof tags === 'string' && tags.trim())
    return tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
  return []
}

function buildSyncPost(filePath: string): SyncPost | null {
  const relativeFile = path.relative(postsDir, filePath).replaceAll(path.sep, '/')
  const parsed = parseMarkdown(readFileSync(filePath, 'utf8'))
  if (!getBoolean(parsed.frontmatter, 'published') || !getBoolean(parsed.frontmatter, 'sync_fastgpt')) {
    return null
  }

  const title = getString(parsed.frontmatter, 'title') ?? path.basename(filePath, path.extname(filePath))
  const slug = getString(parsed.frontmatter, 'slug') ?? path.basename(filePath, path.extname(filePath))
  const tags = getTags(parsed.frontmatter)
  const url = `${blogBaseUrl}/${slug}/`
  const body = normalizeBodyForKnowledgeBase(parsed.body)
  const content = [
    `# ${title}`,
    '',
    getString(parsed.frontmatter, 'description') ? `摘要：${getString(parsed.frontmatter, 'description')}` : '',
    getString(parsed.frontmatter, 'category') ? `分类：${getString(parsed.frontmatter, 'category')}` : '',
    tags.length > 0 ? `标签：${tags.join(', ')}` : '',
    `原文链接：${url}`,
    '',
    body.trim()
  ]
    .filter((line) => line !== '')
    .join('\n')

  return {
    key: slug,
    file: relativeFile,
    title,
    slug,
    tags,
    content,
    hash: sha256(content),
    metadata: {
      source: 'flower-chiri',
      file: relativeFile,
      slug,
      url,
      title,
      category: getString(parsed.frontmatter, 'category'),
      tags,
      pubDate: getString(parsed.frontmatter, 'pubDate'),
      updated: getString(parsed.frontmatter, 'updated')
    }
  }
}

function normalizeBodyForKnowledgeBase(body: string): string {
  return body
    .replace(/!\[([^\]]*)\]\(<([^>]+)>\)/g, (_match, alt: string, target: string) => {
      const name = path.basename(target)
      return alt ? `[图片：${alt}，文件：${name}]` : `[图片：${name}]`
    })
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, target: string) => {
      const name = path.basename(target)
      return alt ? `[图片：${alt}，文件：${name}]` : `[图片：${name}]`
    })
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function readState(): FastGptState {
  if (!existsSync(stateFile)) {
    return { version: 1, updatedAt: new Date(0).toISOString(), posts: {} }
  }

  return JSON.parse(readFileSync(stateFile, 'utf8')) as FastGptState
}

function writeState(state: FastGptState) {
  mkdirSync(path.dirname(stateFile), { recursive: true })
  state.updatedAt = new Date().toISOString()
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`)
}

async function fastgptRequest<T>(pathname: string, init: RequestInit): Promise<T> {
  if (!fastgptBaseUrl || !fastgptApiKey) {
    throw new Error('缺少 FASTGPT_BASE_URL 或 FASTGPT_API_KEY')
  }

  const response = await fetch(`${fastgptBaseUrl}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${fastgptApiKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  })
  const payload = (await response.json()) as { code?: number; message?: string; data?: T }

  if (!response.ok || payload.code !== 200) {
    throw new Error(`FastGPT API 请求失败 ${pathname}: ${payload.message || response.statusText}`)
  }

  return payload.data as T
}

async function deleteCollections(collectionIds: string[]) {
  if (collectionIds.length === 0) return
  await fastgptRequest<null>('/api/core/dataset/collection/delete', {
    method: 'DELETE',
    body: JSON.stringify({ collectionIds })
  })
}

async function createTextCollection(post: SyncPost) {
  if (!fastgptDatasetId) {
    throw new Error('缺少 FASTGPT_DATASET_ID')
  }

  const data = await fastgptRequest<{ collectionId: string; results?: { insertLen?: number } }>(
    '/api/core/dataset/collection/create/text',
    {
      method: 'POST',
      body: JSON.stringify({
        text: post.content,
        datasetId: fastgptDatasetId,
        parentId: fastgptParentId,
        name: post.title,
        trainingType,
        chunkSettingMode,
        qaPrompt,
        tags: post.tags,
        metadata: post.metadata
      })
    }
  )

  return data
}

function assertRuntimeConfig() {
  if (dryRun) return

  const missing = [
    ['FASTGPT_BASE_URL', fastgptBaseUrl],
    ['FASTGPT_API_KEY', fastgptApiKey],
    ['FASTGPT_DATASET_ID', fastgptDatasetId]
  ].filter(([, value]) => !value)

  if (missing.length > 0) {
    console.error(`缺少环境变量：${missing.map(([key]) => key).join(', ')}`)
    process.exit(1)
  }
}

function trimTrailingSlash(value: string | undefined) {
  return value?.replace(/\/+$/, '')
}

async function main() {
  assertRuntimeConfig()

  if (!existsSync(postsDir)) {
    console.error(`找不到博客文章目录：${postsDir}`)
    process.exit(1)
  }

  const posts = findMarkdownFiles(postsDir)
    .map(buildSyncPost)
    .filter((post): post is SyncPost => Boolean(post))
  const state = readState()
  const currentKeys = new Set(posts.map((post) => post.key))
  let created = 0
  let updated = 0
  let unchanged = 0
  let deleted = 0

  console.log(`FastGPT posts: ${postsDir}`)
  console.log(`State file: ${stateFile}`)
  console.log(`匹配 sync_fastgpt 文章：${posts.length}`)
  if (dryRun) console.log('当前为 dry-run，不会请求 FastGPT，也不会写入状态文件。')

  for (const post of posts) {
    const previous = state.posts[post.key]

    if (previous?.hash === post.hash && previous.collectionId) {
      unchanged += 1
      console.log(`未变化：${post.title}`)
      continue
    }

    if (dryRun) {
      console.log(`${previous ? '将更新' : '将创建'}：${post.title}`)
      continue
    }

    if (previous?.collectionId) {
      await deleteCollections([previous.collectionId])
      updated += 1
    } else {
      created += 1
    }

    const result = await createTextCollection(post)
    state.posts[post.key] = {
      file: post.file,
      title: post.title,
      slug: post.slug,
      hash: post.hash,
      collectionId: result.collectionId,
      lastSyncedAt: new Date().toISOString()
    }
    console.log(`${previous ? '已更新' : '已创建'}：${post.title} -> ${result.collectionId}`)
  }

  const staleEntries = Object.entries(state.posts).filter(([key, value]) => !currentKeys.has(key) && value.collectionId)
  if (prune) {
    if (dryRun) {
      staleEntries.forEach(([, value]) => console.log(`将删除：${value.title} -> ${value.collectionId}`))
    } else if (staleEntries.length > 0) {
      await deleteCollections(staleEntries.map(([, value]) => value.collectionId))
      staleEntries.forEach(([key]) => delete state.posts[key])
      deleted = staleEntries.length
    }
  }

  if (!dryRun) writeState(state)

  console.log(`创建：${created}`)
  console.log(`更新：${updated}`)
  console.log(`未变化：${unchanged}`)
  console.log(`删除：${deleted}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
