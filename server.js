const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');

const HOST = '0.0.0.0';
const PORT = Number(process.env.CREATOR_GALLERY_PORT || 3012);
const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, 'creator.config.json');
const OFFICIAL_AUTH_PATH = path.join(ROOT, 'official.auth.json');
const COOKIE_PATH = path.join(ROOT, 'creatorCookies', 'cookie.txt');
const CREATORS_DIR = path.join(ROOT, 'creators');
const DOWNLOADS_DIR = path.join(ROOT, 'downloads');
const OFFICIAL_API_HOST = 'api.official.me';
const OFFICIAL_BEARER_TOKEN = process.env.OFFICIAL_BEARER_TOKEN || '';
const OFFICIAL_USER_ID = process.env.OFFICIAL_USER_ID || '';
const OFFICIAL_USER_POSTS_KEY = 'd41d8cd98f00b204e9800998ecf8427e';
const OFFICIAL_USER_POSTS_PAGE_SIZE = 10;
const OFFICIAL_POSTS_PAGE_SIZE = 8;
const MAX_SYNC_PAGES = 200;
const DEBUG = process.env.CREATOR_DEBUG !== '0';
const CDN_PROXY_AGENT = new https.Agent({
  keepAlive: true,
  maxSockets: 64,
  maxFreeSockets: 16,
  timeout: 60_000,
});
let ffmpegAvailability = null;
let aria2Availability = null;

function debugLog(...args) {
  if (!DEBUG) return;
  console.log('[creator-debug]', ...args);
}

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

function getConfiguredCreatorId() {
  const config = readJson(CONFIG_PATH, {});
  return config.influencerId || '';
}

function getConfiguredUsername() {
  const config = readJson(CONFIG_PATH, {});
  return config.username || '';
}

function sanitizeFileName(input, fallback = 'download.bin') {
  const cleaned = String(input || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!cleaned) return fallback;
  return cleaned.slice(0, 140);
}

function getExtensionFromUrl(target) {
  try {
    const parsed = new URL(target);
    const extension = path.extname(parsed.pathname || '').toLowerCase();
    return extension && extension.length <= 6 ? extension : '';
  } catch (error) {
    return '';
  }
}

function getMimeTypeFromExtension(extension) {
  if (extension === '.mp4') return 'video/mp4';
  if (extension === '.mov') return 'video/quicktime';
  if (extension === '.m4v') return 'video/x-m4v';
  if (extension === '.webm') return 'video/webm';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  return 'application/octet-stream';
}

function isLikelyVideoUrl(target) {
  return /\.(mp4|mov|m4v|webm|mkv|avi)(?:$|[?#])/i.test(target);
}

function safeUnlink(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    debugLog('safeUnlink:error', { filePath, message: error.message });
  }
}

function inspectDownloadedFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: 'Downloaded file is missing.' };
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    return { ok: false, reason: `Could not stat downloaded file: ${error.message}` };
  }

  if (!stat.size) {
    return { ok: false, reason: 'Downloaded file is empty.' };
  }

  try {
    const headBuffer = Buffer.alloc(4096);
    const fd = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(fd, headBuffer, 0, headBuffer.length, 0);
    fs.closeSync(fd);
    const head = headBuffer
      .subarray(0, Math.max(0, bytesRead))
      .toString('utf8')
      .replace(/\0/g, '')
      .trim()
      .toLowerCase();

    const looksLikeHtml =
      head.startsWith('<!doctype html') ||
      head.startsWith('<html') ||
      head.includes('<html');
    const looksLikeXmlError =
      head.startsWith('<?xml') ||
      head.includes('<error>') ||
      head.includes('<code>accessdenied') ||
      head.includes('<message>access denied');
    const looksLikeJsonError =
      head.startsWith('{') &&
      (head.includes('"error"') ||
        head.includes('"errors"') ||
        head.includes('"message"') ||
        head.includes('"status"'));

    if (looksLikeHtml || looksLikeXmlError || looksLikeJsonError) {
      return {
        ok: false,
        reason:
          'Upstream returned non-media content (HTML/XML/JSON). Cookies or media URL may be invalid/expired.',
      };
    }
  } catch (error) {
    return {
      ok: false,
      reason: `Could not inspect downloaded file: ${error.message}`,
    };
  }

  return { ok: true, size: stat.size };
}

