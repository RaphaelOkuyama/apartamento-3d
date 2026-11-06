// Geometry measured from the PDF's vector data, rendered at 170 dpi.
// Scale check: 330.4 px = 2.95 m and 519.7 px = 4.65 m, so about 111.9 px per metre.
// Origin: north-west inside corner of the living room. +x is east, +z is south.
const SCALE = 111.9;
export const X = (px) => (px - 421) / SCALE;
export const Z = (py) => (py - 428) / SCALE;
const rect = ([x0, y0, x1, y1]) => ({ x0: X(x0), z0: Z(y0), x1: X(x1), z1: Z(y1) });

// Not in the PDF: heights are assumptions, shown as such on the page.
export const CEILING = 2.5;
export const GESSO = 2.3;
export const DOOR_HEAD = 2.1;
export const SILL = 1.0;
export const WINDOW_HEAD = 2.2;
export const EYE = 1.5;

// Structural masonry: fill value 0.6 in the PDF.
export const WALLS = [
  [405, 128, 421, 434], [405, 535, 421, 947], [421, 128, 551, 143], [561, 128, 891, 143],
  [551, 128, 561, 428], [891, 128, 907, 210], [891, 345, 907, 428], [421, 412, 460, 428],
  [539, 412, 551, 428], [561, 412, 572, 428], [662, 412, 891, 428], [907, 412, 941, 428],
  [941, 412, 957, 478], [941, 636, 957, 746], [941, 881, 957, 947], [623, 697, 639, 947],
  [639, 697, 700, 707], [790, 697, 941, 707], [421, 931, 623, 947], [639, 931, 941, 947],
].map(rect);

// Infill shafts, hatched in the PDF.
export const SHAFTS = [[421, 143, 455, 238], [421, 824, 455, 931]].map(rect);

export const DOOR_GAPS = [
  [405, 434, 421, 535], [460, 412, 539, 428], [572, 412, 662, 428], [700, 697, 790, 707],
].map(rect);

export const WINDOWS = [[891, 210, 907, 345], [941, 478, 957, 636], [941, 746, 957, 881]].map(rect);

// Lowered plaster ceiling: fill value 0.86 in the PDF.
export const GESSO_AREAS = [
  [455, 144, 550, 412], [421, 238, 455, 412], [561, 144, 891, 166],
  [421, 428, 441, 824], [441, 805, 475, 824], [455, 824, 475, 931],
].map(rect);

// Rooms: interior rectangle, floor finish, where the reveal starts, and the page caption.
export const ROOMS = [
  { id: 'sala', ...rect([421, 428, 941, 697]), floor: 'wood', door: [0, 0.5], light: [2.6, 1.75, 1.2],
    name: 'Sala', size: '4,65 × 2,40 m' },
  { id: 'cozinha', ...rect([421, 697, 623, 824]), floor: 'wood', door: [1.0, 2.4], light: [1, 1.75, 2.9],
    name: 'Cozinha', size: '1,80 × 3,54 m, aberta para a sala' },
  { id: 'as', ...rect([421, 824, 623, 931]), floor: 'wood', door: [1, 3.54], light: [1.1, 1.75, 4],
    name: 'Área de serviço', size: '1,49 × 0,90 m' },
  { id: 'dorm2', ...rect([639, 707, 941, 931]), floor: 'wood', door: [2.89, 2.45], light: [3.3, 1.75, 3.2],
    name: 'Quarto gamer', size: 'Dormitório 02 · 2,70 × 2,00 m · dois setups e frigobar' },
  { id: 'banho', ...rect([421, 143, 551, 412]), floor: 'wood', door: [0.7, -0.14], light: [0.7, 1.75, -1],
    name: 'Banho', size: '1,14 × 2,39 m' },
  { id: 'dorm1', ...rect([561, 143, 891, 412]), floor: 'wood', door: [1.75, -0.14], light: [2.7, 1.75, -1.3],
    name: 'Dormitório 01', size: '2,95 × 2,40 m' },
];

export const BOUNDS = { x0: X(405), z0: Z(128), x1: X(957), z1: Z(947) };
