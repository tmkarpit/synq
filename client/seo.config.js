import fs from 'node:fs';

// The public address of the site (SITE_URL=https://synq.example.com, at build time).
// Search engines and link previews need absolute URLs: with it, the build adds a
// canonical link, og:url, a large preview image and sitemap.xml (+ a robots.txt entry).
// Without it the build is unchanged.
const PUBLIC_PAGES = ['/', '/privacy', '/terms'];

export default function seo(siteUrl = process.env.SITE_URL || process.env.VITE_SITE_URL || '') {
  const site = siteUrl.trim().replace(/\/+$/, '');
  return {
    name: 'synq-seo',
    apply: 'build',
    transformIndexHtml(html) {
      if (!site) return html;
      const image = `${site}/og-image.png`;
      const tags = [
        `<link rel="canonical" href="${site}/" />`,
        `<meta property="og:url" content="${site}/" />`,
        `<meta property="og:image" content="${image}" />`,
        '<meta property="og:image:width" content="1600" />',
        '<meta property="og:image:height" content="900" />',
        '<meta property="og:image:alt" content="SYNQ: Code together, in sync." />',
        `<meta name="twitter:image" content="${image}" />`,
      ];
      return html
        .replace('<meta name="twitter:card" content="summary" />', '<meta name="twitter:card" content="summary_large_image" />')
        .replace('"operatingSystem": "Web browser",', `"operatingSystem": "Web browser",\n        "url": "${site}/",\n        "image": "${image}",`)
        .replace('</head>', `  ${tags.join('\n    ')}\n  </head>`);
    },
    generateBundle() {
      if (!site) return;
      const today = new Date().toISOString().slice(0, 10);
      const urls = PUBLIC_PAGES.map((p) => `  <url><loc>${site}${p}</loc><lastmod>${today}</lastmod></url>`);
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
      });
      const robots = fs.readFileSync(new URL('./public/robots.txt', import.meta.url), 'utf8').trimEnd();
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `${robots}\n\nSitemap: ${site}/sitemap.xml\n` });
    },
  };
}
