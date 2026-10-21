import type { APIRoute } from 'astro';
import { registrationOpen } from '../../lib/server/config';
import { json } from '../../lib/server/http';
export const prerender = false;
export const GET: APIRoute = () => json({ open: registrationOpen() });
