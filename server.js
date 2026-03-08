const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const HOST = '0.0.0.0';
const PORT = Number(process.env.CREATOR_GALLERY_PORT || 3012);
const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, 'creator.config.json');
const COOKIE_PATH = path.join(ROOT, 'creatorCookies', 'cookie.txt');
const CREATORS_DIR = path.join(ROOT, 'creators');

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(payload);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    req.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
    });
    req.on('end', () => resolve(buffer));
    req.on('error', reject);
  });
}

function extractCookieHeader(input) {
  if (!input) return '';

  const lines = input.split(/\r?\n/);
  const netscapeCookies = lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('\t'))
    .filter((parts) => parts.length >= 7)
    .map((parts) => `${parts[5]}=${parts.slice(6).join('\t')}`);

  if (netscapeCookies.length) {
    return netscapeCookies.join('; ');
  }

  return input
    .replace(/^cookie:\s*/i, '')
    .replace(/^document\.cookie\s*=\s*/i, '')
    .replace(/^["'`]|["'`]$/g, '')
    .trim();
}

function getCreatorPosts(creatorId) {
  const postsPath = path.join(CREATORS_DIR, creatorId, 'posts.json');
  return readJson(postsPath, []);
}

function getMediaUrl(post) {
  const candidates = [
    post.location,
    post.postUrl,
    post.cf_preview,
    post.cf_thumbnail,
    post.thumbnailLocation,
    post.key,
    post.source,
  ].filter(Boolean);

  const mediaPath = candidates[0];
  if (!mediaPath) return null;
  if (/^https?:\/\//i.test(mediaPath)) return mediaPath;
  return `https://cdn.official.me/${mediaPath.replace(/^\/+/, '')}`;
}

function validateMediaAccess(creatorId) {
  return new Promise((resolve) => {
    const posts = getCreatorPosts(creatorId);
    const mediaTarget = posts.map(getMediaUrl).find(Boolean);
    const cookieHeader = extractCookieHeader(
      fs.existsSync(COOKIE_PATH) ? fs.readFileSync(COOKIE_PATH, 'utf8') : ''
    );

    if (!mediaTarget) {
      resolve({
        ok: false,
        reason: 'No playable media found for this creator.',
      });
      return;
    }

    if (!cookieHeader) {
      resolve({
        ok: false,
        reason: 'No creator cookie file saved on server.',
      });
      return;
    }

    const parsedUrl = new URL(mediaTarget);
    const upstream = https.request(
      parsedUrl,
      {
        method: 'GET',
        headers: {
          Accept: '*/*',
          'Accept-Encoding': 'identity',
          Cookie: cookieHeader,
          Range: 'bytes=0-1',
          Referer: 'https://official.me/',
          'User-Agent': 'Mozilla/5.0',
        },
      },
      (upstreamRes) => {
        resolve({
          ok: upstreamRes.statusCode === 206 || upstreamRes.statusCode === 200,
          statusCode: upstreamRes.statusCode,
          contentType: upstreamRes.headers['content-type'] || '',
        });
        upstreamRes.resume();
      }
    );

    upstream.on('error', (error) => {
      resolve({
        ok: false,
        reason: error.message,
      });
    });

    upstream.end();
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/creator/config') {
    sendJson(res, 200, readJson(CONFIG_PATH, {}));
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/creator/config') {
    const raw = await readBody(req);
    const payload = JSON.parse(raw || '{}');
    const nextConfig = {
      displayName: payload.displayName || 'Creator Gallery',
      influencerId: payload.influencerId || '',
      userId: payload.userId || '',
    };

    ensureDir(CONFIG_PATH);
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(nextConfig, null, 2), 'utf8');
    sendJson(res, 200, { ok: true, config: nextConfig });
    return;
  }

  if (
    req.method === 'GET' &&
    requestUrl.pathname.startsWith('/api/creators/') &&
    requestUrl.pathname.endsWith('/posts')
  ) {
    const creatorId = requestUrl.pathname.split('/')[3];
    sendJson(res, 200, { ok: true, posts: getCreatorPosts(creatorId) });
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/cookies') {
    const raw = await readBody(req);
    const payload = JSON.parse(raw || '{}');
    const cookiesText = payload.cookiesText || '';

    if (!cookiesText.trim()) {
      sendJson(res, 400, { ok: false, message: 'cookiesText is required.' });
      return;
    }

    ensureDir(COOKIE_PATH);
    fs.writeFileSync(COOKIE_PATH, cookiesText, 'utf8');
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/cookies/status') {
    const creatorId = requestUrl.searchParams.get('creatorId') || '';
    const result = await validateMediaAccess(creatorId);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/media') {
    const target = requestUrl.searchParams.get('url');
    if (!target) {
      sendText(res, 400, 'Missing media URL.');
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(target);
    } catch (error) {
      sendText(res, 400, 'Invalid media URL.');
      return;
    }

    if (parsedUrl.hostname !== 'cdn.official.me') {
      sendText(res, 400, 'Only cdn.official.me media is allowed.');
      return;
    }

    const cookieHeader = extractCookieHeader(
      fs.existsSync(COOKIE_PATH) ? fs.readFileSync(COOKIE_PATH, 'utf8') : ''
    );

    if (!cookieHeader) {
      sendText(res, 500, 'No cookie.txt saved on server.');
      return;
    }

    const upstream = https.request(
      parsedUrl,
      {
        method: 'GET',
        headers: {
          Accept: req.headers.accept || '*/*',
          'Accept-Encoding': 'identity',
          Cookie: cookieHeader,
          Range: req.headers.range || 'bytes=0-',
          Referer: 'https://official.me/',
          'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        },
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, {
          'Access-Control-Allow-Origin': '*',
          'Accept-Ranges': upstreamRes.headers['accept-ranges'] || 'bytes',
          'Cache-Control': upstreamRes.headers['cache-control'] || 'no-store',
          'Content-Length': upstreamRes.headers['content-length'] || '',
          'Content-Range': upstreamRes.headers['content-range'] || '',
          'Content-Type':
            upstreamRes.headers['content-type'] || 'application/octet-stream',
          ETag: upstreamRes.headers.etag || '',
          'Last-Modified': upstreamRes.headers['last-modified'] || '',
        });

        upstreamRes.pipe(res);
      }
    );

    upstream.on('error', (error) => {
      if (!res.headersSent) {
        sendText(res, 502, `Media proxy failed: ${error.message}`);
      }
    });

    upstream.end();
    return;
  }

  sendJson(res, 404, { ok: false, message: 'Not found.' });
});

server.listen(PORT, HOST, () => {
  console.log(`Creator gallery API listening on http://${HOST}:${PORT}`);
});
