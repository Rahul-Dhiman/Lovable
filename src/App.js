import React, { useCallback, useEffect, useState } from 'react';

const LOCAL_STORAGE_KEY = 'creatorGalleryConfig';
const POSTS_PER_PAGE = 5;

function decodeContent(value) {
  if (!value) return 'Untitled post';
  try {
    const decoded = decodeURIComponent(value);
    const doc = new DOMParser().parseFromString(decoded, 'text/html');
    return (doc.body.textContent || 'Untitled post').trim();
  } catch (error) {
    return value;
  }
}

function formatDuration(totalSeconds) {
  if (!totalSeconds && totalSeconds !== 0) return '-';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = `${totalSeconds % 60}`.padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function getDurationValue(post) {
  const duration = Number(post?.duration);
  return Number.isFinite(duration) ? duration : -1;
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatPrice(value) {
  if (typeof value !== 'number') return '-';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
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

function isPrivateHostName(hostname) {
  if (!hostname) return false;
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return true;
  }
  if (/^10\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  return /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}

function getBestMediaUrl(post) {
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

function getBackendApiOrigin() {
  if (typeof window === 'undefined') return '';
  const configuredOrigin = String(process.env.REACT_APP_API_ORIGIN || '')
    .trim()
    .replace(/\/+$/, '');
  if (configuredOrigin) return configuredOrigin;

  const backendPort = String(process.env.REACT_APP_API_PORT || '3012').trim();
  const { protocol, hostname, port } = window.location;
  if (port === backendPort) return '';

  if (isPrivateHostName(hostname)) {
    return `${protocol}//${hostname}:${backendPort}`;
  }

  return '';
}

function toBackendApiUrl(apiPath) {
  const backendOrigin = getBackendApiOrigin();
  return backendOrigin ? `${backendOrigin}${apiPath}` : apiPath;
}

function getMediaTarget(mediaUrl) {
  if (!mediaUrl) return null;
  return toBackendApiUrl(`/api/media?url=${encodeURIComponent(mediaUrl)}`);
}

function sanitizeDownloadName(input) {
  const value = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return value || 'download';
}

function getExtensionFromMediaUrl(mediaUrl) {
  try {
    const parsed = new URL(mediaUrl);
    const match = parsed.pathname.match(/\.([a-z0-9]{2,5})$/i);
    return match ? `.${match[1].toLowerCase()}` : '';
  } catch (error) {
    return '';
  }
}

function getDownloadFileName(post, mediaUrl) {
  const ext = getExtensionFromMediaUrl(mediaUrl);
  const fallbackExt = post.type === 'Image' ? '.jpg' : '.mp4';
  const base =
    sanitizeDownloadName(post._id) ||
    sanitizeDownloadName(decodeContent(post.content)) ||
    'download';
  return `${base}${ext || fallbackExt}`;
}

function getDownloadTarget(post, mediaUrl) {
  if (!mediaUrl) return '#';
  const filename = getDownloadFileName(post, mediaUrl);
  return toBackendApiUrl(
    `/api/download?url=${encodeURIComponent(mediaUrl)}&filename=${encodeURIComponent(filename)}`
  );
}

export default function App() {
  const [config, setConfig] = useState({
    displayName: 'Creator First',
    username: '',
    influencerId: '',
  });
  const [authForm, setAuthForm] = useState({
    bearerToken: '',
    userId: '',
  });
  const [authMeta, setAuthMeta] = useState({
    hasBearerToken: false,
    hasUserId: false,
    source: 'none',
    userIdSource: 'none',
  });
  const [authStatus, setAuthStatus] = useState(null);
  const [cookieText, setCookieText] = useState('');
  const [cookieStatus, setCookieStatus] = useState(null);
  const [setupStatus, setSetupStatus] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [posts, setPosts] = useState([]);
  const [page, setPage] = useState(1);
  const [activeMediaPostId, setActiveMediaPostId] = useState('');
  const [status, setStatus] = useState('loading');
  const [view, setView] = useState('setup');

  const refreshAuthMeta = useCallback(async () => {
    const response = await fetch('/api/official/auth');
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) return;
    setAuthMeta({
      hasBearerToken: Boolean(data.hasBearerToken),
      hasUserId: Boolean(data.hasUserId),
      source: data.source || 'none',
      userIdSource: data.userIdSource || 'none',
    });
  }, []);

  const loadPosts = useCallback(async (creatorId) => {
    if (!creatorId) return;
    const response = await fetch(`/api/creators/${creatorId}/posts`);
    const data = await response.json().catch(() => ({}));
    setPosts(
      Array.isArray(data.posts)
        ? [...data.posts].sort((a, b) => getDurationValue(b) - getDurationValue(a))
        : []
    );
    setPage(1);
    setActiveMediaPostId('');
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setConfig((current) => ({ ...current, ...parsed }));
      } catch (error) {
        // ignore malformed local storage
      }
    }

    fetch('/api/creator/config')
      .then((response) => response.json())
      .then((data) => {
        if (data?.username || data?.influencerId) {
          setConfig((current) => ({ ...current, ...data }));
        }
      })
      .finally(() => {
        setStatus('ready');
      });

    refreshAuthMeta().catch(() => {
      // ignore auth status fetch failures during initial load
    });
  }, [refreshAuthMeta]);

  useEffect(() => {
    if (!config.influencerId) return;
    loadPosts(config.influencerId).catch(() => {
      setPosts([]);
      setPage(1);
    });
  }, [config.influencerId, loadPosts]);

  async function syncCreatorPosts(force = true) {
    if (!config.influencerId) {
      setSyncStatus({
        ok: false,
        message: 'Save a creator username first.',
      });
      return;
    }

    setSyncStatus({
      loading: true,
      message: 'Syncing posts from upstream...',
    });

    const syncResponse = await fetch(
      `/api/creators/${config.influencerId}/sync?username=${encodeURIComponent(
        config.username
      )}&force=${force ? '1' : '0'}`,
      {
        method: 'POST',
      }
    );
    const syncData = await syncResponse.json().catch(() => ({}));
    const sync = syncData?.sync || {};
    setSyncStatus({
      ok: Boolean(sync.ok),
      message: sync.ok
        ? `Synced ${sync.postCount || 0} posts (${sync.source || 'upstream'}).`
        : sync.reason || 'Sync failed.',
    });

    if (sync.ok) {
      await loadPosts(config.influencerId);
    }
  }

  async function saveOfficialAuth() {
    const bearerToken = authForm.bearerToken.trim();
    const userId = authForm.userId.trim();
    if (!bearerToken && !userId) {
      setAuthStatus({
        ok: false,
        message: 'Bearer token or user ID is required.',
      });
      return;
    }

    setAuthStatus({
      loading: true,
      message: 'Saving auth token...',
    });

    const response = await fetch('/api/official/auth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bearerToken, userId }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data?.ok) {
      setAuthStatus({
        ok: false,
        message: data?.message || 'Could not save auth token.',
      });
      return;
    }

    setAuthForm((current) => ({ ...current, bearerToken: '' }));
    setAuthStatus({
      ok: true,
      message: 'Auth saved. Running post sync...',
    });
    await refreshAuthMeta();
    await syncCreatorPosts(true);
  }

  async function saveConfig() {
    const username = config.username.trim().replace(/^@+/, '');
    console.log('[creator-debug] saveConfig:start', { username });
    if (!username) {
      setSetupStatus({
        ok: false,
        message: 'Username is required.',
      });
      return;
    }

    setSetupStatus({
      loading: true,
      message: 'Resolving username...',
    });

    const response = await fetch('/api/creator/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        displayName: config.displayName,
        username,
      }),
    });
    const data = await response.json().catch(() => ({}));
    console.log('[creator-debug] saveConfig:response', {
      ok: response.ok,
      apiOk: data?.ok,
      influencerId: data?.config?.influencerId,
      sync: data?.sync || null,
    });

    if (!response.ok || !data?.ok) {
      setSetupStatus({
        ok: false,
        message: data?.message || 'Could not resolve that username.',
      });
      return;
    }

    const nextConfig = data.config || { ...config, username };
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(nextConfig));
    setConfig((current) => ({ ...current, ...nextConfig }));
    const sync = data.sync || {};
    const syncOk = Boolean(sync.ok);
    setSetupStatus({
      ok: syncOk,
      message: syncOk
        ? `Connected to @${nextConfig.username}`
        : sync.reason ||
          `Connected to @${nextConfig.username}, but upstream sync failed.`,
    });
    setSyncStatus({
      ok: syncOk,
      message: syncOk
        ? `Synced ${sync.postCount || 0} posts (${sync.source || 'upstream'}).`
        : sync.reason || 'Sync failed.',
    });

    await refreshAuthMeta().catch(() => {});
    await loadPosts(nextConfig.influencerId).catch(() => {});
    setView(syncOk ? 'cookies' : 'setup');
  }

  async function saveCookies() {
    setCookieStatus({ loading: true });
    console.log('[creator-debug] saveCookies:start', {
      influencerId: config.influencerId,
      cookieChars: cookieText.length,
    });

    const saveResponse = await fetch('/api/cookies', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cookiesText: cookieText }),
    });

    if (!saveResponse.ok) {
      setCookieStatus({
        ok: false,
        message: 'Could not save cookies on server.',
      });
      return;
    }

    await verifyCookiesForCreator();
  }

  async function verifyCookiesForCreator() {
    const verifyResponse = await fetch(
      `/api/cookies/status?creatorId=${encodeURIComponent(config.influencerId)}`
    );
    const verifyData = await verifyResponse.json();
    console.log('[creator-debug] verifyCookiesForCreator:response', verifyData);

    const successMessage = verifyData.note
      ? `Cookie accepted. ${verifyData.note}`
      : 'Cookie accepted. Media validation passed.';

    setCookieStatus({
      ok: Boolean(verifyData.ok),
      message: verifyData.ok
        ? successMessage
        : verifyData.reason || 'Cookie validation failed.',
    });

    if (verifyData.ok) {
      setView('dashboard');
    }
  }

  async function useExistingCookies() {
    setCookieStatus({
      loading: true,
      message: 'Loading existing cookie.txt...',
    });

    const existingResponse = await fetch('/api/cookies/existing');
    const existingData = await existingResponse.json().catch(() => ({}));
    console.log('[creator-debug] useExistingCookies:response', {
      ok: existingResponse.ok,
      exists: existingData.exists,
      cookieChars: (existingData.cookiesText || '').length,
    });

    if (!existingResponse.ok || !existingData.exists) {
      setCookieStatus({
        ok: false,
        message: 'No existing cookie.txt found on server.',
      });
      return;
    }

    setCookieText(existingData.cookiesText || '');
    await verifyCookiesForCreator();
  }

  const videoCount = posts.filter((post) => post.type === 'Video').length;
  const totalPages = Math.max(1, Math.ceil(posts.length / POSTS_PER_PAGE));
  const visiblePosts = posts.slice(
    (page - 1) * POSTS_PER_PAGE,
    page * POSTS_PER_PAGE
  );
  const rangeStart = posts.length === 0 ? 0 : (page - 1) * POSTS_PER_PAGE + 1;

  useEffect(() => {
    if (!activeMediaPostId) return;
    const existsInCurrentPage = visiblePosts.some((post) => {
      const postId = String(
        post._id ||
          post.location ||
          post.postUrl ||
          post.key ||
          post.source ||
          `${post.type}-${post.created_at || post.date || 'unknown'}`
      );
      return postId === activeMediaPostId;
    });
    if (!existsInCurrentPage) {
      setActiveMediaPostId('');
    }
  }, [activeMediaPostId, visiblePosts]);

  return (
    <main className="app-shell">
      <div className="phone-shell">
        <header className="hero">
          <div className="eyebrow">Creator gallery</div>
          <h1>{config.displayName || 'Creator First'}</h1>
          <p>
            Mobile-first local archive app. It reads stored creator posts from
            the local backend and plays media through the backend proxy after
            cookie validation.
          </p>
        </header>

        <section className="stats">
          <article>
            <span>Total</span>
            <strong>{posts.length}</strong>
          </article>
          <article>
            <span>Videos</span>
            <strong>{videoCount}</strong>
          </article>
          <article>
            <span>Status</span>
            <strong>{cookieStatus?.ok ? 'Ready' : 'Locked'}</strong>
          </article>
        </section>

        {status === 'loading' ? (
          <section className="panel">Loading creator app...</section>
        ) : null}

        {view === 'setup' ? (
          <section className="panel">
            <h2>Creator setup</h2>
            <p className="panel-copy">
              Save creator metadata by username only. The backend resolves the
              creator ID automatically.
            </p>
            <label>
              <span>Display name</span>
              <input
                value={config.displayName}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    displayName: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              <span>Username</span>
              <input
                value={config.username}
                placeholder="bloody_top"
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    username: event.target.value,
                  }))
                }
              />
            </label>
            {config.influencerId ? (
              <p className="panel-copy">Resolved influencer ID: {config.influencerId}</p>
            ) : null}
            <button className="primary-button" onClick={saveConfig}>
              Continue to cookie check
            </button>
            <button
              className="secondary-button"
              onClick={() => syncCreatorPosts(true)}
              disabled={!config.influencerId}
            >
              Sync posts now
            </button>
            {setupStatus ? (
              <p className={setupStatus.ok ? 'status-ok' : 'status-error'}>
                {setupStatus.loading ? 'Resolving username...' : setupStatus.message}
              </p>
            ) : null}
            {syncStatus ? (
              <p className={syncStatus.ok ? 'status-ok' : 'status-error'}>
                {syncStatus.loading ? 'Syncing posts...' : syncStatus.message}
              </p>
            ) : null}

            <h2>Official auth</h2>
            <p className="panel-copy">
              Needed only when local posts are empty. Save viewer user ID (or Bearer token), then sync.
            </p>
            <p className="panel-copy">
              Current source: {authMeta.source}. Token:{' '}
              {authMeta.hasBearerToken ? 'present' : 'missing'}. User ID:{' '}
              {authMeta.hasUserId
                ? `present (${authMeta.userIdSource})`
                : `missing (${authMeta.userIdSource})`}
              .
            </p>
            <label>
              <span>Bearer token</span>
              <input
                value={authForm.bearerToken}
                placeholder="Bearer eyJ..."
                onChange={(event) =>
                  setAuthForm((current) => ({
                    ...current,
                    bearerToken: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              <span>User ID (optional)</span>
              <input
                value={authForm.userId}
                placeholder="Viewer userId (recommended)"
                onChange={(event) =>
                  setAuthForm((current) => ({
                    ...current,
                    userId: event.target.value,
                  }))
                }
              />
            </label>
            <button className="secondary-button" onClick={saveOfficialAuth}>
              Save auth and sync
            </button>
            {authStatus ? (
              <p className={authStatus.ok ? 'status-ok' : 'status-error'}>
                {authStatus.loading ? 'Saving auth...' : authStatus.message}
              </p>
            ) : null}
          </section>
        ) : null}

        {view === 'cookies' ? (
          <section className="panel">
            <h2>Cookie validation</h2>
            <p className="panel-copy">
              Paste `cookies.txt` or a raw cookie string. The backend saves it to
              `creatorCookies/cookie.txt`, validates one media request, and only then
              unlocks the dashboard. Or use the existing saved cookie file.
            </p>
            <textarea
              value={cookieText}
              onChange={(event) => setCookieText(event.target.value)}
              placeholder="Paste cookies.txt data here"
            />
            <button className="primary-button" onClick={saveCookies}>
              Validate cookies
            </button>
            <button className="secondary-button" onClick={useExistingCookies}>
              Use existing cookie.txt
            </button>
            {cookieStatus ? (
              <p className={cookieStatus.ok ? 'status-ok' : 'status-error'}>
                {cookieStatus.loading
                  ? 'Validating media access...'
                  : cookieStatus.message}
              </p>
            ) : null}
          </section>
        ) : null}

        {view === 'dashboard' ? (
          <section className="dashboard">
            <div className="dashboard-head">
              <h2>All posts</h2>
              <div className="dashboard-head-actions">
                <button
                  className="secondary-button"
                  onClick={() => syncCreatorPosts(true)}
                >
                  Sync latest
                </button>
                <button
                  className="secondary-button"
                  onClick={() => setView('cookies')}
                >
                  Update cookies
                </button>
              </div>
            </div>
            {syncStatus ? (
              <p className={syncStatus.ok ? 'status-ok' : 'status-error'}>
                {syncStatus.loading ? 'Syncing posts...' : syncStatus.message}
              </p>
            ) : null}

            <div className="pager-bar">
              <span>
                Page {page} of {totalPages}
              </span>
              <span>
                Showing {rangeStart}
                {' - '}
                {Math.min(page * POSTS_PER_PAGE, posts.length)} of {posts.length}
              </span>
            </div>
            <p className="panel-copy">
              Performance mode: media loads only when you tap `Load media`, one post at a time.
            </p>

            {visiblePosts.map((post) => {
              const bestMediaUrl = getBestMediaUrl(post);
              const mediaTarget = getMediaTarget(bestMediaUrl);
              const downloadTarget = getDownloadTarget(post, bestMediaUrl);
              const postId = String(
                post._id ||
                  post.location ||
                  post.postUrl ||
                  post.key ||
                  post.source ||
                  `${post.type}-${post.created_at || post.date || 'unknown'}`
              );
              const isMediaActive = activeMediaPostId === postId;
              return (
                <article key={postId} className="post-card">
                  <div className="post-meta">
                    <span className="pill">{post.type}</span>
                    <span>{formatPrice(post.price)}</span>
                  </div>
                  <h3>{decodeContent(post.content)}</h3>

                  {mediaTarget && isMediaActive && post.type === 'Video' ? (
                    <>
                      <video
                        className="media-frame"
                        src={mediaTarget}
                        controls
                        preload="none"
                        playsInline
                      />
                      <button
                        className="secondary-button media-control-button"
                        onClick={() => setActiveMediaPostId('')}
                      >
                        Stop media
                      </button>
                    </>
                  ) : null}

                  {mediaTarget && isMediaActive && post.type === 'Image' ? (
                    <>
                      <img
                        className="media-frame"
                        src={mediaTarget}
                        alt={decodeContent(post.content)}
                        loading="eager"
                        decoding="async"
                      />
                      <button
                        className="secondary-button media-control-button"
                        onClick={() => setActiveMediaPostId('')}
                      >
                        Unload media
                      </button>
                    </>
                  ) : null}

                  {mediaTarget && !isMediaActive ? (
                    <div className="media-placeholder">
                      <p>
                        Media paused to avoid parallel loading.
                      </p>
                      <button
                        className="secondary-button media-control-button"
                        onClick={() => setActiveMediaPostId(postId)}
                      >
                        Load media
                      </button>
                    </div>
                  ) : null}

                  {!mediaTarget ? (
                    <div className="media-placeholder">
                      <p>No media URL available for this post.</p>
                    </div>
                  ) : null}

                  <div className="post-grid">
                    <div>
                      <span>Duration</span>
                      <strong>{formatDuration(post.duration)}</strong>
                    </div>
                    <div>
                      <span>Created</span>
                      <strong>{formatDate(post.created_at || post.date)}</strong>
                    </div>
                  </div>

                  <a
                    className="download-link"
                    href={downloadTarget}
                    download
                    target="_blank"
                    rel="noreferrer"
                    aria-disabled={downloadTarget === '#'}
                    onClick={(event) => {
                      if (downloadTarget === '#') {
                        event.preventDefault();
                      }
                    }}
                  >
                    Download HQ
                  </a>
                </article>
              );
            })}

            {totalPages > 1 ? (
              <div className="pagination">
                <button
                  className="secondary-button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page === 1}
                >
                  Previous
                </button>
                <button
                  className="secondary-button"
                  onClick={() =>
                    setPage((current) => Math.min(totalPages, current + 1))
                  }
                  disabled={page === totalPages}
                >
                  Next
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}
