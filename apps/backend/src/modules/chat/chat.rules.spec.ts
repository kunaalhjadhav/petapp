import { afterCustomerReply, afterStaffReply, parseClientCommand, previewOf, sideOf, staffCanMove, ticketCode } from './chat.rules';

describe('chat rules', () => {
  it('previews text, photos, files and cards, and hides removed messages', () => {
    expect(previewOf({ body: '  Is   Saturday ok? ' })).toBe('Is Saturday ok?');
    expect(previewOf({ body: 'x'.repeat(300) })).toHaveLength(120);
    expect(previewOf({ body: null, mediaKind: 'IMAGE' })).toBe('Photo');
    expect(previewOf({ body: null, mediaKind: 'DOCUMENT' })).toBe('File');
    expect(previewOf({ body: '', refType: 'BOOKING' })).toBe('Booking');
    expect(previewOf({ body: 'rude words', status: 'HIDDEN' })).toBe('Message removed');
  });

  it('knows who is on which side, and nobody else', () => {
    const service = { kind: 'SERVICE' as const, customerId: 'c', partner: { userId: 'p' }, vendor: null };
    const shop = { kind: 'SHOP' as const, customerId: 'c', partner: null, vendor: { userId: 'v' } };
    expect(sideOf(service, 'c')).toBe('CUSTOMER');
    expect(sideOf(service, 'p')).toBe('BUSINESS');
    expect(sideOf(service, 'v')).toBeNull();
    expect(sideOf(shop, 'v')).toBe('BUSINESS');
    expect(sideOf(shop, 'p')).toBeNull();
    // A support thread has no business side: staff are checked separately.
    expect(sideOf({ kind: 'SUPPORT', customerId: 'c' }, 'p')).toBeNull();
  });

  it('makes readable ticket codes', () => {
    for (let i = 0; i < 200; i++) expect(ticketCode()).toMatch(/^T-[2-9A-HJ-NP-Z]{6}$/);
  });

  it('moves tickets the way support works', () => {
    expect(afterStaffReply('OPEN')).toBe('IN_PROGRESS');
    expect(afterStaffReply('ASSIGNED')).toBe('IN_PROGRESS');
    expect(afterStaffReply('WAITING')).toBe('WAITING');
    expect(afterCustomerReply('WAITING')).toBe('IN_PROGRESS');
    expect(afterCustomerReply('RESOLVED')).toBe('IN_PROGRESS');
    expect(afterCustomerReply('OPEN')).toBe('OPEN');
    expect(afterCustomerReply('CLOSED')).toBeNull();
    expect(staffCanMove('RESOLVED', 'CLOSED')).toBe(true);
    expect(staffCanMove('CLOSED', 'OPEN')).toBe(false);
    expect(staffCanMove('IN_PROGRESS', 'OPEN')).toBe(false);
  });

  it('accepts only the two WebSocket commands', () => {
    expect(parseClientCommand('{"type":"ping"}')).toEqual({ type: 'ping' });
    expect(parseClientCommand('{"type":"typing","conversationId":"0b9f6c1e-2d4a-4e8b-9c3d-1a2b3c4d5e6f"}')).toEqual({ type: 'typing', conversationId: '0b9f6c1e-2d4a-4e8b-9c3d-1a2b3c4d5e6f' });
    expect(parseClientCommand('{"type":"typing","conversationId":"x; DROP"}')).toBeNull();
    expect(parseClientCommand('{"type":"send","body":"hi"}')).toBeNull();
    expect(parseClientCommand('not json')).toBeNull();
    expect(parseClientCommand(`{"type":"ping","pad":"${'x'.repeat(600)}"}`)).toBeNull();
  });
});
