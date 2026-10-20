import type { FactView, MacroTargets, Profile } from "../shared.ts";

/** What the plan says the coach keeps an eye on, at most four, most specific first. Keys of `t.onboarding.plan.watch`. */
export function watchList(profile: Profile, facts: readonly FactView[]): string[] {
  const active = facts.filter((fact) => fact.status === "active");
  const has = (...codes: string[]) => active.some((fact) => fact.code !== null && codes.includes(fact.code));
  const focus = profile.about.focus;
  const list: string[] = [];
  if (has("high_cholesterol")) list.push("cholesterol");
  if (has("prediabetes", "type2_diabetes")) list.push("sugar");
  if (has("high_blood_pressure")) list.push("pressure");
  if (active.some((fact) => fact.kind === "allergy" || fact.kind === "intolerance")) list.push("allergy");
  if (focus.includes("skin")) list.push("skin");
  if (focus.includes("build_muscle") || profile.about.sports.length > 0) list.push("protein");
  if (focus.includes("gut") || has("ibs", "reflux")) list.push("gut");
  if (focus.includes("energy")) list.push("energy");
  if (focus.includes("bloods") && !list.includes("cholesterol") && !list.includes("sugar")) list.push("bloods");
  return list.slice(0, 4);
}

/** The day's targets as the person will see them: their own numbers where they set one, else the calculation. */
export function effectiveTargets(profile: Profile, calculated: MacroTargets): MacroTargets {
  return {
    kcal: profile.override_kcal ?? calculated.kcal,
    protein_g: profile.override_protein_g ?? calculated.protein_g,
    carbs_g: profile.override_carbs_g ?? calculated.carbs_g,
    fat_g: profile.override_fat_g ?? calculated.fat_g,
    fibre_g: profile.override_fibre_g ?? calculated.fibre_g,
  };
}
