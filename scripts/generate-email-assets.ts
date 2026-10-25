import { readFile, writeFile } from 'node:fs/promises';

const files = [
  ['recoveryPlanetBase64', 'recovery-planet.png'],
  ['montserratRegularBase64', 'montserrat-400.woff2'],
  ['montserratSemiboldBase64', 'montserrat-600.woff2'],
] as const;
const declarations = await Promise.all(files.map(async ([name, file]) => {
  const bytes = await readFile(new URL(`../assets/email/${file}`, import.meta.url));
  return `export const ${name} = '${bytes.toString('base64')}';`;
}));
await writeFile(new URL('../src/templates/design-assets.ts', import.meta.url),
  '// Gerado com npm run assets:email. Fontes e origem em assets/email/README.md.\n' + declarations.join('\n') + '\n');
console.log('Assets inline do e-mail atualizados.');
