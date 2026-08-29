import { describe, expect, it } from 'vitest';
import { parseClientMessage } from '../src/battle/protocol';

describe('battle WebSocket protocol', () => {
  it('accepts only supported input-shaped messages', () => {
    expect(parseClientMessage('{"type":"move","direction":1}')).toEqual({ type: 'move', direction: 1 });
    expect(parseClientMessage('{"type":"dropComplete","dropSequence":3}')).toEqual({ type: 'dropComplete', dropSequence: 3 });
    expect(parseClientMessage('{"type":"dropComplete","dropSequence":-1}')).toBeNull();
    expect(parseClientMessage('{"type":"move","direction":99}')).toBeNull();
    expect(parseClientMessage('{"type":"attackSelect","cardId":"card"}')).toEqual({ type: 'attackSelect', cardId: 'card' });
    expect(parseClientMessage('{"type":"rematch"}')).toEqual({ type: 'rematch' });
    expect(parseClientMessage('{broken')).toBeNull();
  });
});
