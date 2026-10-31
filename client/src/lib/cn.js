/** Join class names, skipping falsy values. Accepts strings, arrays and {class: bool} maps. */
export function cn(...args) {
  const out = [];
  const walk = (value) => {
    if (!value) return;
    if (typeof value === 'string' || typeof value === 'number') {
      out.push(String(value));
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (typeof value === 'object') {
      Object.entries(value).forEach(([key, on]) => {
        if (on) out.push(key);
      });
    }
  };
  args.forEach(walk);
  return out.join(' ');
}
