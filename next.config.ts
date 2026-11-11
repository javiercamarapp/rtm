import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // El proyecto vive solo: la raiz de Turbopack es esta carpeta (hay otros package-lock mas arriba en el disco).
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  turbopack: { root: process.cwd() },
  // Sin fuentes por red: todas las tipografias son archivos locales (src/fuentes).
  agentRules: false,
};

export default config;
