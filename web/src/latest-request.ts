// A late response must never replace data from a newer reload.
export function latestRequest() {
  let sequence = 0;
  return async function run<T>(load: () => Promise<T>, publish: (value: T) => void, loading: (value: boolean) => void) {
    const current = ++sequence;
    loading(true);
    try {
      const value = await load();
      if (current === sequence) publish(value);
    } finally {
      if (current === sequence) loading(false);
    }
  };
}
