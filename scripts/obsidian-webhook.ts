import { createHmac, timingSafeEqual } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import http from 'node:http'
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const host = process.env.BLOG_WEBHOOK_HOST ?? '127.0.0.1'
const port = Number(process.env.BLOG_WEBHOOK_PORT ?? 3210)
const webhookPath = process.env.BLOG_WEBHOOK_PATH ?? '/github/obsidian-webhook'
const secret = process.env.BLOG_WEBHOOK_SECRET
const deployScript = process.env.BLOG_DEPLOY_SCRIPT ?? '/home/yim/flower-chiri/scripts/deploy-blog'
const deployBranch = process.env.BLOG_WEBHOOK_BRANCH ?? 'refs/heads/main'
const maxBodyBytes = Number(process.env.BLOG_WEBHOOK_MAX_BODY_BYTES ?? 1024 * 1024)
const projectRoot = process.cwd()
const fastgptFileApiPath = normalizeRoutePath(process.env.FASTGPT_FILE_API_PATH ?? '/fastgpt-blog-files')
const fastgptFileApiToken = process.env.FASTGPT_FILE_API_TOKEN
const fastgptPostsDir = path.resolve(
  process.env.FASTGPT_FILE_API_POSTS_DIR ??
    process.env.BLOG_FASTGPT_POSTS_DIR ??
    path.join(projectRoot, 'src/content/posts')
)
const blogBaseUrl = trimTrailingSlash(process.env.FASTGPT_BLOG_BASE_URL) ?? 'https://flower4night.xyz'

let isDeploying = false

type FrontmatterValue = string | boolean | string[] | undefined
type Frontmatter = Record<string, FrontmatterValue>

type ParsedMarkdown = {
  frontmatter: Frontmatter
  body: string
}

type FastGptFileItem = {
  id: string
  parentId: string | null
  name: string
  type: 'file'
  updateTime: string
  createTime: string
  hasChild: false
}

type FastGptBlogPost = FastGptFileItem & {
  title: string
  slug: string
  filePath: string
  body: string
  summary?: string
  category?: string
  tags: string[]
  pubDate?: string
  updated?: string
}

type ProcessWithExitEvent = {
  on(event: 'exit', listener: (code: number | null, signal: string | null) => void): void
}

function json(res: http.ServerResponse, statusCode: number, body: Record<string, unknown>) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function fastgptJson(res: http.ServerResponse, statusCode: number, body: Record<string, unknown>) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function verifySignature(body: Buffer, signatureHeader: string | undefined) {
  if (!secret) return false
  if (!signatureHeader?.startsWith('sha256=')) return false

  const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(signatureHeader)

  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBodyBytes) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

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

function findMarkdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry)
    if (path.relative(fastgptPostsDir, fullPath).split(path.sep).includes('_assets')) return []

    const stats = statSync(fullPath)
    if (stats.isDirectory()) return findMarkdownFiles(fullPath)
    if (stats.isFile() && /\.(md|mdx)$/i.test(entry)) return [fullPath]
    return []
  })
}

function listFastGptBlogPosts(): FastGptBlogPost[] {
  if (!existsSync(fastgptPostsDir)) return []

  return findMarkdownFiles(fastgptPostsDir)
    .map((filePath): FastGptBlogPost | null => {
      const parsed = parseMarkdown(readFileSync(filePath, 'utf8'))
      if (!getBoolean(parsed.frontmatter, 'published') || !getBoolean(parsed.frontmatter, 'sync_fastgpt')) {
        return null
      }

      const stats = statSync(filePath)
      const title = getString(parsed.frontmatter, 'title') ?? path.basename(filePath, path.extname(filePath))
      const slug = getString(parsed.frontmatter, 'slug') ?? path.basename(filePath, path.extname(filePath))
      const updated = getString(parsed.frontmatter, 'updated')
      const pubDate = getString(parsed.frontmatter, 'pubDate') ?? getString(parsed.frontmatter, 'date')
      const updateTime = normalizeDate(updated ?? pubDate, stats.mtime)
      const createTime = normalizeDate(pubDate, stats.birthtime)

      return {
        id: slug,
        parentId: null,
        name: `${title}.md`,
        type: 'file' as const,
        updateTime,
        createTime,
        hasChild: false as const,
        title,
        slug,
        filePath,
        body: parsed.body,
        summary: getString(parsed.frontmatter, 'description') ?? getString(parsed.frontmatter, 'summary'),
        category: getString(parsed.frontmatter, 'category'),
        tags: getTags(parsed.frontmatter),
        pubDate,
        updated
      }
    })
    .filter((post): post is FastGptBlogPost => post !== null)
    .sort((left, right) => right.updateTime.localeCompare(left.updateTime))
}

