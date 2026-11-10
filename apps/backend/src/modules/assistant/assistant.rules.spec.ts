import { DOSE_REPLY, checkAnswer, titleFrom, triage } from './assistant.safety';
import { findCareNote, findGuide, intentOf, matchCategory, shopQuery } from './assistant.knowledge';
import { indiaMidnight } from './assistant.service';

describe('assistant guardrails', () => {
  it('emergencies are recognised, with the sign that matched', () => {
    const urgent: Array<[string, string]> = [
      ['My dog ate a whole bar of chocolate', 'poisoning'],
      ['bruno licked some rat poison in the garage', 'poisoning'],
      ['Cat swallowed paracetamol tablet', 'poisoning'],
      ['my cat chewed a lily leaf', 'poisoning'],
      ['She is struggling to breathe and her gums look blue', 'breathing'],
      ['he had a seizure 10 minutes ago', 'seizure'],
      ['my dog collapsed on the walk', 'collapse'],
      ['the cut won’t stop bleeding', 'bleeding'],
      ['he was hit by a car', 'injury'],
      ['belly is swollen and hard and he keeps retching', 'bloat'],
      ['I think she has heatstroke', 'heatstroke'],
      ['my male cat is straining to pee and nothing comes out', 'blocked'],
      ['vomiting blood since morning', 'blood'],
    ];
    for (const [text, sign] of urgent) {
      const t = triage(text);
      expect({ text, safety: t.safety }).toEqual({ text, safety: 'URGENT' });
      expect(t.signs).toContain(sign);
    }
  });

  it('other health questions are general information; everyday questions are not health questions', () => {
    for (const q of ['my dog has diarrhoea', 'Why is my cat scratching so much?', 'when should my puppy get vaccinated', 'is it normal for dogs to sneeze']) {
      expect({ q, s: triage(q).safety }).toEqual({ q, s: 'GENERAL_INFO' });
    }
    for (const q of ['Find a groomer near me', 'find a vet near me', 'food for my puppy', 'How do I add my pet?', 'contests for cats']) {
      expect({ q, s: triage(q).safety }).toEqual({ q, s: 'NONE' });
    }
  });

  it('dose questions are caught, and doses in health answers are replaced', () => {
    expect(triage('How much paracetamol can I give my dog?')).toMatchObject({ asksForDose: true, safety: 'GENERAL_INFO' });
    expect(triage('what dosage of metronidazole for a cat')).toMatchObject({ asksForDose: true });
    expect(triage('can i give my dog a crocin')).toMatchObject({ asksForDose: true });
    expect(triage('how much should I feed my puppy')).toMatchObject({ asksForDose: false });
    expect(checkAnswer('Give 10 mg/kg twice a day.', 'GENERAL_INFO')).toBe(DOSE_REPLY);
    expect(checkAnswer('Half a tablet should be fine', 'GENERAL_INFO')).toBeNull(); // no number: no dose
    expect(checkAnswer('Try 2 tablets with food', 'GENERAL_INFO')).toBe(DOSE_REPLY);
    expect(checkAnswer('The 500 ml bottle costs ₹299', 'NONE')).toBeNull(); // not a health answer
    expect(checkAnswer('Keep her calm and call your vet.', 'GENERAL_INFO')).toBeNull();
  });

  it('titles are short and break on a word', () => {
    expect(titleFrom('  Find a   groomer ')).toBe('Find a groomer');
    const t = titleFrom('Which contests can my golden retriever puppy enter this month, and what are the fees for each one?');
    expect(t.length).toBeLessThanOrEqual(58);
    expect(t.endsWith('…')).toBe(true);
  });

  it('“today” for the daily limit starts at midnight in India', () => {
    expect(indiaMidnight(new Date('2026-10-14T20:00:00Z')).toISOString()).toBe('2026-10-14T18:30:00.000Z'); // 1:30 am IST on the 15th
    expect(indiaMidnight(new Date('2026-10-14T10:00:00Z')).toISOString()).toBe('2026-10-13T18:30:00.000Z');
  });
});

describe('assistant knowledge', () => {
  it('works out what a question is about', () => {
    const cases: Array<[string, string]> = [
      ['What are the rules for the Cutest Puppy contest?', 'contest_rules'],
      ['Which contests can my cat enter?', 'contests'],
      ['any challenges running?', 'challenges'],
      ['cancel my booking', 'bookings'],
      ['Find a groomer near me', 'services'],
      ['I need a good vet', 'services'],
      ['buy puppy food', 'products'],
      ['How do I add my pet?', 'app_help'],
      ['where are my invoices', 'app_help'],
      ['Which foods are poisonous to dogs?', 'pet_care'],
      ['hello', 'hello'],
    ];
    for (const [q, intent] of cases) expect({ q, intent: intentOf(q) }).toEqual({ q, intent });
  });

  it('finds app guides and care notes', () => {
    expect(findGuide('how do I post a reel')?.route).toBe('/create');
    expect(findGuide('how can I return an item')?.route).toBe('/orders');
    expect(findGuide('my refund status')?.route).toBe('/money');
    expect(findGuide('what is the meaning of life')).toBeNull();
    expect(findCareNote('can dogs eat grapes?')?.id).toBe('toxic-foods');
    expect(findCareNote('ticks after walks')?.id).toBe('parasites');
    expect(findCareNote('rabies shot')?.id).toBe('vaccines');
    for (const n of ['vaccines', 'feeding', 'fleas']) expect(findCareNote(n === 'feeding' ? 'how much food' : n)?.body).toMatch(/vet/i);
  });

  it('matches service categories by everyday words', () => {
    const cats = [
      { key: 'grooming', name: 'Grooming' },
      { key: 'vet-consult', name: 'Vet consultation' },
      { key: 'boarding', name: 'Boarding' },
    ];
    expect(matchCategory('find a groomer', cats)?.key).toBe('grooming');
    expect(matchCategory('need a doctor for my cat', cats)?.key).toBe('vet-consult');
    expect(matchCategory('hostel for 3 days', cats)?.key).toBe('boarding');
    expect(matchCategory('dog walker', cats)).toBeNull(); // no walking category here
  });

  it('turns a shopping question into search words, without pet names', () => {
    expect(shopQuery('Find good puppy food for Bruno!', ['Bruno'])).toBe('puppy food');
    expect(shopQuery('I want to buy a cat litter box')).toBe('cat litter box');
  });
});
