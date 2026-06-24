// Shared helpers for extractors.
import { request } from 'undici';

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export async function httpGet(url, headers = {}) {
  const { body, statusCode, headers: resHeaders } = await request(url, {
    method: 'GET',
    headers: {
      'user-agent': UA,
      'accept': '*/*',
      'accept-language': 'en-US,en;q=0.9',
      ...headers,
    },
    maxRedirections: 5,
  });
  const text = await body.text();
  return { status: statusCode, text, headers: resHeaders };
}

export async function httpPost(url, formOrJson, headers = {}) {
  const isForm = typeof formOrJson === 'string';
  const { body, statusCode } = await request(url, {
    method: 'POST',
    headers: {
      'user-agent': UA,
      'accept': '*/*',
      'content-type': isForm ? 'application/x-www-form-urlencoded' : 'application/json',
      ...headers,
    },
    body: isForm ? formOrJson : JSON.stringify(formOrJson),
    maxRedirections: 5,
  });
  const text = await body.text();
  return { status: statusCode, text };
}

export function detectType(url) {
  if (/\.m3u8(\?|$)/i.test(url)) return 'm3u8';
  if (/\.mp4(\?|$)/i.test(url)) return 'mp4';
  if (/\.mkv(\?|$)/i.test(url)) return 'mkv';
  return 'unknown';
}
