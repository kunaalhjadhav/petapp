export const CONTEST_STATUS: Record<
  string,
  { label: string; tone: 'neutral' | 'good' | 'warn' | 'danger' | 'teal' }
> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  REVIEW: { label: 'In review', tone: 'warn' },
  SCHEDULED: { label: 'Scheduled', tone: 'teal' },
  LIVE: { label: 'Live', tone: 'good' },
  VOTING: { label: 'Voting', tone: 'good' },
  EVALUATION: { label: 'Judging', tone: 'warn' },
  WINNER_DECLARATION: { label: 'Declaring winners', tone: 'warn' },
  COMPLETED: { label: 'Completed', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
};

/** What each move means, shown on the button's confirmation. */
export const NEXT: Record<string, { label: string; explain: string }> = {
  REVIEW: {
    label: 'Send for review',
    explain: 'Locks in the setup for a second pair of eyes. It can go back to draft.',
  },
  DRAFT: { label: 'Back to draft', explain: 'Reopens the contest for editing.' },
  SCHEDULED: {
    label: 'Approve and schedule',
    explain: 'The contest appears in the app as upcoming. Registration opens at its start time.',
  },
  LIVE: {
    label: 'Go live',
    explain: 'Entries and submissions open. Paid contests need a recorded legal review first.',
  },
  VOTING: {
    label: 'Open voting',
    explain: 'Submissions close and public voting starts. Needs the minimum number of entries.',
  },
  EVALUATION: {
    label: 'Close voting',
    explain: 'Voting ends. Judges finish scoring, then freeze the leaderboard.',
  },
  WINNER_DECLARATION: {
    label: 'Move to winner declaration',
    explain: 'Needs a frozen leaderboard. Then declare the winners.',
  },
  COMPLETED: { label: 'Complete', explain: 'Closes the contest. Results stay public.' },
  CANCELLED: {
    label: 'Cancel contest',
    explain:
      'Every entry is withdrawn and paid entry fees are queued for refund. Participants see the reason.',
  },
};
