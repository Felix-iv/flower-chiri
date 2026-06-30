import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

type FrontmatterValue = string | boolean | string[] | undefined
type Frontmatter = Record<string, FrontmatterValue>

type ParsedMarkdown = {
  frontmatter: Frontmatter
  body: string
}

const projectRoot = process.cwd()
const sourcePostsDir = path.resolve(
  process.env.OBSIDIAN_BLOG_SOURCE_DIR ??
    (process.env.OBSIDIAN_VAULT_DIR
      ? path.join(process.env.OBSIDIAN_VAULT_DIR, 'posts')
      : path.join(projectRoot, '..', 'obsidian_notesobsidian_notes', 'posts'))
)
const targetPostsDir = path.resolve(process.env.BLOG_POSTS_TARGET_DIR ?? path.join(projectRoot, 'src/content/posts'))
const sourceAssetsDir = path.join(sourcePostsDir, '_assets')
const targetAssetsDir = path.join(targetPostsDir, '_assets')

const generatedSource = 'obsidian'

function parseMarkdown(content: string): ParsedMarkdown {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { frontmatter: {}, body: content }
  }

  const normalized = content.replace(/\r\n/g, '\n')
  const end = normalized.indexOf('\n---\n', 4)
  if (end === -1) {
    return { frontmatter: {}, body: content }
  }

  const frontmatterText = normalized.slice(4, end)
  const body = normalized.slice(end + '\n---\n'.length)
  return {
    frontmatter: parseFrontmatter(frontmatterText),
    body
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

function formatFrontmatter(frontmatter: Frontmatter): string {
  const lines = ['---']
  Object.entries(frontmatter).forEach(([key, value]) => {
    if (value === undefined) return
    if (Array.isArray(value)) {
      lines.push(`${key}:`)
      value.filter(Boolean).forEach((item) => lines.push(`  - ${quoteYaml(item)}`))
      return
    }
    if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`)
      return
    }
    lines.push(`${key}: ${quoteYaml(value)}`)
  })
  lines.push('---', '')
  return lines.join('\n')
}

function quoteYaml(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function findMarkdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry)
    const relativePath = path.relative(sourcePostsDir, fullPath)
    if (relativePath.split(path.sep).includes('_assets')) return []

    const stats = statSync(fullPath)
    if (stats.isDirectory()) return findMarkdownFiles(fullPath)
    if (stats.isFile() && /\.(md|mdx)$/i.test(entry)) return [fullPath]
    return []
  })
}

function findManagedTargetFiles(dir: string): string[] {
  if (!existsSync(dir)) return []

  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry)
    if (entry === '_assets') return []

    const stats = statSync(fullPath)
    if (stats.isDirectory()) return findManagedTargetFiles(fullPath)
    if (!stats.isFile() || !/\.(md|mdx)$/i.test(entry)) return []

    const parsed = parseMarkdown(readFileSync(fullPath, 'utf8'))
    return parsed.frontmatter.source === generatedSource ? [fullPath] : []
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

function toOutputFileName(filePath: string, frontmatter: Frontmatter): string {
  const slug = getString(frontmatter, 'slug') ?? path.basename(filePath, path.extname(filePath))
  return `${slug.replace(/[\\/]/g, '-').trim()}.md`
}

function convertObsidianEmbeds(body: string, warnings: string[]): string {
  const imageExtensions = /\.(avif|gif|jpe?g|png|svg|webp)$/i
  const converted = body.replace(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, (match, rawTarget: string) => {
    const target = rawTarget.trim()
    if (!imageExtensions.test(target)) {
      warnings.push(`保留非图片 Obsidian 嵌入：${match}`)
      return match
    }

    return `![](<_assets/${target}>)`
  })

  const wikiLinks = converted.match(/(?<!!)\[\[[^\]]+\]\]/g)
  if (wikiLinks) {
    warnings.push(`发现未转换的 Obsidian 双链：${[...new Set(wikiLinks)].join(', ')}`)
  }

  return converted
}

function buildAstroFrontmatter(sourceFile: string, source: Frontmatter): Frontmatter {
  const title = getString(source, 'title') ?? path.basename(sourceFile, path.extname(sourceFile))
  const pubDate = getString(source, 'pubDate') ?? getString(source, 'date')
  if (!pubDate) {
    throw new Error(`${path.relative(sourcePostsDir, sourceFile)} 缺少 date 或 pubDate`)
  }

  return {
    title,
    pubDate,
    description: getString(source, 'description') ?? getString(source, 'summary'),
    category: getString(source, 'category'),
    tags: getTags(source),
    image: getString(source, 'image'),
    slug: getString(source, 'slug'),
    updated: getString(source, 'updated'),
    published: true,
    sync_fastgpt: getBoolean(source, 'sync_fastgpt'),
    source: generatedSource,
    sourcePath: path.relative(sourcePostsDir, sourceFile).replaceAll(path.sep, '/')
  }
}

function syncAssets() {
  if (!existsSync(sourceAssetsDir)) return false

  mkdirSync(targetAssetsDir, { recursive: true })
  cpSync(sourceAssetsDir, targetAssetsDir, { recursive: true })
  return true
}

function main() {
  if (!existsSync(sourcePostsDir)) {
    console.error(`找不到 Obsidian posts 目录：${sourcePostsDir}`)
    console.error('可以设置 OBSIDIAN_BLOG_SOURCE_DIR=/path/to/vault/posts 后重试。')
    process.exit(1)
  }

  mkdirSync(targetPostsDir, { recursive: true })

  const warnings: string[] = []
  const generatedFiles = new Set<string>()
  const sourceFiles = findMarkdownFiles(sourcePostsDir)
  let skipped = 0

  sourceFiles.forEach((sourceFile) => {
    const parsed = parseMarkdown(readFileSync(sourceFile, 'utf8'))
    if (!getBoolean(parsed.frontmatter, 'published')) {
      skipped += 1
      return
    }

    const outputFile = path.join(targetPostsDir, toOutputFileName(sourceFile, parsed.frontmatter))
    const frontmatter = buildAstroFrontmatter(sourceFile, parsed.frontmatter)
    const body = convertObsidianEmbeds(parsed.body, warnings)
    writeFileSync(outputFile, `${formatFrontmatter(frontmatter)}${body.trimStart()}`)
    generatedFiles.add(outputFile)
  })

  const removedFiles = findManagedTargetFiles(targetPostsDir).filter((targetFile) => !generatedFiles.has(targetFile))
  removedFiles.forEach((targetFile) => rmSync(targetFile))
  const copiedAssets = syncAssets()

  console.log(`Obsidian posts: ${sourcePostsDir}`)
  console.log(`Astro posts: ${targetPostsDir}`)
  console.log(`已同步文章：${generatedFiles.size}`)
  console.log(`已跳过未发布文章：${skipped}`)
  console.log(`已清理旧同步文章：${removedFiles.length}`)
  console.log(`附件目录：${copiedAssets ? '已复制 _assets' : '未发现 _assets，跳过'}`)
  warnings.forEach((warning) => console.warn(`提醒：${warning}`))
}

main()
