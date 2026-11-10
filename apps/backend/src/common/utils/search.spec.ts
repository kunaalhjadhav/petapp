import { likeText } from './search';

it('escapes LIKE wildcards so searches are literal', () => {
  expect(likeText('100%_off\\x')).toBe('100\\%\\_off\\\\x');
  expect(likeText('Bruno')).toBe('Bruno');
});
