// Bound SVG work by screen resolution. Analysis and cursor sampling retain
// every input sample; each display bucket retains its endpoints and extrema.
export function displayPoints<T extends { distanceM: number; value: number }>(
  points: T[],
  maxDistance: number,
  width: number,
): T[] {
  const columns = Math.max(1, Math.ceil(width));
  if (points.length <= columns * 4) return points;
  const result: T[] = [];
  let start = 0;
  while (start < points.length) {
    const column = Math.floor(
      (points[start].distanceM / Math.max(1, maxDistance)) * columns,
    );
    let end = start + 1,
      min = start,
      max = start;
    while (
      end < points.length &&
      Math.floor(
        (points[end].distanceM / Math.max(1, maxDistance)) * columns,
      ) === column
    ) {
      if (points[end].value < points[min].value) min = end;
      if (points[end].value > points[max].value) max = end;
      end++;
    }
    for (const index of [...new Set([start, min, max, end - 1])].sort(
      (a, b) => a - b,
    ))
      result.push(points[index]);
    start = end;
  }
  return result;
}
