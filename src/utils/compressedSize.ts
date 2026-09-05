/**
 * What a string actually costs to ship.
 *
 * Browsers download the gzipped stream, and raw and compressed size do not
 * move together. Cutting a path against its neighbours makes the string
 * shorter but its coordinates more varied, and varied coordinates compress
 * worse: `occlusion` comes out 9% smaller raw and 2% larger gzipped, and both
 * engines shrink logo.svg on disk while costing bytes over the wire. Any
 * decision about whether an optimization was worth keeping has to be made on
 * this number, not on byte length.
 *
 * CompressionStream is unavailable outside a browser and in a few older ones,
 * where raw length is the only honest answer available.
 */
export async function compressedSize(text: string): Promise<number> {
  if (typeof CompressionStream === "undefined") return byteLength(text);
  try {
    const stream = new Blob([text])
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    return (await new Response(stream).arrayBuffer()).byteLength;
  } catch {
    return byteLength(text);
  }
}

export function byteLength(text: string): number {
  return new Blob([text]).size;
}
