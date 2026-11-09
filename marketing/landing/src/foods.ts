// Typical portions, rounded, from UK CoFID / USDA FoodData Central and common UK product labels.
// A rough guide for a game, not a nutrition label. `free` is free sugars (added sugar, honey, juice);
// null where the split between natural and added sugar isn't clear enough to ask about.

export interface Food {
  id: string; name: string; emoji: string; portion: string;
  kcal: number; protein: number; carbs: number; fat: number; sat: number; fibre: number; free: number | null; salt: number;
}

export const FOODS: Food[] = [
  { id: "greek", name: "Fat-free Greek yoghurt", emoji: "🥄", portion: "150 g", kcal: 81, protein: 15.5, carbs: 4.5, fat: 0.3, sat: 0.2, fibre: 0, free: 0, salt: 0.1 },
  { id: "eggs", name: "Two boiled eggs", emoji: "🥚", portion: "2 large", kcal: 155, protein: 13, carbs: 1, fat: 11, sat: 3, fibre: 0, free: 0, salt: 0.4 },
  { id: "chicken", name: "Grilled chicken breast", emoji: "🍗", portion: "120 g", kcal: 190, protein: 36, carbs: 0, fat: 4.5, sat: 1.2, fibre: 0, free: 0, salt: 0.2 },
  { id: "lentils", name: "Cooked lentils", emoji: "🍲", portion: "150 g", kcal: 174, protein: 13.5, carbs: 30, fat: 0.6, sat: 0.1, fibre: 11.8, free: 0, salt: 0 },
  { id: "brownrice", name: "Brown rice", emoji: "🍚", portion: "150 g cooked", kcal: 168, protein: 3.9, carbs: 35, fat: 1.4, sat: 0.3, fibre: 2.7, free: 0, salt: 0 },
  { id: "croissant", name: "Butter croissant", emoji: "🥐", portion: "1 (60 g)", kcal: 245, protein: 5, carbs: 27, fat: 13, sat: 7.5, fibre: 1.5, free: 4, salt: 0.6 },
  { id: "porridge", name: "Porridge with milk", emoji: "🥣", portion: "40 g oats, 200 ml milk", kcal: 245, protein: 12, carbs: 34, fat: 6.5, sat: 3, fibre: 4, free: 0, salt: 0.2 },
  { id: "ramen", name: "Instant ramen", emoji: "🍜", portion: "1 pack", kcal: 380, protein: 8, carbs: 52, fat: 15, sat: 7, fibre: 2, free: 1, salt: 4.6 },
  { id: "pizza", name: "Margherita pizza", emoji: "🍕", portion: "2 slices", kcal: 530, protein: 22, carbs: 66, fat: 19, sat: 9, fibre: 3.5, free: 2, salt: 2.4 },
  { id: "sushi", name: "Salmon nigiri", emoji: "🍣", portion: "6 pieces", kcal: 300, protein: 15, carbs: 48, fat: 5, sat: 1, fibre: 0.6, free: 6, salt: 1.4 },
  { id: "carbonara", name: "Spaghetti carbonara", emoji: "🍝", portion: "1 plate", kcal: 720, protein: 30, carbs: 75, fat: 32, sat: 13, fibre: 4, free: 0, salt: 2.5 },
  { id: "banana", name: "Banana", emoji: "🍌", portion: "1 medium", kcal: 105, protein: 1.3, carbs: 27, fat: 0.4, sat: 0.1, fibre: 3.1, free: 0, salt: 0 },
  { id: "apple", name: "Apple", emoji: "🍎", portion: "1 medium", kcal: 95, protein: 0.5, carbs: 25, fat: 0.3, sat: 0, fibre: 4.4, free: 0, salt: 0 },
  { id: "oj", name: "Orange juice", emoji: "🧃", portion: "250 ml glass", kcal: 110, protein: 1.7, carbs: 26, fat: 0.5, sat: 0, fibre: 0.5, free: 21, salt: 0 },
  { id: "cola", name: "Cola", emoji: "🥤", portion: "330 ml can", kcal: 139, protein: 0, carbs: 35, fat: 0, sat: 0, fibre: 0, free: 35, salt: 0 },
  { id: "peanuts", name: "Unsalted peanuts", emoji: "🥜", portion: "30 g handful", kcal: 170, protein: 7.7, carbs: 4.8, fat: 14.8, sat: 2, fibre: 2.6, free: 0, salt: 0 },
  { id: "beans", name: "Baked beans", emoji: "🫘", portion: "½ can (200 g)", kcal: 160, protein: 9.5, carbs: 26, fat: 0.4, sat: 0.1, fibre: 7.6, free: null, salt: 1.2 },
  { id: "salmon", name: "Baked salmon fillet", emoji: "🐟", portion: "120 g", kcal: 250, protein: 27, carbs: 0, fat: 15, sat: 3, fibre: 0, free: 0, salt: 0.2 },
  { id: "cheddar", name: "Cheddar", emoji: "🧀", portion: "30 g", kcal: 125, protein: 7.5, carbs: 0, fat: 10.4, sat: 6.5, fibre: 0, free: 0, salt: 0.5 },
  { id: "avocado", name: "Avocado", emoji: "🥑", portion: "½ fruit", kcal: 130, protein: 1.6, carbs: 1.5, fat: 12, sat: 1.7, fibre: 5.4, free: 0, salt: 0 },
  { id: "toast", name: "Wholemeal toast", emoji: "🍞", portion: "2 slices", kcal: 190, protein: 8, carbs: 33, fat: 2, sat: 0.4, fibre: 5.6, free: 1, salt: 0.8 },
  { id: "fruityog", name: "Strawberry yoghurt", emoji: "🍓", portion: "125 g pot", kcal: 120, protein: 5, carbs: 18, fat: 3, sat: 2, fibre: 0, free: 10, salt: 0.15 },
  { id: "edamame", name: "Edamame", emoji: "🫛", portion: "100 g", kcal: 121, protein: 12, carbs: 9, fat: 5, sat: 0.6, fibre: 5.2, free: 0, salt: 0 },
  { id: "butter", name: "Butter", emoji: "🧈", portion: "1 tbsp (14 g)", kcal: 100, protein: 0.1, carbs: 0, fat: 11.5, sat: 7.3, fibre: 0, free: 0, salt: 0.2 },
  { id: "olive", name: "Olive oil", emoji: "🫒", portion: "1 tbsp (14 g)", kcal: 124, protein: 0, carbs: 0, fat: 14, sat: 2, fibre: 0, free: 0, salt: 0 },
  { id: "choc", name: "Milk chocolate", emoji: "🍫", portion: "4 squares (25 g)", kcal: 133, protein: 1.9, carbs: 14.5, fat: 7.5, sat: 4.5, fibre: 0.5, free: 13, salt: 0.06 },
  { id: "burger", name: "Fast-food cheeseburger", emoji: "🍔", portion: "1 burger", kcal: 300, protein: 15, carbs: 32, fat: 12, sat: 6, fibre: 1.5, free: 6, salt: 1.5 },
  { id: "crisps", name: "Ready salted crisps", emoji: "🥔", portion: "25 g bag", kcal: 133, protein: 1.5, carbs: 13, fat: 8, sat: 0.7, fibre: 1.1, free: 0, salt: 0.35 },
  { id: "soup", name: "Tomato soup, tinned", emoji: "🥫", portion: "½ can (200 g)", kcal: 120, protein: 1.8, carbs: 14, fat: 6, sat: 0.4, fibre: 1, free: null, salt: 1.2 },
];