function getFfmpegAvailability() {
  if (ffmpegAvailability) return ffmpegAvailability;
  try {
    const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
    const ok = !probe.error && probe.status === 0;
    const message = probe.error
      ? probe.error.message
      : (probe.stderr || '').trim().split('\n')[0] || '';
    ffmpegAvailability = { ok, message };
  } catch (error) {
    ffmpegAvailability = { ok: false, message: error.message };
  }
  return ffmpegAvailability;
}

function getAria2Availability() {
  if (aria2Availability) return aria2Availability;
  try {
    const probe = spawnSync('aria2c', ['-v'], { encoding: 'utf8' });
    const ok = !probe.error && probe.status === 0;
    const message = probe.error
      ? probe.error.message
      : (probe.stderr || '').trim().split('\n')[0] || '';
    aria2Availability = { ok, message };
  } catch (error) {
    aria2Availability = { ok: false, message: error.message };
  }
  return aria2Availability;
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderrBuffer = '';
    child.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString('utf8');
      if (stderrBuffer.length > 8_000) {
        stderrBuffer = stderrBuffer.slice(-8_000);
      }
    });
    child.on('error', (error) => {
      resolve({
        ok: false,
        code: -1,
        stderr: stderrBuffer,
        error: error.message,
      });
    });
    child.on('close', (code) => {
      resolve({
        ok: code === 0,
        code: code ?? -1,
        stderr: stderrBuffer.trim(),
      });
    });
  });
}

async function downloadMediaToFile({ target, cookieHeader, outputPath, preferFfmpeg }) {
  const aria2State = getAria2Availability();
  if (aria2State.ok) {
    const aria2Args = [
      '--allow-overwrite=true',
      '--auto-file-renaming=false',
      '--continue=true',
      '--max-connection-per-server=16',
      '--split=16',
      '--min-split-size=1M',
      '--file-allocation=none',
      '--summary-interval=0',
      '--console-log-level=warn',
      '--dir',
      path.dirname(outputPath),
      '--out',
      path.basename(outputPath),
      '--header',
      `Cookie: ${cookieHeader}`,
      '--header',
      'Referer: https://official.me/',
      '--header',
      'User-Agent: Mozilla/5.0',
      '--header',
      'Accept: */*',
      target,
    ];
    const aria2Result = await runCommand('aria2c', aria2Args);
    if (aria2Result.ok) {
      const aria2FileCheck = inspectDownloadedFile(outputPath);
      if (aria2FileCheck.ok) {
        return { ok: true, tool: 'aria2c', size: aria2FileCheck.size };
      }
      safeUnlink(outputPath);
      debugLog('download:aria2c-rejected', {
        target,
        reason: aria2FileCheck.reason,
      });
    }
    safeUnlink(outputPath);
    debugLog('download:aria2c-failed', {
      target,
      code: aria2Result.code,
      stderr: aria2Result.stderr || aria2Result.error || 'aria2c failed',
    });
  } else {
    debugLog('download:aria2c-unavailable', { reason: aria2State.message });
  }

  const ffmpegState = getFfmpegAvailability();
  if (preferFfmpeg && ffmpegState.ok) {
    const ffmpegHeaders =
      `Cookie: ${cookieHeader}\r\n` +
      'Referer: https://official.me/\r\n' +
      'User-Agent: Mozilla/5.0\r\n';
    const ffmpegArgs = [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-headers',
      ffmpegHeaders,
      '-i',
      target,
      '-map',
      '0',
      '-c',
      'copy',
      outputPath,
    ];
    const ffmpegResult = await runCommand('ffmpeg', ffmpegArgs);
    if (ffmpegResult.ok) {
      const ffmpegFileCheck = inspectDownloadedFile(outputPath);
      if (ffmpegFileCheck.ok) {
        return { ok: true, tool: 'ffmpeg', size: ffmpegFileCheck.size };
      }
      safeUnlink(outputPath);
      debugLog('download:ffmpeg-rejected', {
        target,
        reason: ffmpegFileCheck.reason,
      });
    }
    safeUnlink(outputPath);
    debugLog('download:ffmpeg-failed', {
      target,
      code: ffmpegResult.code,
      stderr: ffmpegResult.stderr || ffmpegResult.error || ffmpegState.message,
    });
  } else if (preferFfmpeg && !ffmpegState.ok) {
    debugLog('download:ffmpeg-unavailable', { reason: ffmpegState.message });
  }

  const curlArgs = [
    '--location',
    '--fail',
    '--silent',
    '--show-error',
    '--retry',
    '3',
    '--retry-delay',
    '1',
    '--connect-timeout',
    '20',
    '--output',
    outputPath,
    '--header',
    `Cookie: ${cookieHeader}`,
    '--header',
    'Referer: https://official.me/',
    '--header',
    'User-Agent: Mozilla/5.0',
    '--header',
    'Accept: */*',
    target,
  ];

  const curlResult = await runCommand('curl', curlArgs);
  if (curlResult.ok) {
    const curlFileCheck = inspectDownloadedFile(outputPath);
    if (curlFileCheck.ok) {
      return { ok: true, tool: 'curl', size: curlFileCheck.size };
    }
    safeUnlink(outputPath);
    return {
      ok: false,
      tool: 'curl',
      reason: curlFileCheck.reason,
    };
  }

  safeUnlink(outputPath);
  return {
    ok: false,
    tool: 'curl',
    reason:
      curlResult.stderr ||
      curlResult.error ||
      (aria2State.ok
        ? 'aria2c + curl failed.'
        : 'aria2c unavailable, and curl failed.'),
  };
}

