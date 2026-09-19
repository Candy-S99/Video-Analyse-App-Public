import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Release-Image pinnt die gegen den YouTube-403 geprüfte yt-dlp-Version', () => {
  const requirements = fs.readFileSync(new URL('../requirements.txt', import.meta.url), 'utf8');

  assert.match(
    requirements,
    /^yt-dlp==2026\.8\.19\s+\\\s*\r?\n\s*--hash=sha256:1d57897e94c6665a0a6f9bc54b34e584284e32c034ffab3a7df25d8f7b24eedf\s*$/m,
  );
});

test('Release-Image enthält die für YouTube benötigte EJS-Komponente', () => {
  const requirements = fs.readFileSync(new URL('../requirements.txt', import.meta.url), 'utf8');

  assert.match(
    requirements,
    /^yt-dlp-ejs==0\.8\.0\s+\\\s*\r?\n\s*--hash=sha256:79300e5fca7f937a1eeede11f0456862c1b41107ce1d726871e0207424f4bdb4\s*$/m,
  );
});
