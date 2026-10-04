const { generateJoinCode, JOIN_CODE_ALPHABET } = require('../../src/utils/joinCode');

test('codes are 8 characters from the unambiguous alphabet, with no 0/O or 1/I/L', () => {
  expect(JOIN_CODE_ALPHABET).not.toMatch(/[01OIL]/);

  for (let i = 0; i < 500; i++) {
    expect(generateJoinCode()).toMatch(new RegExp(`^[${JOIN_CODE_ALPHABET}]{8}$`));
  }
});

test('uses the whole alphabet (no character is unreachable)', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) for (const char of generateJoinCode()) seen.add(char);

  expect([...seen].sort().join('')).toBe([...JOIN_CODE_ALPHABET].sort().join(''));
});
