import * as THREE from 'three';
import { mats } from './materials.js';

// ---------- language ----------
// Portuguese is the page's own language; English follows the same keys.
export const TEXT = {
  pt: {
    loading: 'MONTANDO O APARTAMENTO',
    scroll: 'ROLE PARA ENTRAR NA PLANTA',
    night: 'Ver à noite', day: 'Ver de dia',
    empty: 'Ver sem móveis', full: 'Ver mobiliado',
    measure: 'Medir', measuring: 'Medindo: toque em dois pontos', finishes: 'Acabamentos',
    lang: 'EN', langLabel: 'Switch to English',
    finaleTitle: 'Apartamento 02, cerca de 30 m²',
    finaleText: 'Paredes, portas e janelas vêm da planta em PDF. Altura do teto, altura das janelas, móveis, materiais e vista são simulação.',
    stops: ['Planta', 'Sala', 'Cozinha', 'Jantar', 'Gamer', 'Banho', 'Dormitório 01', 'Vista'],
    drag: 'Arraste para olhar em volta',
    close: 'Fechar',
    sofa: 'Sofá', floor: 'Piso', cabinets: 'Armários',
  },
  en: {
    loading: 'BUILDING THE APARTMENT',
    scroll: 'SCROLL TO ENTER THE PLAN',
    night: 'Night view', day: 'Day view',
    empty: 'Empty rooms', full: 'Furnished',
    measure: 'Measure', measuring: 'Measuring: tap two points', finishes: 'Finishes',
    lang: 'PT', langLabel: 'Mudar para português',
    finaleTitle: 'Apartment 02, about 30 m²',
    finaleText: 'Walls, doors and windows come from the PDF floor plan. Ceiling height, window heights, furniture, materials and the view are simulated.',
    stops: ['Plan', 'Living', 'Kitchen', 'Dining', 'Gaming', 'Bath', 'Bedroom', 'View'],
    drag: 'Drag to look around',
    close: 'Close',
    sofa: 'Sofa', floor: 'Floor', cabinets: 'Cabinets',
  },
};
export const ROOM_TEXT = {
  en: {
    sala: ['Living room', '4.65 × 2.40 m'],
    cozinha: ['Kitchen', '1.80 × 3.54 m, open to the living room'],
    as: ['Laundry', '1.49 × 0.90 m'],
    dorm2: ['Gaming room', 'Bedroom 02 · 2.70 × 2.00 m · two setups and a mini fridge'],
    banho: ['Bathroom', '1.14 × 2.39 m'],
    dorm1: ['Bedroom 01', '2.95 × 2.40 m'],
  },
};
let lang = 'pt';
try { if (localStorage.getItem('lang') === 'en') lang = 'en'; } catch { /* storage may be blocked */ }
export const getLang = () => lang;
export const t = (key) => TEXT[lang][key];
export function setLang(value, onChange) {
  lang = value;
  try { localStorage.setItem('lang', value); } catch { /* storage may be blocked */ }
  document.documentElement.lang = value === 'en' ? 'en' : 'pt-BR';
  onChange?.();
}

