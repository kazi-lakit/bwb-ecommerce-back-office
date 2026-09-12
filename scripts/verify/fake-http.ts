export async function blocksDataCall<T>(fn: () => Promise<T>): Promise<T> { return fn(); }
