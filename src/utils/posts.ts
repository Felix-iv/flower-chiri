import type { CollectionEntry } from 'astro:content'

export type PostEntry = CollectionEntry<'posts'>

export function sortPosts(posts: PostEntry[]) {
  return [...posts].sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
}

export function getPostUrl(post: PostEntry) {
  return `/${post.id}/`
}

export function groupPostsByYear(posts: PostEntry[]) {
  return sortPosts(posts).reduce<Record<string, PostEntry[]>>((groups, post) => {
    const year = String(post.data.pubDate.getFullYear())
    groups[year] = groups[year] || []
    groups[year].push(post)
    return groups
  }, {})
}

export function getCategoryCounts(posts: PostEntry[]) {
  const counts = new Map<string, number>()
  posts.forEach((post) => {
    const category = post.data.category || '未分类'
    counts.set(category, (counts.get(category) || 0) + 1)
  })
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
}

export function getTagCounts(posts: PostEntry[]) {
  const counts = new Map<string, number>()
  posts.forEach((post) => {
    const tags = post.data.tags || []
    tags.filter(Boolean).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1))
  })

  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
}

export function slugifyTaxonomy(value: string) {
  return value
}
