import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

// Fronteras entre capas (tambien las comprueba test/contratos/fronteras.test.ts recorriendo imports):
//   dominio     -> solo dominio (puro: sin red, sin base, sin reloj, sin azar, sin entorno)
//   aplicacion  -> dominio y puertos (sin librerias concretas)
//   infra       -> dominio y puertos; nunca app
//   composicion -> infra + aplicacion (cablea los puertos); nunca app/ui
//   app / ui    -> aplicacion, composicion, ui, dominio; nunca infra directo ni calcular negocio
const CAPAS = ['dominio', 'aplicacion', 'infra', 'composicion', 'app', 'ui', 'config'];
const prohibidas = (...tipos) => ({ disallow: { to: { element: { types: tipos } } } });

export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'supabase/**', 'test-results/**', 'playwright-report/**', 'next-env.d.ts', 'src/ui/login/particle-engine.js', 'test/fixtures/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mjs}'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly', fetch: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', Response: 'readonly', Headers: 'readonly', document: 'readonly', window: 'readonly', localStorage: 'readonly', matchMedia: 'readonly', navigator: 'readonly', MutationObserver: 'readonly', requestIdleCallback: 'readonly', Buffer: 'readonly' } },
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { project: './tsconfig.json' }, node: true },
      'boundaries/elements': CAPAS.map((c) => ({ type: c, pattern: `src/${c}/**`, partialMatch: false })),
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          policies: [
            { from: { element: { type: 'dominio' } }, ...prohibidas('aplicacion', 'infra', 'composicion', 'app', 'ui', 'config') },
            { from: { element: { type: 'aplicacion' } }, ...prohibidas('infra', 'composicion', 'app', 'ui', 'config') },
            { from: { element: { type: 'infra' } }, ...prohibidas('composicion', 'app', 'ui') },
            { from: { element: { type: 'composicion' } }, ...prohibidas('app', 'ui') },
            { from: { element: { type: 'ui' } }, ...prohibidas('infra', 'composicion', 'aplicacion', 'app') },
            { from: { element: { type: 'app' } }, ...prohibidas('infra') },
          ],
        },
      ],
      // Guardas de estilo del negocio: dinero y formato.
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.property.name=/^toLocale(String|DateString|TimeString)$/]", message: 'Formato regional prohibido fuera de src/dominio/formato.' },
        { selector: "MemberExpression[object.name='Intl'][property.name='NumberFormat']", message: 'Intl.NumberFormat prohibido fuera de src/dominio/formato.' },
        { selector: "Literal[value=/service_role/]", message: 'service_role no se usa en el tiempo de ejecucion de la web.' },
      ],
    },
  },
  {
    // El unico lugar donde se formatean numeros.
    files: ['src/dominio/formato/**/*.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // Dominio PURO.
    files: ['src/dominio/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ regex: '^(?!\\.|@/dominio)', message: 'El dominio solo importa del dominio: sin librerias, sin node:, sin red ni base.' }] }],
      'no-restricted-globals': ['error', { name: 'fetch', message: 'El dominio no hace red.' }, { name: 'process', message: 'El dominio no lee el entorno.' }, { name: 'localStorage', message: 'El dominio no toca el navegador.' }],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'El reloj entra como parametro.' },
        { object: 'Math', property: 'random', message: 'El azar entra como parametro.' },
        { object: 'process', property: 'env', message: 'El dominio no lee el entorno.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'new Date() sin argumento prohibido: el reloj entra como parametro.' },
        { selector: "CallExpression[callee.property.name=/^toLocale(String|DateString|TimeString)$/]", message: 'Formato regional prohibido en el dominio.' },
      ],
    },
  },
  {
    files: ['src/dominio/formato/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'new Date() sin argumento prohibido.' }] },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'test/**/*.ts', 'scripts/**/*.mjs', 'playwright*.ts'],
    rules: { 'no-restricted-syntax': 'off', '@typescript-eslint/no-explicit-any': 'off' },
  },
);
