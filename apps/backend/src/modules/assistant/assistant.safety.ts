/**
 * Veterinary guardrails for the PetApp Assistant, as pure functions so they are unit-tested and apply the same way
 * whatever answers (the built-in rules or an AI model). They run on the server before and after the answer:
 *
 * - URGENT: words that suggest an emergency (poisoning, breathing trouble, seizures, collapse, heavy bleeding, bloat,
 *   heatstroke, a blocked cat…). The answer is fixed: contact a vet now, with nearby vets. No model is asked.
 * - Dose questions: the assistant never gives medicine doses. The answer is fixed.
 * - GENERAL_INFO: other health questions get general information, clearly marked as not a diagnosis.
 * - Any answer to a health question that still contains a dose is replaced.
 */

export type Safety = 'NONE' | 'GENERAL_INFO' | 'URGENT';

export const NOTICES: Record<Exclude<Safety, 'NONE'>, string> = {
  GENERAL_INFO: 'General information, not a diagnosis. For anything about your pet’s health, talk to a vet.',
  URGENT: 'This could be an emergency. Contact a vet or an animal hospital now. Don’t wait to see if it gets better.',
};

export const URGENT_REPLY =
  'What you describe can be serious and needs a vet straight away. Call or go to the nearest vet or animal emergency clinic now, and keep your pet calm and still on the way. ' +
  'If your pet swallowed something, take the packet or a photo of it with you. Don’t give food, water, human medicine or home remedies, and don’t try to make your pet vomit unless a vet tells you to.';

export const DOSE_REPLY =
  'I can’t suggest medicine doses. The right amount depends on your pet’s weight, age, health and the exact product, and several human medicines (such as paracetamol and ibuprofen) are poisonous to pets. ' +
  'Please ask a vet before giving any medicine. I can help you find one nearby.';

const TOXIC = String.raw`(chocolate|cocoa|grapes?|raisins?|xylitol|sugar[- ]free gum|onions?|garlic|rat (poison|bait|kill)|rodenticide|antifreeze|coolant|paracetamol|crocin|dolo|ibuprofen|aspirin|human (medicine|tablets?|pills?)|lil(y|ies)|insecticide|pesticide|bleach|phenyl|naphthalene|mothballs?|snail bait|weed ?killer|alcohol|caffeine|batter(y|ies))`;

