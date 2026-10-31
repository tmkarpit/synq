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

/**
 * Per-page description, and noindex for private pages (rooms, login, join) so search
 * engines only list the public landing page.
 */
export function usePageMeta({ description, noindex = false } = {}) {
  useEffect(() => {
    const undo = [];
    if (description) undo.push(setMeta('description', description));
    if (noindex) undo.push(setMeta('robots', 'noindex, nofollow'));
    return () => undo.forEach((fn) => fn());
  }, [description, noindex]);
}
