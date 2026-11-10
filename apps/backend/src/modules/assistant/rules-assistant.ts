import type { AssistantProvider, AssistantReply, AssistantTurn, ToolRunner } from '../../providers/ai/assistant.provider';
import { intentOf } from './assistant.knowledge';

type Data = Record<string, unknown> & { results?: Array<Record<string, unknown>> };

export const CAPABILITIES =
  'I can find pet services near you, products in the shop, contests and challenges, explain a contest’s rules, show your bookings, explain how to do things in the app, and share general pet-care tips. What would you like to do?';

/**
 * The assistant without an AI model: works out what the question is about from keywords, runs the same tools
 * and answers from templates. Always available (no key, no cost); used in development and tests, and when the model is down.
 */
export class RulesAssistant implements AssistantProvider {
  readonly name = 'rules';
  readonly usesModel = false;
  static readonly VERSION = '2026-10';

  async reply(turn: AssistantTurn, run: ToolRunner): Promise<AssistantReply> {
    const calls: AssistantReply['toolCalls'] = [];
    const has = (name: string) => turn.tools.some((t) => t.name === name);
    const call = async (name: string, input: Record<string, unknown> = {}) => {
      calls.push({ name, input });
      return (await run(name, input)) as Data;
    };
    const text = turn.text;
    let answer: string;
    const intent = intentOf(text);
    switch (intent) {
      case 'services': {
        if (!has('find_services')) {
          answer = 'Pet services aren’t available in the app yet.';
          break;
        }
        const d = await call('find_services', { category: text, home_visit: /\b(home visit|at home|come (to|home))\b/i.test(text) });
        const what = d.category ? `${(d.category as string).toLowerCase()} partners` : 'pet services';
        answer = d.needLocation
          ? `To find ${what} near you, choose your location at the top of the Home screen (or open Services), then ask me again.`
          : d.results?.length
            ? `Here are ${what} near you, best rated first. Tap one to see services, prices and free times.`
            : `I couldn’t find ${what} near you yet. Try another category in Services, or a different place.`;
        break;
      }
      case 'products': {
        if (!has('find_products')) {
          answer = 'The shop isn’t open in the app yet.';
          break;
        }
        const d = await call('find_products', { query: text });
        answer = d.results?.length
          ? `Here’s what I found for “${d.query}” in the shop.`
          : d.nothingMatched
            ? `Nothing in the shop matched “${d.query}”. Here are some picks for your pets instead.`
            : 'Here are some picks for your pets from the shop.';
        break;
      }
      case 'contests':
      case 'contest_rules': {
        if (!has('find_contests')) {
          answer = 'Contests aren’t running in the app yet.';
          break;
        }
        if (intent === 'contest_rules') {
          const name = text.replace(/.*?\b(rules?|judg\w*|prize|fee|deadline)\b( (of|for|in))?( the)?/i, '').replace(/\bcontest\b.*$/i, '').replace(/[?.!]/g, '').trim();
          const d = name ? await call('contest_details', { contest: name }) : { found: false };
          if (d.found) {
            answer = [
              `${d.title}: ${d.fee === 'free' ? 'free to enter' : `entry fee ${d.fee}`}, open to ${(d.whoCanEnter as string[]).join(', ')}.`,
              `${d.winners}`,
              (d.tasks as string[]).length ? `To submit: ${(d.tasks as string[]).join('; ')}.` : '',
              'The full rules and deadlines are on the contest page.',
            ].filter(Boolean).join(' ');
            break;
          }
        }
        const d = await call('find_contests');
        answer = d.results?.length
          ? `${intent === 'contest_rules' ? 'Which contest do you mean? ' : ''}Here are contests you can take part in. Open one to read its rules, prizes and deadlines.`
          : 'There are no contests open right now. New ones are announced in Alerts.';
        break;
      }
      case 'challenges': {
        if (!has('find_challenges')) {
          answer = 'Challenges aren’t running in the app yet.';
          break;
        }
        const d = await call('find_challenges');
        answer = d.results?.length
          ? 'Here are challenges you can join. Check in every day to build your streak and earn points and badges.'
          : 'There are no challenges running right now.';
        break;
      }
      case 'bookings': {
        if (!has('my_bookings')) {
          answer = 'Bookings aren’t available in the app yet.';
          break;
        }
        const d = await call('my_bookings');
        answer = d.results?.length
          ? `You have ${d.results.length} upcoming booking${d.results.length === 1 ? '' : 's'}. Open one to see the details or cancel it.`
          : 'You have no upcoming bookings. You can book one in Services.';
        break;
      }
      case 'app_help': {
        const d = await call('app_help', { topic: text });
        answer = d.found ? `${d.title}:\n${(d.steps as string[]).map((s, i) => `${i + 1}. ${s}`).join('\n')}` : CAPABILITIES;
        break;
      }
      case 'pet_care': {
        const d = await call('pet_care', { topic: text });
        answer = d.found ? `${d.note}` : CAPABILITIES;
        break;
      }
      default:
        answer = `Hi! I’m PetApp Assistant. ${CAPABILITIES}`;
    }
    return { text: answer, toolCalls: calls, model: 'petapp-rules', version: RulesAssistant.VERSION };
  }
}