/** Emergencies. Each pattern names the sign so tests and logs can say which matched. */
const URGENT: Array<[string, RegExp]> = [
  ['poisoning', new RegExp(String.raw`\b(ate|eaten|eat|swallowed|licked|chewed|drank|drunk|got into|had|has had|took)\b[^.?!]{0,40}\b${TOXIC}`, 'i')],
  ['poisoning', /\b(poison(ed|ing)?|toxic)\b/i],
  ['breathing', /\b(can'?t|cannot|can not|struggling to|difficulty|trouble|hard to) breath(e|ing)?\b|\b(not breathing|gasping|choking|blue (gums|tongue))\b/i],
  ['seizure', /\b(seizures?|fits?|fitting|convuls(ion|ions|ing)|shaking uncontrollably)\b/i],
  ['collapse', /\b(collapsed?|unconscious|unresponsive|passed out|can'?t (stand|get up|walk)|not moving)\b/i],
  ['bleeding', /\b(bleeding (heavily|a lot|badly|won'?t stop|non ?stop)|won'?t stop bleeding|lots of blood|blood everywhere)\b/i],
  ['injury', /\b(hit by (a )?(car|bike|vehicle|scooter|truck)|run over|fell from|broken (leg|bone)|eye (popped|out of)|bitten by (a )?(snake|cobra)|snake ?bite|scorpion|electric shock|burn(ed|t)? badly)\b/i],
  ['bloat', /\b(bloat(ed)?|swollen (belly|stomach|tummy)|hard (belly|stomach|tummy))\b[^.?!]{0,60}\b(retch|vomit|throw(ing)? up|gag)/i],
  ['bloat', /\b(belly|stomach|tummy)\b[^.?!]{0,30}\b(swollen|bloated|hard)\b[^.?!]{0,60}\b(retch|vomit|throw(ing)? up|gag)/i],
  ['bloat', /\b(trying to (vomit|throw up|be sick) (but|and) (nothing|can'?t))\b/i],
  ['heatstroke', /\b(heat ?stroke|overheated|collapsed in the heat)\b/i],
  ['blocked', /\b(can'?t|cannot|not able to|unable to|straining to) (pee|urinate|wee)\b|\bno (urine|pee)\b/i],
  ['blood', /\b(vomit(ing|ed|s)? blood|blood in (the |his |her |its )?vomit|bloody (diarrh(o)?ea|vomit|stool|poo))\b/i],
  ['labour', /\b(in labou?r|giving birth|whelping)\b[^.?!]{0,40}\b(hours|long time|stuck|no (puppy|puppies|kitten|kittens))\b/i],
];

/** Health topics: answered as general information only. */
const MEDICAL = /\b(vomit\w*|throw(ing)? up|diarrh(o)?ea|loose (motion|stool)s?|cough\w*|sneez\w*|itch\w*|scratch(ing|es)|limp\w*|letharg\w*|not eating|off (his|her|its) food|fever|temperature|rash|lump|swelling|infection|worms?|deworm\w*|ticks?|fleas?|mites?|vaccin\w*|medicine|medication|tablet|antibiotic|sick|ill(ness)?|pain(ful)?|allerg\w*|diagnos\w*|symptom\w*|disease|wound|injur\w*|discharge|dandruff|hair loss|shedding a lot|bad breath|ear (infection|smell)|eye (discharge|infection)|neuter\w*|spay\w*|pregnan\w*|heat cycle)\b/i;

const MEDS = String.raw`(paracetamol|crocin|dolo|calpol|ibuprofen|brufen|aspirin|disprin|antibiotics?|medicines?|medication|tablets?|pills?|painkillers?|cetirizine|benadryl|metronidazole|ivermectin|steroids?|syrup)`;
const DOSE_QUESTION = new RegExp(String.raw`\b(dos(e|es|age)|mg\/kg|how (much|many) (mg|ml|tablets?|pills?|drops?))\b|\b(how (much|many)|can i give|should i give|safe to give|ok to give|okay to give)\b[^.?!]{0,40}\b${MEDS}|\b${MEDS}\b[^.?!]{0,40}\b(give|dose|how much)\b`, 'i');

const DOSE_IN_ANSWER = /\b\d+(\.\d+)?\s*(mg|mcg|µg|ml|millilit(re|er)s?|milligrams?)\b|\b\d+(\.\d+)?\s*(tablets?|pills?|capsules?)\b|\bmg\/kg\b/i;

export interface Triage {
  safety: Safety;
  /** Which emergency signs matched (URGENT only). */
  signs: string[];
  asksForDose: boolean;
}

export function triage(text: string): Triage {
  const t = text.replace(/[’']/g, "'");
  const signs = [...new Set(URGENT.filter(([, re]) => re.test(t)).map(([s]) => s))];
  if (signs.length) return { safety: 'URGENT', signs, asksForDose: DOSE_QUESTION.test(t) };
  const asksForDose = DOSE_QUESTION.test(t);
  return { safety: asksForDose || MEDICAL.test(t) ? 'GENERAL_INFO' : 'NONE', signs: [], asksForDose };
}

/** An answer to a health question must not contain a dose. Returns the safe text to use instead, or null if it's fine. */
export function checkAnswer(answer: string, safety: Safety): string | null {
  if (safety === 'NONE') return null;
  return DOSE_IN_ANSWER.test(answer) ? DOSE_REPLY : null;
}

/** A short, safe conversation title from the first question. */
export function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= 60 ? t : `${t.slice(0, 57).replace(/\s+\S*$/, '')}…`;
}