function normalizeMediaUrl(pathValue) {
  const value = String(pathValue || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `https://cdn.official.me/${value.replace(/^\/+/, '')}`;
}

function isVideoUrl(url) {
  return /\.(mp4|mov|m4v|webm|mkv|avi)(?:$|[?#])/i.test(url);
}

function isImageUrl(url) {
  return /\.(jpg|jpeg|png|webp|gif|bmp|avif)(?:$|[?#])/i.test(url);
}

function matchesPostType(url, type) {
  if (type === 'Video') return isVideoUrl(url);
  if (type === 'Image') return isImageUrl(url);
  return true;
}

function scoreMediaCandidate(candidate) {
  const url = candidate.url.toLowerCase();
  let score = 0;
  if (candidate.field === 'source') score += 100;
  if (!url.includes('/compressed/')) score += 40;
  if (!url.includes('thumbnail')) score += 20;
  if (!url.includes('preview')) score += 15;
  if (url.includes('/media/')) score += 10;
  if (url.includes('cloudfront')) score += 5;
  return score;
}

function getMediaUrl(post) {
  const rawCandidates = [
    ['source', post.source],
    ['location', post.location],
    ['postUrl', post.postUrl],
    ['key', post.key],
    ['cf_preview', post.cf_preview],
    ['cf_thumbnail', post.cf_thumbnail],
    ['thumbnailLocation', post.thumbnailLocation],
  ];

  const candidates = rawCandidates
    .map(([field, value], index) => ({
      field,
      index,
      url: normalizeMediaUrl(value),
    }))
    .filter((entry) => entry.url);

  if (!candidates.length) return null;

  const matchedType = candidates.filter((entry) =>
    matchesPostType(entry.url, post.type)
  );
  const pool = matchedType.length ? matchedType : candidates;

  pool.sort((a, b) => {
    const scoreDiff = scoreMediaCandidate(b) - scoreMediaCandidate(a);
    if (scoreDiff !== 0) return scoreDiff;
    return a.index - b.index;
  });

  return pool[0].url;
}

function getStoredOfficialAuth() {
  const saved = readJson(OFFICIAL_AUTH_PATH, {});
  return {
    bearerToken: normalizeBearerToken(saved.bearerToken),
    userId: String(saved.userId || '').trim(),
  };
}

function normalizeBearerToken(value) {
  return String(value || '')
    .trim()
    .replace(/^bearer\s+/i, '')
    .trim();
}

function parseJwtPayload(token) {
  const raw = normalizeBearerToken(token);
  const parts = raw.split('.');
  if (parts.length < 2) return null;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      '='
    );
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (error) {
    return null;
  }
}

function inferUserIdFromToken(token) {
  const payload = parseJwtPayload(token);
  const candidates = [
    payload?.userId,
    payload?._id,
    payload?.id,
    payload?.sub,
  ];
  for (const value of candidates) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function getResolvedOfficialAuth() {
  const stored = getStoredOfficialAuth();
  const envBearer = normalizeBearerToken(
    process.env.OFFICIAL_BEARER_TOKEN || OFFICIAL_BEARER_TOKEN
  );
  const envUserId = String(
    process.env.OFFICIAL_USER_ID || OFFICIAL_USER_ID || ''
  ).trim();
  const bearerToken = envBearer || stored.bearerToken;
  const inferredUserId = inferUserIdFromToken(bearerToken);
  const userId = envUserId || stored.userId || inferredUserId;
  return {
    bearerToken,
    userId,
    source: envBearer ? 'env' : stored.bearerToken ? 'file' : 'none',
    userIdSource: envUserId
      ? 'env'
      : stored.userId
        ? 'file'
        : inferredUserId
          ? 'token'
          : 'none',
  };
}

function getOfficialRequestHeaders() {
  const auth = getResolvedOfficialAuth();
  const token = normalizeBearerToken(auth.bearerToken);
  return {
    Accept: 'application/json, text/plain, */*',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    Origin: 'https://official.me',
    Referer: 'https://official.me/',
    'User-Agent': 'Mozilla/5.0',
    'x-off-country-code': 'IN',
    ...(auth.userId ? { userId: auth.userId } : {}),
  };
}

function fetchOfficialJson(pathname, options = {}) {
  const method = options.method || 'GET';
  const extraHeaders = options.headers || {};
  const bodyPayload = options.body;
  const bodyText =
    bodyPayload == null
      ? ''
      : typeof bodyPayload === 'string'
        ? bodyPayload
        : JSON.stringify(bodyPayload);
  const headers = {
    ...getOfficialRequestHeaders(),
    ...extraHeaders,
    ...(bodyText ? { 'Content-Length': Buffer.byteLength(bodyText) } : {}),
  };
  return new Promise((resolve) => {
    const upstream = https.request(
      {
        protocol: 'https:',
        hostname: OFFICIAL_API_HOST,
        path: pathname,
        method,
        headers,
      },
      (upstreamRes) => {
        let buffer = '';
        upstreamRes.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
        });
        upstreamRes.on('end', () => {
          try {
            resolve({
              ok: upstreamRes.statusCode === 200,
              statusCode: upstreamRes.statusCode,
              data: JSON.parse(buffer || '{}'),
            });
          } catch (error) {
            resolve({
              ok: false,
              statusCode: upstreamRes.statusCode,
              error: `parse-error: ${error.message}`,
              data: null,
            });
          }
        });
      }
    );

    upstream.on('error', (error) => {
      resolve({
        ok: false,
        statusCode: 0,
        error: error.message,
        data: null,
      });
    });

    if (bodyText) {
      upstream.write(bodyText);
    }
    upstream.end();
  });
}

function getPostsArrayFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.posts)) return payload.posts;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.message)) return payload.message;
  return [];
}

