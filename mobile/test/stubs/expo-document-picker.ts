/** Stand-in for the Files picker, so the fallback path can be driven from a test. */
const g = globalThis as any;
g.__documentPicker ??= { result: { canceled: true }, asked: [] as any[] };

export async function getDocumentAsync(options: any) {
  g.__documentPicker.asked.push(options);
  return g.__documentPicker.result;
}
