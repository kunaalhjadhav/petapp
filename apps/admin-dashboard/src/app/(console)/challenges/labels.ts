export const KIND: Record<string, string> = {
  FREE: 'Free',
  PAID: 'Paid',
  CONTEST_LINKED: 'Contest entrants',
};
export const STATUS: Record<string, { label: string; tone: 'neutral' | 'good' | 'danger' }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PUBLISHED: { label: 'Published', tone: 'good' },
  ENDED: { label: 'Ended', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
};
