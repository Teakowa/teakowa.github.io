import { getCollection } from 'astro:content';

export const SITE = {
  title: 'Teakowa',
  description: 'The fight to keep the internet free and open for everyone',
  author: 'Teakowa',
  githubSince: '2017-04-15',
};

export const PROJECTS = [
  { name: 'wright', lang: 'cli', href: 'https://github.com/wrightkit', desc: 'Workshop / OverPy 的规则开销、死循环与卡服分析。' },
  { name: 'blockhole', lang: 'rust', href: 'https://github.com/Teakowa/blockhole', desc: 'Cloudflare account-level IP denylist.' },
  { name: 'tgdl-bot', lang: 'go', href: 'https://github.com/Teakowa/tgdl-bot', desc: 'Telegram message forwarding bot and downloader.' },
  { name: 'setup-serverless', lang: 'ts', href: 'https://github.com/Teakowa/setup-serverless', desc: 'Deploy with the Serverless Framework, without Node.' },
  { name: 'Overwatch-AI-PVE', lang: 'overpy', href: 'https://github.com/Teakowa/Overwatch-AI-PVE', desc: 'Custom game modes for the Overwatch Workshop.' },
  { name: 'Laravel-Cloudflare', lang: 'php', href: 'https://github.com/Teakowa/Laravel-Cloudflare', desc: 'The Cloudflare API right from Laravel.' },
];

export const CONTACT = [
  { key: 'github', label: '@Teakowa', href: 'https://github.com/Teakowa' },
  { key: 'telegram', label: '@teakowa', href: 'https://t.me/teakowa' },
  { key: 'mail', label: 'i@iolo.lol', href: 'mailto:i@iolo.lol' },
  { key: 'feed', label: '/atom.xml', href: '/atom.xml' },
];

export async function getPosts() {
  const posts = await getCollection('posts');
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export const tagSlug = (tag: string) => tag.replace(/\s+/g, '-');

export const ymd = (date: Date) => date.toISOString().slice(0, 10);
