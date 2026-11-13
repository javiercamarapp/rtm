// Alias en español de /api/health (la ruta canonica). Publica y sin datos: solo confirma que la app responde.
// Existe porque los monitores del dueño la consultan con este nombre; sin ella el proxy la mandaba al login (307).
export { GET } from '../health/route';
export const dynamic = 'force-dynamic';
