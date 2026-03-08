import React, { useEffect, useState } from 'react';

const LOCAL_STORAGE_KEY = 'creatorGalleryConfig';
const POSTS_PER_PAGE = 50;

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

function getMediaTarget(post) {
  const candidates = [
    post.location,
    post.postUrl,
    post.cf_preview,
    post.cf_thumbnail,
    post.thumbnailLocation,
    post.key,
    post.source,
  ].filter(Boolean);

  const path = candidates[0];
  if (!path) return null;
  const target = /^https?:\/\//i.test(path)
    ? path
    : `https://cdn.official.me/${path.replace(/^\/+/, '')}`;
  return `/api/media?url=${encodeURIComponent(target)}`;
}

export default function App() {
  const [config, setConfig] = useState({
    displayName: 'Creator First',
    influencerId: '616c9b089c57e60021521b21',
    userId: '662234554628d00021b0acab',
  });
  const [cookieText, setCookieText] = useState('');
  const [cookieStatus, setCookieStatus] = useState(null);
  const [posts, setPosts] = useState([]);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('loading');
  const [view, setView] = useState('setup');

  useEffect(() => {
    const saved = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      try {
        setConfig(JSON.parse(saved));
      } catch (error) {
        // ignore malformed local storage
      }
    }

    fetch('/api/creator/config')
      .then((response) => response.json())
      .then((data) => {
        if (data?.influencerId) {
          setConfig(data);
        }
      })
      .finally(() => {
        setStatus('ready');
      });
  }, []);

  useEffect(() => {
    if (!config.influencerId) return;
    fetch(`/api/creators/${config.influencerId}/posts`)
      .then((response) => response.json())
      .then((data) => {
        setPosts(Array.isArray(data.posts) ? data.posts : []);
        setPage(1);
      });
  }, [config.influencerId]);

  async function saveConfig() {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(config));
    await fetch('/api/creator/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    });
    setView('cookies');
  }

  async function saveCookies() {
    setCookieStatus({ loading: true });

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

    const verifyResponse = await fetch(
      `/api/cookies/status?creatorId=${encodeURIComponent(config.influencerId)}`
    );
    const verifyData = await verifyResponse.json();

    setCookieStatus({
      ok: Boolean(verifyData.ok),
      message: verifyData.ok
        ? 'Cookie accepted. Media validation passed.'
        : verifyData.reason || 'Cookie validation failed.',
    });

    if (verifyData.ok) {
      setView('dashboard');
    }
  }

  const videoCount = posts.filter((post) => post.type === 'Video').length;
  const totalPages = Math.max(1, Math.ceil(posts.length / POSTS_PER_PAGE));
  const visiblePosts = posts.slice(
    (page - 1) * POSTS_PER_PAGE,
    page * POSTS_PER_PAGE
  );

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
              Save creator metadata locally and on the local backend. The app
              does not store bearer tokens or auth keys.
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
              <span>Influencer ID</span>
              <input
                value={config.influencerId}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    influencerId: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              <span>User ID</span>
              <input
                value={config.userId}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    userId: event.target.value,
                  }))
                }
              />
            </label>
            <button className="primary-button" onClick={saveConfig}>
              Continue to cookie check
            </button>
          </section>
        ) : null}

        {view === 'cookies' ? (
          <section className="panel">
            <h2>Cookie validation</h2>
            <p className="panel-copy">
              Paste `cookies.txt` or a raw cookie string. The backend saves it to
              `creatorCookies/cookie.txt`, validates one media request, and only
              then unlocks the dashboard.
            </p>
            <textarea
              value={cookieText}
              onChange={(event) => setCookieText(event.target.value)}
              placeholder="Paste cookies.txt data here"
            />
            <button className="primary-button" onClick={saveCookies}>
              Validate cookies
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
              <button
                className="secondary-button"
                onClick={() => setView('cookies')}
              >
                Update cookies
              </button>
            </div>

            <div className="pager-bar">
              <span>
                Page {page} of {totalPages}
              </span>
              <span>
                Showing {(page - 1) * POSTS_PER_PAGE + 1}
                {' - '}
                {Math.min(page * POSTS_PER_PAGE, posts.length)} of {posts.length}
              </span>
            </div>

            {visiblePosts.map((post) => {
              const mediaTarget = getMediaTarget(post);
              return (
                <article key={post._id} className="post-card">
                  <div className="post-meta">
                    <span className="pill">{post.type}</span>
                    <span>{formatPrice(post.price)}</span>
                  </div>
                  <h3>{decodeContent(post.content)}</h3>

                  {post.type === 'Video' ? (
                    <video
                      className="media-frame"
                      src={mediaTarget || undefined}
                      controls
                      preload="metadata"
                      playsInline
                    />
                  ) : null}

                  {post.type === 'Image' ? (
                    <img
                      className="media-frame"
                      src={mediaTarget || undefined}
                      alt={decodeContent(post.content)}
                    />
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
                    href={mediaTarget || '#'}
                    download
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download
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
