import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

// The link-preview tags in index.html: what Slack, LinkedIn, iMessage, X and others show when
// someone shares the app's link.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const meta = (key) => html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`))?.[1] ?? ''
const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''

describe('link previews', () => {
  test('have a description, and Open Graph and Twitter titles and descriptions that agree', () => {
    expect(meta('description').length).toBeGreaterThan(50)
    // Search engines cut descriptions at about 160 characters.
    expect(meta('description').length).toBeLessThanOrEqual(160)
    expect(meta('twitter:title')).toBe(meta('og:title'))
    expect(meta('twitter:description')).toBe(meta('og:description'))
    expect(meta('twitter:card')).toBe('summary_large_image')
    // X and LinkedIn cut titles past about 60 characters; search results show about 60.
    expect(meta('og:title').length).toBeLessThanOrEqual(60)
    expect(title.length).toBeGreaterThanOrEqual(30)
    expect(title.length).toBeLessThanOrEqual(60)
  })

  test('use absolute https URLs on the site itself, which is the live link in the README', () => {
    const site = new URL(meta('og:url'))
    expect(site.protocol).toBe('https:')
    for (const image of [meta('og:image'), meta('twitter:image')]) expect(new URL(image).origin).toBe(site.origin)
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8')
    expect(readme).toContain(`(${site.origin})`)
  })

  test("point at an image that's ours, in public/, at the size the tags declare", () => {
    const file = readFileSync(new URL(`../public${new URL(meta('og:image')).pathname}`, import.meta.url))
    expect(file.subarray(1, 4).toString()).toBe('PNG')
    expect([file.readUInt32BE(16), file.readUInt32BE(20)]).toEqual([Number(meta('og:image:width')), Number(meta('og:image:height'))])
    expect([meta('og:image:width'), meta('og:image:height')]).toEqual(['1200', '630'])
    expect(meta('og:image:alt')).not.toBe('')
    expect(meta('twitter:image:alt')).toBe(meta('og:image:alt'))
  })
})
