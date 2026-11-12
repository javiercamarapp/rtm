import type { NextConfig } from 'next';

// Encabezados de seguridad en TODAS las rutas. Los guiones en linea de Next (hidratacion) obligan a 'unsafe-inline' en script/style;
// el resto va cerrado: nada de terceros, nada de marcos, formularios solo al propio origen.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseUrl}`.trim(),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(process.env.VERCEL ? ['upgrade-insecure-requests'] : []),
].join('; ');
const encabezadosSeguridad = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

const config: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: encabezadosSeguridad }];
  },
  reactStrictMode: true,
  poweredByHeader: false,
  // El proyecto vive solo: la raiz de Turbopack es esta carpeta (hay otros package-lock mas arriba en el disco).
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  turbopack: { root: process.cwd() },
  // Sin fuentes por red: todas las tipografias son archivos locales (src/fuentes).
  agentRules: false,
  serverExternalPackages: ['pg'],
};

export default config;