function getTotalCountFromPayload(payload) {
  const candidates = [
    payload?.count,
    payload?.total,
    payload?.data?.count,
    payload?.data?.total,
    payload?.result?.count,
    payload?.result?.total,
  ];
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function getUpstreamErrorReason(response, pageLabel) {
  const message =
    response.data?.message ||
    response.data?.errors?.message ||
    response.error ||
    `Upstream error on ${pageLabel}`;
  return `${message} (status ${response.statusCode || 0})`;
}

async function syncPostsForCreator({ influencerId, username, forceRefresh = false }) {
  const postsPath = path.join(CREATORS_DIR, influencerId, 'posts.json');
  const localPosts = readJson(postsPath, []);
  const localCount = Array.isArray(localPosts) ? localPosts.length : 0;

  debugLog('syncPostsForCreator:start', {
    influencerId,
    username,
    localCount,
    forceRefresh,
  });

  if (localCount > 0 && !forceRefresh) {
    debugLog('syncPostsForCreator:using-existing-local-posts', {
      influencerId,
      localCount,
      postsPath,
    });
    return { ok: true, source: 'local-cache', postCount: localCount };
  }

  const auth = getResolvedOfficialAuth();
  debugLog('syncPostsForCreator:auth-source', {
    influencerId,
    authSource: auth.source,
    hasBearerToken: Boolean(auth.bearerToken),
    hasUserId: Boolean(auth.userId),
    userIdSource: auth.userIdSource,
  });

  const dedupeAndWritePosts = (allPosts, source, expectedCount = null) => {
    const dedupedById = new Map();
    for (const post of allPosts) {
      if (post && post._id) {
        dedupedById.set(post._id, post);
      } else {
        dedupedById.set(`noid-${dedupedById.size + 1}`, post);
      }
    }
    const finalPosts = Array.from(dedupedById.values());
    if (finalPosts.length === 0) {
      return {
        ok: false,
        source: 'empty-upstream',
        postCount: 0,
        reason: 'Upstream sync returned 0 posts.',
      };
    }
    ensureDir(postsPath);
    fs.writeFileSync(postsPath, JSON.stringify(finalPosts, null, 2), 'utf8');
    debugLog('syncPostsForCreator:completed', {
      influencerId,
      source,
      writtenCount: finalPosts.length,
      postsPath,
    });
    return {
      ok: true,
      source,
      postCount: finalPosts.length,
      expectedCount,
    };
  };

  const errors = [];

  if (auth.userId) {
    const userPosts = [];
    for (let page = 0; page < MAX_SYNC_PAGES; page += 1) {
      const skip = page * OFFICIAL_USER_POSTS_PAGE_SIZE;
      const body = {
        isLogin: 'false',
        influencerId,
        userId: auth.userId,
        skip,
        limit: OFFICIAL_USER_POSTS_PAGE_SIZE,
        key: OFFICIAL_USER_POSTS_KEY,
      };
      const response = await fetchOfficialJson('/posts/getUserPost', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'accept-language': 'en-IN',
        },
        body,
      });
      const pagePosts = getPostsArrayFromPayload(response.data);
      debugLog('syncPostsForCreator:getUserPost-page', {
        influencerId,
        page: page + 1,
        skip,
        statusCode: response.statusCode,
        pageCount: pagePosts.length,
      });

      if (!response.ok) {
        const reason = getUpstreamErrorReason(
          response,
          `getUserPost page ${page + 1}`
        );
        errors.push(reason);
        debugLog('syncPostsForCreator:getUserPost-failed', {
          influencerId,
          reason,
        });
        break;
      }

      if (pagePosts.length === 0) {
        break;
      }

      userPosts.push(...pagePosts);
      if (pagePosts.length < OFFICIAL_USER_POSTS_PAGE_SIZE) {
        break;
      }
    }

    if (userPosts.length > 0) {
      return dedupeAndWritePosts(userPosts, 'upstream-user-post');
    }
  } else {
    debugLog('syncPostsForCreator:getUserPost-skipped', {
      influencerId,
      reason: 'missing-userId',
    });
  }

  if (!auth.bearerToken) {
    const reason =
      errors[0] ||
      'No local posts found. Save userId or OFFICIAL_BEARER_TOKEN via /api/official/auth.';
    debugLog('syncPostsForCreator:missing-auth', {
      influencerId,
      username,
      reason,
    });
    return {
      ok: false,
      source: 'not-synced',
      postCount: 0,
      reason,
    };
  }

  const countPath = `/posts/getAllPostCount/${encodeURIComponent(influencerId)}`;
  const countResponse = await fetchOfficialJson(countPath);
  const expectedCount = getTotalCountFromPayload(countResponse.data);
  debugLog('syncPostsForCreator:count-response', {
    influencerId,
    statusCode: countResponse.statusCode,
    expectedCount,
  });

  const maxPagesFromCount =
    typeof expectedCount === 'number' && expectedCount >= 0
      ? Math.ceil(expectedCount / OFFICIAL_POSTS_PAGE_SIZE)
      : MAX_SYNC_PAGES;
  const maxPages = Math.max(1, Math.min(maxPagesFromCount, MAX_SYNC_PAGES));

  const allPosts = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const pagePath = `/posts/getAllPost/${encodeURIComponent(influencerId)}/${page}/${OFFICIAL_POSTS_PAGE_SIZE}`;
    const pageResponse = await fetchOfficialJson(pagePath);
    const pagePosts = getPostsArrayFromPayload(pageResponse.data);
    debugLog('syncPostsForCreator:page', {
      influencerId,
      page,
      statusCode: pageResponse.statusCode,
      pageCount: pagePosts.length,
    });

    if (!pageResponse.ok) {
      const reason = getUpstreamErrorReason(pageResponse, `page ${page}`);
      errors.push(reason);
      return {
        ok: false,
        source: 'upstream-error',
        postCount: allPosts.length,
        reason,
      };
    }

    if (pagePosts.length === 0) {
      break;
    }
    allPosts.push(...pagePosts);
  }

  return dedupeAndWritePosts(allPosts, 'upstream', expectedCount ?? null);
}

