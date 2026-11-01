import { useEffect } from 'react';

function setMeta(name, content) {
  let tag = document.head.querySelector(`meta[name="${name}"]`);
  const previous = tag?.getAttribute('content') ?? null;
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('name', name);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
  return () => (previous == null ? tag.remove() : tag.setAttribute('content', previous));
}

/** Points the canonical link (added at build time with SITE_URL) at this page. */
function setCanonical(pathname) {
  const link = document.head.querySelector('link[rel="canonical"]');
  if (!link) return () => {};
  const previous = link.getAttribute('href');
  link.setAttribute('href', new URL(pathname, previous).href);
  return () => link.setAttribute('href', previous);
}

/**
 * Per-page description and canonical address, and noindex for private pages (rooms,
 * login, join) so search engines only list the public pages.
 */
export function usePageMeta({ description, noindex = false } = {}) {
  useEffect(() => {
    const undo = [];
    if (description) undo.push(setMeta('description', description));
    if (noindex) undo.push(setMeta('robots', 'noindex, nofollow'));
    else undo.push(setCanonical(window.location.pathname));
    return () => undo.forEach((fn) => fn());
  }, [description, noindex]);
}
