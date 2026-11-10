import { randomInt } from 'crypto';
import type { ChatSide, ConversationKind, TicketStatus } from '../../generated/prisma/enums';

/** Longest message body. The database allows a little more, so a trimmed edit never trips the constraint. */
export const MAX_BODY = 2000;

/** What a conversation list shows for the latest message. */
export function previewOf(m: { body: string | null; mediaKind?: string | null; refType?: string | null; status?: string }): string {
  if (m.status && m.status !== 'VISIBLE') return 'Message removed';
  const text = m.body?.replace(/\s+/g, ' ').trim();
  if (text) return text.length > 120 ? `${text.slice(0, 119)}…` : text;
  if (m.mediaKind === 'IMAGE') return 'Photo';
  if (m.mediaKind === 'DOCUMENT') return 'File';
  if (m.refType === 'BOOKING') return 'Booking';
  if (m.refType === 'PRODUCT') return 'Product';
  if (m.refType === 'ORDER') return 'Order';
  return '';
}

/** Which side of a conversation someone is on, or null if they aren't in it. Staff are handled by the support service. */
export function sideOf(
  c: { kind: ConversationKind; customerId: string; partner?: { userId: string } | null; vendor?: { userId: string } | null },
  userId: string,
): Extract<ChatSide, 'CUSTOMER' | 'BUSINESS'> | null {
  if (c.customerId === userId) return 'CUSTOMER';
  if (c.kind === 'SERVICE' && c.partner?.userId === userId) return 'BUSINESS';
  if (c.kind === 'SHOP' && c.vendor?.userId === userId) return 'BUSINESS';
  return null;
}

/** Ticket codes people can read out on the phone: no 0/O or 1/I. */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function ticketCode(): string {
  let s = 'T-';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

/** Statuses staff can set by hand, and from which statuses. CLOSED is final. */
const STAFF_MOVES: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['ASSIGNED', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'],
  ASSIGNED: ['OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['WAITING', 'RESOLVED', 'CLOSED'],
  WAITING: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: [],
};
export function staffCanMove(from: TicketStatus, to: TicketStatus): boolean {
  return STAFF_MOVES[from].includes(to);
}

/** A staff reply (not a note) moves a new or assigned ticket to In progress; otherwise the status stays. */
export function afterStaffReply(s: TicketStatus): TicketStatus {
  return s === 'OPEN' || s === 'ASSIGNED' ? 'IN_PROGRESS' : s;
}

/**
 * The person replied. Waiting and resolved tickets come back to staff (In progress); a closed ticket can't take
 * replies (the person opens a new one). Returns null when the reply isn't allowed.
 */
export function afterCustomerReply(s: TicketStatus): TicketStatus | null {
  if (s === 'CLOSED') return null;
  if (s === 'WAITING' || s === 'RESOLVED') return 'IN_PROGRESS';
  return s;
}

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: 'Open',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  WAITING: 'Waiting for your reply',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

/** Who an app's FAQs and categories are for. */
export type Audience = 'CUSTOMER' | 'PARTNER' | 'SELLER';
export const audienceFilter = (a: Audience) => ({ in: ['ALL', a] });

/** Server → app events over the WebSocket. */
export type ChatEvent =
  | { type: 'message'; conversationId: string; message: unknown }
  | { type: 'message-updated'; conversationId: string; messageId: string; status: string }
  | { type: 'read'; conversationId: string; side: 'CUSTOMER' | 'BUSINESS' | 'STAFF'; at: string }
  | { type: 'typing'; conversationId: string; side: 'CUSTOMER' | 'BUSINESS' }
  | { type: 'conversation'; conversationId: string; status: string };

/** Commands an app may send over the WebSocket. Everything else is ignored. */
export function parseClientCommand(raw: string): { type: 'ping' } | { type: 'typing'; conversationId: string } | null {
  if (raw.length > 512) return null;
  try {
    const v = JSON.parse(raw) as { type?: unknown; conversationId?: unknown };
    if (v.type === 'ping') return { type: 'ping' };
    if (v.type === 'typing' && typeof v.conversationId === 'string' && /^[0-9a-f-]{36}$/i.test(v.conversationId)) {
      return { type: 'typing', conversationId: v.conversationId };
    }
  } catch {
    /* not JSON */
  }
  return null;
}
