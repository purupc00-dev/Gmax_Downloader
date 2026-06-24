import { request } from 'undici';

const TMDB = 'https://api.themoviedb.org/3';

export async function fetchMeta(tmdbId, type) {
  const key = process.env.TMDB_API_KEY;
  if (!key) {
    return { id: tmdbId, type, title: `TMDB ${tmdbId}`, poster: null, note: 'set TMDB_API_KEY for richer metadata' };
  }
  const url = `${TMDB}/${type}/${tmdbId}?api_key=${key}`;
  const { body, statusCode } = await request(url);
  if (statusCode >= 400) throw new Error(`TMDB ${statusCode}`);
  const j = await body.json();
  return {
    id: tmdbId,
    type,
    title: j.title || j.name,
    overview: j.overview,
    year: (j.release_date || j.first_air_date || '').slice(0, 4),
    poster: j.poster_path ? `https://image.tmdb.org/t/p/w342${j.poster_path}` : null,
    backdrop: j.backdrop_path ? `https://image.tmdb.org/t/p/w1280${j.backdrop_path}` : null,
    imdbId: j.external_ids?.imdb_id || null,
  };
}

export async function tmdbToImdb(tmdbId, type) {
  const key = process.env.TMDB_API_KEY;
  if (!key) return null;
  try {
    const url = `${TMDB}/${type}/${tmdbId}/external_ids?api_key=${key}`;
    const { body, statusCode } = await request(url);
    if (statusCode >= 400) return null;
    const j = await body.json();
    return j.imdb_id || null;
  } catch {
    return null;
  }
}
