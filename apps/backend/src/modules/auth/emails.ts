// Staff account emails (Phase 9e). Plain words; the text version is complete on its own.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const istTime = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d) + ' IST';

function html(paragraphs: string[], button?: { label: string; url: string }) {
  const p = paragraphs.map((t) => `<p style="margin:0 0 14px;line-height:1.5">${esc(t)}</p>`).join('');
  const b = button
    ? `<p style="margin:18px 0"><a href="${esc(button.url)}" style="background:#1d5c58;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${esc(button.label)}</a></p>`
    : '';
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1b2430;max-width:520px">${p}${b}</div>`;
}

export function resetEmail(o: { name: string | null; url: string; minutes: number; byStaff: boolean }) {
  const hi = `Hello${o.name ? ` ${o.name}` : ''},`;
  const why = o.byStaff ? 'A PetApp administrator sent you a link to set a new password for the PetApp Admin Dashboard.' : 'Someone (hopefully you) asked to reset your PetApp Admin Dashboard password.';
  const lines = [hi, why, `The link works once, for ${o.minutes} minutes.`, 'If you didn’t ask for this, ignore this email: your password hasn’t changed.'];
  return {
    subject: 'Reset your PetApp Admin password',
    text: `${lines[0]}\n\n${lines[1]}\n\nSet a new password: ${o.url}\n\n${lines[2]}\n${lines[3]}\n`,
    html: html(lines, { label: 'Set a new password', url: o.url }),
  };
}

export function changedEmail(o: { name: string | null; at: Date; how: 'changed' | 'reset' }) {
  const lines = [
    `Hello${o.name ? ` ${o.name}` : ''},`,
    `Your PetApp Admin Dashboard password was ${o.how} on ${istTime(o.at)}. You’ve been signed out everywhere else.`,
    'If this wasn’t you, contact your PetApp administrator at once.',
  ];
  return { subject: 'Your PetApp Admin password was changed', text: lines.join('\n\n') + '\n', html: html(lines) };
}

export function mfaEmail(o: { name: string | null; subject: string; line: string }) {
  const lines = [`Hello${o.name ? ` ${o.name}` : ''},`, o.line];
  return { subject: o.subject, text: lines.join('\n\n') + '\n', html: html(lines) };
}