function probeMediaAccess(mediaTarget, cookieHeader) {
  return new Promise((resolve) => {
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

async function validateMediaAccess(creatorId) {
  const posts = getCreatorPosts(creatorId);
  debugLog('validateMediaAccess:start', {
    creatorId,
    localPostCount: posts.length,
  });
  const cookieHeader = extractCookieHeader(
    fs.existsSync(COOKIE_PATH) ? fs.readFileSync(COOKIE_PATH, 'utf8') : ''
  );

  if (!cookieHeader) {
    debugLog('validateMediaAccess:no-cookie');
    return {
      ok: false,
      reason: 'No creator cookie file saved on server.',
      localPostCount: posts.length,
    };
  }

  let mediaTarget = posts.map(getMediaUrl).find(Boolean);
  let validationSource = 'localPost';

  if (!mediaTarget) {
    const username = getConfiguredUsername();
    if (username) {
      const lookup = await fetchInfluencerByUsername(username);
      if (lookup.ok && lookup.profileImage) {
        mediaTarget = lookup.profileImage;
        validationSource = 'profileImageFallback';
        debugLog('validateMediaAccess:fallback-profile-image', {
          creatorId,
          username,
          profileImage: lookup.profileImage,
        });
      } else {
        debugLog('validateMediaAccess:no-local-media-and-no-fallback', {
          creatorId,
          username,
        });
        return {
          ok: false,
          reason:
            'No local playable media found. Creator exists, but local archive has 0 posts.',
          localPostCount: posts.length,
        };
      }
    } else {
      return {
        ok: false,
        reason: 'No playable media found for this creator.',
        localPostCount: posts.length,
      };
    }
  }

  const result = await probeMediaAccess(mediaTarget, cookieHeader);
  debugLog('validateMediaAccess:probe-result', {
    creatorId,
    validationSource,
    statusCode: result.statusCode,
    ok: result.ok,
  });
  if (
    result.ok &&
    validationSource === 'profileImageFallback' &&
    posts.length === 0
  ) {
    return {
      ...result,
      validationSource,
      localPostCount: 0,
      note: 'Cookie works, but local archive has 0 posts for this creator.',
    };
  }

  return {
    ...result,
    validationSource,
    localPostCount: posts.length,
  };
}

function fetchInfluencerByUsername(username) {
  return new Promise((resolve) => {
    const cleanUsername = String(username || '')
      .trim()
      .replace(/^@+/, '');

    if (!cleanUsername) {
      debugLog('fetchInfluencerByUsername:missing-username');
      resolve({ ok: false, reason: 'username is required.' });
      return;
    }

    const requestPath = `/influencer/${encodeURIComponent(cleanUsername)}`;
    const upstream = https.request(
      {
        protocol: 'https:',
        hostname: OFFICIAL_API_HOST,
        path: requestPath,
        method: 'GET',
        headers: {
          Accept: 'application/json, text/plain, */*',
          Origin: 'https://official.me',
          Referer: 'https://official.me/',
          'User-Agent': 'Mozilla/5.0',
          'x-off-country-code': 'IN',
        },
      },
      (upstreamRes) => {
        let buffer = '';
        upstreamRes.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
        });
        upstreamRes.on('end', () => {
          try {
            const parsed = JSON.parse(buffer || '{}');
            const influencerId = parsed?.data?._id || '';
            if (
              upstreamRes.statusCode === 200 &&
              parsed?.status === true &&
              influencerId
            ) {
              debugLog('fetchInfluencerByUsername:success', {
                cleanUsername,
                influencerId,
              });
              resolve({
                ok: true,
                influencerId,
                username: parsed?.data?.username || cleanUsername,
                name: parsed?.data?.name || '',
                profileImage: parsed?.data?.userProfileImage || '',
              });
              return;
            }

            resolve({
              ok: false,
              reason:
                parsed?.message ||
                `Influencer lookup failed with status ${upstreamRes.statusCode}.`,
            });
          } catch (error) {
            debugLog('fetchInfluencerByUsername:parse-error', error.message);
            resolve({ ok: false, reason: `Lookup parse error: ${error.message}` });
          }
        });
      }
    );

    upstream.on('error', (error) => {
      debugLog('fetchInfluencerByUsername:request-error', error.message);
      resolve({ ok: false, reason: `Lookup request failed: ${error.message}` });
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
    const current = readJson(CONFIG_PATH, {});
    debugLog('GET /api/creator/config', {
      username: current.username || '',
      influencerId: current.influencerId || '',
    });
    sendJson(res, 200, {
      displayName: current.displayName || 'Creator Gallery',
      username: current.username || '',
      influencerId: current.influencerId || '',
    });
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/official/auth') {
    const auth = getResolvedOfficialAuth();
    sendJson(res, 200, {
      ok: true,
      hasBearerToken: Boolean(auth.bearerToken),
      hasUserId: Boolean(auth.userId),
      source: auth.source,
      userIdSource: auth.userIdSource,
    });
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/official/auth') {
    const raw = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(raw || '{}');
    } catch (error) {
      sendJson(res, 400, { ok: false, message: 'Invalid JSON body.' });
      return;
    }

    const bearerToken = normalizeBearerToken(
      payload.bearerToken ||
        payload.token ||
        payload.accessToken ||
        payload.authorization
    );
    const providedUserId = String(
      payload.userId || payload.userid || payload.userID || ''
    ).trim();
    const inferredUserId = inferUserIdFromToken(bearerToken);
    const userId = providedUserId || inferredUserId;

    if (!bearerToken && !userId) {
      sendJson(res, 400, {
        ok: false,
        message: 'Either bearerToken or userId is required.',
      });
      return;
    }

    const next = { bearerToken, userId };
    ensureDir(OFFICIAL_AUTH_PATH);
    fs.writeFileSync(OFFICIAL_AUTH_PATH, JSON.stringify(next, null, 2), 'utf8');
    debugLog('POST /api/official/auth:saved', {
      hasUserId: Boolean(userId),
      tokenLength: bearerToken.length,
      userIdSource: providedUserId ? 'payload' : inferredUserId ? 'token' : 'none',
    });
    sendJson(res, 200, {
      ok: true,
      hasBearerToken: Boolean(bearerToken),
      hasUserId: Boolean(userId),
      source: 'file',
      userIdSource: providedUserId ? 'payload' : inferredUserId ? 'token' : 'none',
    });
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/creator/config') {
    const raw = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(raw || '{}');
    } catch (error) {
      sendJson(res, 400, { ok: false, message: 'Invalid JSON body.' });
      return;
    }

    const username = String(payload.username || '')
      .trim()
      .replace(/^@+/, '');
    let influencerId = String(payload.influencerId || '').trim();
    let resolvedName = '';

    if (username) {
      const lookup = await fetchInfluencerByUsername(username);
      if (!lookup.ok) {
        debugLog('POST /api/creator/config:lookup-failed', {
          username,
          reason: lookup.reason,
        });
        sendJson(res, 400, {
          ok: false,
          message: lookup.reason || 'Could not resolve username.',
        });
        return;
      }
      influencerId = lookup.influencerId;
      resolvedName = lookup.name;
    }

    if (!influencerId) {
      sendJson(res, 400, {
        ok: false,
        message: 'username is required to resolve influencerId.',
      });
      return;
    }

    const nextConfig = {
      displayName:
        String(payload.displayName || '').trim() ||
        resolvedName ||
        'Creator Gallery',
      username,
      influencerId,
    };

    const sync = await syncPostsForCreator({
      influencerId: nextConfig.influencerId,
      username: nextConfig.username,
      forceRefresh: Boolean(payload.forceSync),
    });

    ensureDir(CONFIG_PATH);
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(nextConfig, null, 2), 'utf8');
    debugLog('POST /api/creator/config:saved', {
      username: nextConfig.username,
      influencerId: nextConfig.influencerId,
      sync,
    });
    sendJson(res, 200, { ok: true, config: nextConfig, sync });
    return;
  }

  if (
    req.method === 'GET' &&
    requestUrl.pathname.startsWith('/api/creators/') &&
    requestUrl.pathname.endsWith('/posts')
  ) {
    const creatorId = requestUrl.pathname.split('/')[3];
    const posts = getCreatorPosts(creatorId);
    debugLog('GET /api/creators/:id/posts', {
      creatorId,
      postCount: posts.length,
    });
    sendJson(res, 200, { ok: true, posts });
    return;
  }

  if (
    req.method === 'POST' &&
    requestUrl.pathname.startsWith('/api/creators/') &&
    requestUrl.pathname.endsWith('/sync')
  ) {
    const creatorId = requestUrl.pathname.split('/')[3];
    const username = requestUrl.searchParams.get('username') || getConfiguredUsername();
    const forceRefresh = requestUrl.searchParams.get('force') !== '0';
    const sync = await syncPostsForCreator({
      influencerId: creatorId,
      username,
      forceRefresh,
    });
    debugLog('POST /api/creators/:id/sync', {
      creatorId,
      username,
      forceRefresh,
      sync,
    });
    sendJson(res, sync.ok ? 200 : 400, { ok: sync.ok, sync });
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

  if (req.method === 'GET' && requestUrl.pathname === '/api/cookies/existing') {
    const cookiesText = fs.existsSync(COOKIE_PATH)
      ? fs.readFileSync(COOKIE_PATH, 'utf8')
      : '';
    debugLog('GET /api/cookies/existing', {
      exists: Boolean(cookiesText.trim()),
      length: cookiesText.length,
    });
    sendJson(res, 200, {
      ok: true,
      exists: Boolean(cookiesText.trim()),
      cookiesText,
    });
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/cookies/status') {
    const creatorId =
      requestUrl.searchParams.get('creatorId') || getConfiguredCreatorId();
    if (!creatorId) {
      sendJson(res, 200, {
        ok: false,
        reason: 'No creatorId found. Save a username first.',
      });
      return;
    }
    const result = await validateMediaAccess(creatorId);
    debugLog('GET /api/cookies/status', {
      creatorId,
      ok: result.ok,
      validationSource: result.validationSource || 'none',
      localPostCount: result.localPostCount ?? null,
    });
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

    const upstreamHeaders = {
      Accept: req.headers.accept || '*/*',
      'Accept-Encoding': 'identity',
      Cookie: cookieHeader,
      Referer: 'https://official.me/',
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
    };
    if (req.headers.range) {
      upstreamHeaders.Range = req.headers.range;
    }

    const upstream = https.request(
      parsedUrl,
      {
        method: 'GET',
        agent: CDN_PROXY_AGENT,
        headers: upstreamHeaders,
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

    const closeUpstream = () => {
      if (!upstream.destroyed) {
        upstream.destroy();
      }
    };
    req.on('aborted', closeUpstream);
    req.on('close', closeUpstream);
    res.on('close', closeUpstream);

    upstream.on('error', (error) => {
      if (!res.headersSent) {
        sendText(res, 502, `Media proxy failed: ${error.message}`);
      }
    });

    upstream.end();
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/download') {
    const target = requestUrl.searchParams.get('url') || '';
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

    const extension = getExtensionFromUrl(target);
    const requestedFileName = requestUrl.searchParams.get('filename') || '';
    const defaultName = `download${extension || '.bin'}`;
    let downloadName = sanitizeFileName(requestedFileName, defaultName);
    if (extension && !downloadName.toLowerCase().endsWith(extension)) {
      downloadName = `${downloadName}${extension}`;
    }

    ensureDir(path.join(DOWNLOADS_DIR, 'placeholder.txt'));
    const tempName = `${Date.now()}-${crypto.randomUUID()}-${downloadName}`;
    const outputPath = path.join(DOWNLOADS_DIR, tempName);
    const preferFfmpeg = isLikelyVideoUrl(target);
    const downloadResult = await downloadMediaToFile({
      target,
      cookieHeader,
      outputPath,
      preferFfmpeg,
    });

    if (!downloadResult.ok) {
      sendText(res, 502, `Backend download failed: ${downloadResult.reason}`);
      return;
    }

    const stat = fs.statSync(outputPath);
    const responseMime = getMimeTypeFromExtension(extension);
    debugLog('GET /api/download:ready', {
      tool: downloadResult.tool,
      file: outputPath,
      size: stat.size,
      name: downloadName,
      preferFfmpeg,
    });

    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': responseMime,
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${downloadName}"`,
      'Cache-Control': 'no-store',
      'X-Download-Tool': downloadResult.tool,
    });

    const fileStream = fs.createReadStream(outputPath);
    const cleanup = () => safeUnlink(outputPath);
    fileStream.on('error', (error) => {
      if (!res.headersSent) {
        sendText(res, 500, `Could not read downloaded file: ${error.message}`);
      } else {
        res.destroy(error);
      }
      cleanup();
    });
    res.on('close', cleanup);
    res.on('finish', cleanup);
    fileStream.pipe(res);
    return;
  }

  sendJson(res, 404, { ok: false, message: 'Not found.' });
});

server.listen(PORT, HOST, () => {
  console.log(`Creator gallery API listening on http://${HOST}:${PORT}`);
});
