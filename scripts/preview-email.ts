import { mkdir, writeFile } from 'node:fs/promises';
import { passwordResetTemplate } from '../src/templates/password-reset.ts';
import { astroLogoBase64 } from '../src/templates/astro-logo.ts';
import { recoveryPlanetBase64 } from '../src/templates/design-assets.ts';

const example = 'https://astro-inter.github.io/astro-web/replacePassword?mode=resetPassword&oobCode=PREVIA-SEM-VALIDADE';
const template = passwordResetTemplate(example);
await mkdir('dist', { recursive: true });
await writeFile('dist/email-preview.html', template.html
  .replace('cid:logo-astro', `data:image/png;base64,${astroLogoBase64}`)
  .replace('cid:recovery-planet', `data:image/png;base64,${recoveryPlanetBase64}`));
await writeFile('dist/email-preview.txt', template.text);
console.log('Prévia sem código real: dist/email-preview.html');