export type Metric = "protein" | "fibre" | "salt" | "free" | "sat" | "kcal";

export const METRICS: Record<Metric, { ask: string; more: boolean; unit: string; min: number; fact: string }> = {
  protein: { ask: "more protein", more: true, unit: "g", min: 5, fact: "Protein keeps you full for longer and helps muscles recover after training." },
  fibre: { ask: "more fibre", more: true, unit: "g", min: 2.5, fact: "The UK guide is 30 g of fibre a day. Most adults manage about 20 g." },
  salt: { ask: "less salt", more: false, unit: "g", min: 0.5, fact: "Adults should keep salt under 6 g a day, about a teaspoon. Less salt helps keep blood pressure down." },
  free: { ask: "less added sugar", more: false, unit: "g", min: 6, fact: "Keep free sugars (added sugar, honey, juice) under 30 g a day. Sugar inside whole fruit and plain milk doesn't count." },
  sat: { ask: "less saturated fat", more: false, unit: "g", min: 2.5, fact: "Swapping saturated fat (butter, cheese, fatty meat) for olive oil, nuts or fish helps lower LDL cholesterol." },
  kcal: { ask: "fewer calories", more: false, unit: "kcal", min: 80, fact: "Portions add up fast: one plate can be a third of the day for many people." },
};

const val = (f: Food, m: Metric) => f[m];
/** Never the "right" answer to a less-is-better question: winning on salt shouldn't teach "pick the cola". */
const TREATS = new Set(["cola", "choc", "crisps", "butter"]);

export interface Round { metric: Metric; a: Food; b: Food; answer: "a" | "b" }

/** A fair pair: both values known, clearly apart (by the metric's minimum and at least 1.5×), and not seen recently. */
export function nextRound(recent: Set<string>, rnd = Math.random): Round {
  const metrics = Object.keys(METRICS) as Metric[];
  for (let tries = 0; tries < 400; tries++) {
    const metric = metrics[Math.floor(rnd() * metrics.length)];
    const pool = FOODS.filter((f) => val(f, metric) !== null);
    const a = pool[Math.floor(rnd() * pool.length)];
    const b = pool[Math.floor(rnd() * pool.length)];
    if (a.id === b.id) continue;
    const key = [a.id, b.id].sort().join("|") + metric;
    if (recent.has(key)) continue;
    const va = val(a, metric)!, vb = val(b, metric)!;
    const hi = Math.max(va, vb), lo = Math.min(va, vb);
    if (hi - lo < METRICS[metric].min) continue;
    if (lo > 0 && hi / lo < 1.5) continue;
    const aWins = METRICS[metric].more ? va > vb : va < vb;
    if (!METRICS[metric].more && TREATS.has((aWins ? a : b).id)) continue;
    recent.add(key);
    return { metric, a, b, answer: aWins ? "a" : "b" };
  }
  return { metric: "salt", a: FOODS[7], b: FOODS[12], answer: "b" };
}

export const fmt = (n: number, m: Metric) => (m === "kcal" ? `${Math.round(n)} kcal` : `${n < 10 && n % 1 ? n.toFixed(1) : Math.round(n)} g`);
