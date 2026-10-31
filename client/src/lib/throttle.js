/** Leading + trailing throttle. The returned function has .cancel() and .flush(). */
export function throttle(fn, wait) {
  let last = 0;
  let timer = null;
  let pendingArgs = null;

  const invoke = () => {
    last = Date.now();
    timer = null;
    const args = pendingArgs;
    pendingArgs = null;
    fn(...args);
  };

  const throttled = (...args) => {
    pendingArgs = args;
    const remaining = wait - (Date.now() - last);
    if (remaining <= 0) {
      clearTimeout(timer);
      invoke();
    } else if (!timer) {
      timer = setTimeout(invoke, remaining);
    }
  };

  throttled.cancel = () => {
    clearTimeout(timer);
    timer = null;
    pendingArgs = null;
  };
  throttled.flush = () => {
    if (timer) {
      clearTimeout(timer);
      invoke();
    }
  };
  return throttled;
}
