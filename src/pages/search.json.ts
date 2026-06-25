import { getSortedFilteredPosts } from '@/utils/draft'
import { getPostUrl } from '@/utils/posts'

export async function GET() {
  const posts = await getSortedFilteredPosts()

  return new Response(
    JSON.stringify(
      posts.map((post) => ({
        title: post.data.title,
        description: post.data.description || '',
        category: post.data.category || '',
        tags: post.data.tags,
        date: post.data.pubDate.toISOString().slice(0, 10),
        url: getPostUrl(post),
        content: post.body
      }))
    ),
    {
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      }
    }
  )
}