function normalizeDate(value: string | undefined, fallback: Date) {
  if (!value) return fallback.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? fallback.toISOString() : parsed.toISOString()
}

function buildFastGptContent(post: FastGptBlogPost) {
  const lines = [
    `# ${post.title}`,
    '',
    post.summary ? `摘要：${post.summary}` : '',
    post.category ? `分类：${post.category}` : '',
    post.tags.length > 0 ? `标签：${post.tags.join(', ')}` : '',
    `原文链接：${postUrl(post)}`,
    '',
    normalizeBodyForKnowledgeBase(post.body).trim()
  ]

  return lines.filter((line) => line !== '').join('\n')
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

function postUrl(post: FastGptBlogPost) {
  return `${blogBaseUrl}/${post.slug}/`
}

function toFastGptFileItem(post: FastGptBlogPost): FastGptFileItem {
  return {
    id: post.id,
    parentId: post.parentId,
    name: post.name,
    type: post.type,
    updateTime: post.updateTime,
    createTime: post.createTime,
    hasChild: post.hasChild
  }
}

function findFastGptPost(id: string) {
  return listFastGptBlogPosts().find((post) => post.id === id)
}

function isAuthorizedFileApiRequest(req: http.IncomingMessage) {
  if (!fastgptFileApiToken) return false
  const authorization = req.headers.authorization
  return authorization === `Bearer ${fastgptFileApiToken}`
}

async function handleFastGptFileApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  if (!fastgptFileApiToken) {
    fastgptJson(res, 503, { success: false, message: 'FASTGPT_FILE_API_TOKEN is not configured', data: null })
    return
  }

  if (!isAuthorizedFileApiRequest(req)) {
    fastgptJson(res, 401, { success: false, message: 'Unauthorized', data: null })
    return
  }

  const route = url.pathname.slice(fastgptFileApiPath.length)
  if (req.method === 'POST' && route === '/v1/file/list') {
    let searchKey = ''
    try {
      const body = await readBody(req)
      const payload = body.length > 0 ? (JSON.parse(body.toString('utf8')) as { searchKey?: unknown }) : {}
      searchKey = typeof payload.searchKey === 'string' ? payload.searchKey.trim().toLowerCase() : ''
    } catch {
      fastgptJson(res, 400, { success: false, message: 'Invalid JSON body', data: null })
      return
    }

    const posts = listFastGptBlogPosts()
      .filter((post) => {
        if (!searchKey) return true
        return [post.id, post.name, post.title, post.summary]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(searchKey))
      })
      .map(toFastGptFileItem)

    fastgptJson(res, 200, { success: true, message: '', data: posts })
    return
  }

  if (req.method === 'GET' && route === '/v1/file/content') {
    const id = url.searchParams.get('id')
    const post = id ? findFastGptPost(id) : undefined
    if (!post) {
      fastgptJson(res, 404, { success: false, message: 'File not found', data: null })
      return
    }

    fastgptJson(res, 200, {
      success: true,
      message: '',
      data: { title: post.title, content: buildFastGptContent(post) }
    })
    return
  }

  if (req.method === 'GET' && route === '/v1/file/read') {
    const id = url.searchParams.get('id')
    const post = id ? findFastGptPost(id) : undefined
    if (!post) {
      fastgptJson(res, 404, { success: false, message: 'File not found', data: null })
      return
    }

    fastgptJson(res, 200, { success: true, message: '', data: { url: postUrl(post) } })
    return
  }

  if (req.method === 'GET' && route === '/v1/file/detail') {
    const id = url.searchParams.get('id')
    const post = id ? findFastGptPost(id) : undefined
    if (!post) {
      fastgptJson(res, 404, { success: false, message: 'File not found', data: null })
      return
    }

    fastgptJson(res, 200, { success: true, message: '', data: toFastGptFileItem(post) })
    return
  }

  fastgptJson(res, 404, { success: false, message: 'Not found', data: null })
}

