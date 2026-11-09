import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { SITE, getPosts } from '../site';

export async function GET(context: APIContext) {
  const posts = await getPosts();
  return rss({
    title: SITE.title,
    description: SITE.description,
    site: context.site!,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.date,
      description: post.data.description,
      categories: post.data.tags,
      link: `/archives/${post.id}/`,
    })),
  });
}
