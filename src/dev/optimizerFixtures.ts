/**
 * Inputs the optimizer is expected to survive.
 *
 * Every fixture here is a bug that shipped at least once: artwork that came out
 * relocated, unpainted, or deleted outright. Add a fixture whenever you find a
 * new one, so the next change has to keep clearing it.
 */

export type EngineName = "crop" | "raster" | "scissor";

export type Fixture = {
  name: string;
  /** Inline markup, or a URL fetched at run time for real files. */
  svg?: string;
  url?: string;
  /** What this input is here to catch. */
  guards: string;
  /**
   * Share of pixels allowed to differ, overall or per engine. Anything above
   * the default is a difference that is understood and recorded, and `why`
   * has to say what it is. Recording them is the point: the gate then fails on
   * a change you did not intend, rather than on one you already know about.
   */
  tolerance?: number | Partial<Record<EngineName, number>>;
  why?: string;
};

export const FIXTURES: Fixture[] = [
  {
    name: "gradient",
    guards: "<defs> survives, and shapes painted with url(#id) stay painted",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><rect x="5" y="5" width="90" height="90" fill="url(#g)"/><circle cx="50" cy="50" r="20" fill="#fff"/></svg>',
  },
  {
    name: "polygon",
    guards: "points= is a list, not a number to be rounded down to its first value",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="50,5 95,95 5,95" fill="#2b7"/><polyline points="10,10 90,10 90,30" fill="none" stroke="#111" stroke-width="4"/></svg>',
  },
  {
    name: "curves",
    guards: "smooth curves are not resampled into polylines on import",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path fill="#3366cc" d="M512 100C800 100 900 300 900 512C900 724 800 924 512 924C224 924 124 724 124 512C124 300 224 100 512 100Z"/><path fill="#cc3366" d="M300 400C380 320 460 320 540 400C620 480 620 560 540 640C460 720 380 720 300 640C220 560 220 480 300 400Z"/></svg>',
  },
  {
    name: "rects",
    guards: "square corners stay square; curve fitting must not round them off",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="5" y="5" width="90" height="40" fill="#347"/><rect x="5" y="55" width="40" height="40" fill="#a51"/><path fill="#0b7" d="M55 55h40v40h-40z"/></svg>',
  },
  {
    name: "occlusion",
    guards: "a fully covered shape is dropped, and nothing visible goes with it",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="10" y="10" width="30" height="30" fill="#0a0"/><rect x="0" y="0" width="100" height="100" fill="#123456"/><circle cx="50" cy="50" r="30" fill="#fc0"/></svg>',
  },
  {
    name: "offsetViewBox",
    guards: "a viewBox with a non-zero origin maps to the right pixels",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -12 24 24"><circle cx="0" cy="0" r="10" fill="#e11"/><rect x="-4" y="-4" width="8" height="8" fill="#11e"/></svg>',
  },
  {
    name: "scaledViewBox",
    guards: "width/height larger than the viewBox does not scale the geometry",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 100 100"><rect x="10" y="10" width="40" height="40" fill="#e11"/><circle cx="70" cy="70" r="20" fill="#11e"/></svg>',
  },
  {
    name: "donut",
    guards: "a compound path keeps its hole and its fill-rule",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#444" fill-rule="evenodd" d="M50 5A45 45 0 1 0 50 95A45 45 0 1 0 50 5ZM50 25A25 25 0 1 1 50 75A25 25 0 1 1 50 25Z"/><rect x="40" y="40" width="20" height="20" fill="#0bf"/></svg>',
    tolerance: { scissor: 1.5 },
    why: "scissor rebuilds the arcs through paper, which lands the two circle edges a fraction of a unit out. The share of changed pixels falls as the render gets larger, which is what an anti-aliased edge does and what lost geometry does not.",
  },
  {
    name: "transformed",
    guards: "a transform on a parent <g> reaches the shape inside it",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g transform="translate(50 50) scale(0.5)"><rect x="0" y="0" width="80" height="80" fill="#c00"/></g><rect x="0" y="0" width="20" height="20" fill="#00c"/></svg>',
  },
  {
    name: "inheritPaint",
    guards: "fill and stroke inherited from a <g> survive the group being flattened",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g fill="#3a7" stroke="#036" stroke-width="3"><path d="M10 10h35v35h-35z"/><path d="M55 55h35v35h-35z"/></g></svg>',
  },
  {
    name: "strokeOnly",
    guards: "shapes with no fill area still paint, and must not be culled as empty",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="0" y="0" width="100" height="100" fill="#eee"/><line x1="10" y1="20" x2="90" y2="20" stroke="#c00" stroke-width="2"/><path d="M10 50h80" stroke="#00c" stroke-width="2" fill="none"/><polyline points="10,70 50,70 90,70" fill="none" stroke="#0a0" stroke-width="2"/></svg>',
  },
  {
    name: "strokeNoWidth",
    guards: "a stroke with no stroke-width is one unit wide, not zero",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="0" y="0" width="100" height="100" fill="#eee"/><g stroke="#c00"><line x1="10" y1="30" x2="90" y2="30"/><path d="M10 60h80" fill="none"/></g></svg>',
  },
  {
    name: "thin",
    guards: "sub-unit detail is not deleted as a boolean artifact",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="0" y="0" width="100" height="100" fill="#eee"/><rect x="10" y="20" width="80" height="0.6" fill="#000"/><rect x="10" y="40" width="80" height="0.6" fill="#000"/><circle cx="50" cy="70" r="1.2" fill="#c00"/></svg>',
  },
  {
    name: "repeated",
    guards: "identical geometry can be hoisted into <defs> without moving",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 10c8 0 14 6 14 14s-6 14-14 14S-4 32 -4 24 2 10 10 10z" fill="#c33"/><path d="M10 10c8 0 14 6 14 14s-6 14-14 14S-4 32 -4 24 2 10 10 10z" fill="#3c3" transform="translate(40 0)"/><rect x="10" y="60" width="80" height="30" fill="#333"/></svg>',
  },
  {
    name: "dashed",
    guards: "a dash pattern survives the shape becoming a path",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="80" fill="none" stroke="#000" stroke-width="3" stroke-dasharray="8 4"/></svg>',
    tolerance: 7,
    why: "A <rect> converts to a path with a different start point and direction, so the dashes land at a different phase. The geometry is identical; only where the gaps fall changes.",
  },
  {
    name: "groupOpacity",
    guards: "group opacity is carried onto the shapes when the group is flattened",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g opacity="0.5"><rect x="10" y="10" width="50" height="50" fill="#f0a"/><rect x="40" y="40" width="50" height="50" fill="#0af"/></g></svg>',
    tolerance: 5,
    why: "<g opacity> composites the whole group once. Once the group is gone each shape carries the opacity itself, so the overlap composites twice. Inherent to flattening the group.",
  },
  {
    name: "logo.svg",
    guards: "the real project asset, end to end",
    url: "/logo.svg",
    tolerance: { crop: 1.6 },
    why: "the two vector engines accept 11 boolean cuts on this file and then trap the cut shapes, which thickens their outlines by design (enableTraps). raster and scissor make no cuts here and match exactly. This is the measurement behind shipping the asset with cuts turned off.",
  },
];