function normalizeRoutePath(value: string) {
  const normalized = `/${value.trim().replace(/^\/+|\/+$/g, '')}`
  return normalized === '/' ? '' : normalized
}

function trimTrailingSlash(value: string | undefined) {
  return value?.replace(/\/+$/, '')
}

function runDeploy() {
  if (isDeploying) {
    console.log('已有部署任务正在运行，忽略本次触发。')
    return
  }

  isDeploying = true
  const child = spawn(deployScript, [], {
    stdio: 'inherit',
    env: process.env
  }) as unknown as ProcessWithExitEvent

  child.on('exit', (code, signal) => {
    isDeploying = false
    if (code === 0) {
      console.log('部署脚本执行完成。')
      return
    }
    console.error(`部署脚本异常结束：code=${code ?? 'null'} signal=${signal ?? 'null'}`)
  })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  if (req.method === 'GET' && req.url === '/healthz') {
    json(res, 200, { ok: true, fastgptFileApi: Boolean(fastgptFileApiToken) })
    return
  }

  if (url.pathname === fastgptFileApiPath || url.pathname.startsWith(`${fastgptFileApiPath}/`)) {
    await handleFastGptFileApi(req, res, url)
    return
  }

  if (req.method === 'GET' && req.url === webhookPath) {
    json(res, 200, { ok: true, service: 'obsidian-webhook' })
    return
  }

  if (req.method !== 'POST' || req.url !== webhookPath) {
    json(res, 404, { ok: false, error: 'not found' })
    return
  }

  let body: Buffer
  try {
    body = await readBody(req)
  } catch (error) {
    json(res, 413, { ok: false, error: error instanceof Error ? error.message : 'failed to read body' })
    return
  }

  if (!verifySignature(body, req.headers['x-hub-signature-256'] as string | undefined)) {
    json(res, 401, { ok: false, error: 'invalid signature' })
    return
  }

  const event = req.headers['x-github-event']
  if (event === 'ping') {
    console.log('收到 GitHub ping 事件。')
    json(res, 200, { ok: true, event: 'ping' })
    return
  }

  if (event !== 'push') {
    json(res, 202, { ok: true, skipped: `ignored event ${String(event)}` })
    return
  }

  let payload: { ref?: string }
  try {
    payload = JSON.parse(body.toString('utf8')) as { ref?: string }
  } catch {
    json(res, 400, { ok: false, error: 'invalid json payload' })
    return
  }

  if (payload.ref !== deployBranch) {
    json(res, 202, { ok: true, skipped: `ignored ref ${payload.ref ?? 'unknown'}` })
    return
  }

  runDeploy()
  console.log(`收到 ${deployBranch} push 事件，已触发部署。`)
  json(res, 202, { ok: true, deployment: 'started' })
})

if (!secret) {
  console.error('缺少 BLOG_WEBHOOK_SECRET，拒绝启动 webhook 服务。')
  process.exit(1)
}

server.listen(port, host, () => {
  console.log(`Obsidian webhook listening on http://${host}:${port}${webhookPath}`)
  console.log(`FastGPT file API path: ${fastgptFileApiPath}`)
})
