const crypto = require('crypto');

// No 0/O or 1/I/L: codes get read aloud and copied from screenshots.
// 31 characters ^ 8 = ~852 billion codes, so guessing one is impractical.
const JOIN_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const JOIN_CODE_LENGTH = 8;

function generateJoinCode() {
  let code = '';
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    code += JOIN_CODE_ALPHABET[crypto.randomInt(JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

module.exports = { generateJoinCode, JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH };
