export function chromeBytes(snapshot) {
  const apps = snapshot.apps.filter((app) => /\/Google Chrome(?: for Testing| Beta| Canary| Dev)?\.app$/.test(app.bundlePath));
  return apps.length === 0 ? null : apps.reduce((total, app) => total + app.footprintBytes, 0);
}

export function median(values) {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) throw new Error('計測値を取得できませんでした。');
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export async function sampleChrome(request) {
  let samples = [];
  for (const index of [0, 1, 2]) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 400));
    const value = chromeBytes(await request('snapshot'));
    if (value === null) throw new Error('Chromeの計測対象が見つかりませんでした。');
    samples = [...samples, value];
  }
  return median(samples);
}