// ---------- points of interest ----------
// Real sizes of the pieces, in the page's coordinates (metres, +x east, +z south).
export const SPOTS = [
  { pos: [0.3, 1.0, 1.12], pt: ['Sapateira e cabideiro', '0,60 × 0,36 m · tampo de carvalho, ganchos redondos'], en: ['Shoe cabinet and hooks', '0.60 × 0.36 m · oak top, round hooks'] },
  { pos: [0.4, 1.6, 1.7], pt: ['Geladeira preta', '0,66 × 1,84 m · freezer embaixo'], en: ['Black fridge', '0.66 × 1.84 m · bottom freezer'] },
  { pos: [0.3, 0.98, 2.95], pt: ['Bancada da cozinha', 'Terrazzo a 90 cm · cuba preta e cooktop'], en: ['Kitchen counter', 'Terrazzo at 90 cm · black sink and hob'] },
  { pos: [1.68, 1.25, 3.2], pt: ['Armário de temperos', '20 cm de profundidade · nicho iluminado'], en: ['Spice pantry', '20 cm deep · lit niche'] },
  { pos: [1.2, 0.95, 4.15], pt: ['Lava-roupa', 'Sob a pedra contínua da cozinha'], en: ['Washing machine', 'Under the kitchen\'s continuous top'] },
  { pos: [1.86, 0.95, 1.47], pt: ['Mesa de jantar', '1,04 × 0,74 m · altura 76 cm · 4 cadeiras'], en: ['Dining table', '1.04 × 0.74 m · 76 cm high · 4 chairs'] },
  { pos: [3.4, 0.7, 0.55], pt: ['Sofá com chaise', '1,92 m · chaise de 1,55 m · assento a 44 cm'], en: ['Chaise sofa', '1.92 m · 1.55 m chaise · 44 cm seat'] },
  { pos: [4.0, 1.3, 2.3], pt: ['Painel da TV', 'TV de 43" · rack flutuante de 1,30 m'], en: ['TV wall', '43" TV · 1.30 m floating console'] },
  { pos: [3.3, 1.2, 4.2], pt: ['Mesa gamer', '2,66 m · dois PCs, duas telas de 24" cada'], en: ['Gaming desk', '2.66 m · two PCs, two 24" screens each'] },
  { pos: [4.2, 1.25, 2.75], pt: ['Frigobar', 'Porta de vidro · gavetas de snacks embaixo'], en: ['Mini fridge', 'Glass door · snack drawers below'] },
  { pos: [0.12, 1.55, -1.0], pt: ['Armário espelhado', '1,52 m · do box até o fim da parede'], en: ['Mirror cabinet', '1.52 m · from the shower to the wall\'s end'] },
  { pos: [0.75, 1.3, -1.72], pt: ['Box de vidro', 'Perfil preto · chuveiro de teto'], en: ['Glass shower', 'Black frame · ceiling rain head'] },
  { pos: [3.06, 0.85, -1.4], pt: ['Cama de casal', '1,44 × 1,93 m · colchão a 61 cm'], en: ['Double bed', '1.44 × 1.93 m · mattress at 61 cm'] },
  { pos: [1.55, 1.5, -2.1], pt: ['Guarda-roupa', 'Do chão ao forro, ligado aos aéreos'], en: ['Wardrobe', 'Floor to ceiling, joined to the upper cabinets'] },
  { pos: [3.06, 1.4, -0.22], pt: ['TV do quarto', '65" em painel ripado de carvalho'], en: ['Bedroom TV', '65" on a ribbed oak panel'] },
];

// ---------- finishes ----------
export const FINISHES = [
  { key: 'sofa', material: () => mats.sofaFabric, options: [['#ede5d5', 'Linho cru', 'Natural linen'], ['#7b7f63', 'Oliva', 'Olive'], ['#b0714d', 'Terracota', 'Terracotta'], ['#8c8d91', 'Cinza', 'Grey']] },
  { key: 'floor', material: () => mats.wood, options: [['#ffffff', 'Carvalho claro', 'Light oak'], ['#c9a27f', 'Carvalho mel', 'Honey oak'], ['#8a6a52', 'Nogueira', 'Walnut']] },
  { key: 'cabinets', material: () => mats.cabinetCream, options: [['#ddd5c5', 'Creme', 'Cream'], ['#a9b39b', 'Sálvia', 'Sage'], ['#4b5560', 'Azul petróleo', 'Petrol blue'], ['#f1efea', 'Branco', 'White']] },
];
export function applyFinish(finish, hex, linked) {
  const color = new THREE.Color(hex);
  for (const m of [finish.material(), ...linked(finish.material())]) m.color.copy(color);
}
