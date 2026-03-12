(() => {
  if (window.__resourceFetcherAppLoaded) {
    return;
  }
  window.__resourceFetcherAppLoaded = true;

  const FETCH_CONCURRENCY = 6;
  const FETCH_TIMEOUT_MS = 8000;
  const COMMON_SECOND_LEVEL_PUBLIC_SUFFIXES = new Set([
    "ac",
    "co",
    "com",
    "edu",
    "gov",
    "ltd",
    "me",
    "mil",
    "net",
    "nhs",
    "nic",
    "nom",
    "org",
    "plc",
    "police",
    "sch",
  ]);
  const SEVERITY_ORDER = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };
  const queryParams = new URLSearchParams(window.location.search);
  const extensionRuntime =
    typeof chrome !== "undefined" &&
    Boolean(chrome.runtime?.id && chrome.storage?.session && chrome.scripting);
  const extensionDashboardMode =
    extensionRuntime &&
    (queryParams.get("extension") === "1" ||
      window.location.protocol === "chrome-extension:");
  const autoStartRequested = queryParams.get("autostart") === "1";

  const SECRET_PATTERNS = [
    {
      name: "AWS Access Key",
      regex: /AKIA[0-9A-Z]{16}/g,
      severity: "critical",
    },
    {
      name: "AWS Secret Key",
      regex:
        /(?:aws_secret|AWS_SECRET)[^\S\r\n]*[=:][^\S\r\n]*['"]?([A-Za-z0-9\/+=]{40})['"]?/gi,
      severity: "critical",
      valueIndex: 1,
    },
    {
      name: "Firebase API Key",
      regex: /AIza[0-9A-Za-z\-_]{35}/g,
      severity: "high",
    },
    {
      name: "JWT Token",
      regex: /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/=]*/g,
      severity: "high",
    },
    {
      name: "Bearer Token",
      regex: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
      severity: "high",
    },
    {
      name: "Private Key",
      regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,
      severity: "critical",
    },
    {
      name: "GitHub Token",
      regex: /gh[pousr]_[A-Za-z0-9_]{36,255}/g,
      severity: "high",
    },
    {
      name: "Stripe Key",
      regex: /(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{24,}/g,
      severity: "critical",
    },
    {
      name: "SendGrid Key",
      regex: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g,
      severity: "high",
    },
    {
      name: "Slack Token",
      regex: /xox[baprs]-[0-9A-Za-z-]{10,48}/g,
      severity: "high",
    },
    {
      name: "API Key Generic",
      regex:
        /(?:api[_-]?key|apikey|api_secret)[^\S\r\n]*[=:][^\S\r\n]*['"]?([A-Za-z0-9_-]{16,})['"]?/gi,
      severity: "medium",
      valueIndex: 1,
    },
    {
      name: "Client Secret",
      regex:
        /(?:client_secret|clientSecret|client[_-]?secret)[^\S\r\n]*[=:][^\S\r\n]*['"]?([A-Za-z0-9_.-]{10,})['"]?/gi,
      severity: "high",
      valueIndex: 1,
    },
    {
      name: "Password",
      regex:
        /(?:password|passwd|pwd)[^\S\r\n]*[=:][^\S\r\n]*['"]([^'"]{6,})['"]/gi,
      severity: "high",
      valueIndex: 1,
    },
    {
      name: "MongoDB URI",
      regex: /mongodb(?:\+srv)?:\/\/[^\s"'`]+/gi,
      severity: "critical",
    },
    {
      name: "MySQL URI",
      regex: /mysql:\/\/[^\s"'`]+/gi,
      severity: "critical",
    },
    {
      name: "Postgres URI",
      regex: /postgres(?:ql)?:\/\/[^\s"'`]+/gi,
      severity: "critical",
    },
    {
      name: "Twilio SID",
      regex: /AC[a-f0-9]{32}/gi,
      severity: "medium",
    },
    {
      name: "Telegram Bot Token",
      regex: /[0-9]{8,10}:[A-Za-z0-9_-]{35}/g,
      severity: "high",
    },
  ];

  const ENDPOINT_PATTERNS = [
    { regex: /fetch\s*\(\s*['"`]([^'"`,)]+)/g, method: "GET", valueIndex: 1 },
    {
      regex: /axios\.get\s*\(\s*['"`]([^'"`,)]+)/g,
      method: "GET",
      valueIndex: 1,
    },
    {
      regex: /axios\.post\s*\(\s*['"`]([^'"`,)]+)/g,
      method: "POST",
      valueIndex: 1,
    },
    {
      regex: /axios\.put\s*\(\s*['"`]([^'"`,)]+)/g,
      method: "PUT",
      valueIndex: 1,
    },
    {
      regex: /axios\.delete\s*\(\s*['"`]([^'"`,)]+)/g,
      method: "DELETE",
      valueIndex: 1,
    },
    {
      regex:
        /\.open\s*\(\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]\s*,\s*['"`]([^'"`,)]+)/g,
      methodFromMatch: 1,
      valueIndex: 2,
    },
    {
      regex: /['"`](\/api\/[^\s'"`,)]+)/g,
      method: "UNKNOWN",
      valueIndex: 1,
    },
    {
      regex: /['"`](\/v[0-9]+\/[^\s'"`,)]+)/g,
      method: "UNKNOWN",
      valueIndex: 1,
    },
    {
      regex: /['"`](\/graphql[^\s'"`,)]*)/g,
      method: "UNKNOWN",
      valueIndex: 1,
    },
    {
      regex: /['"`](\/auth\/[^\s'"`,)]+)/g,
      method: "UNKNOWN",
      valueIndex: 1,
    },
    {
      regex: /['"`](\/login[^\s'"`,)]*)/g,
      method: "UNKNOWN",
      valueIndex: 1,
    },
    {
      regex: /['"`](\/logout[^\s'"`,)]*)/g,
      method: "UNKNOWN",
      valueIndex: 1,
    },
    {
      regex: /['"`](\/register[^\s'"`,)]*)/g,
      method: "UNKNOWN",
      valueIndex: 1,
    },
    {
      regex: /['"`](\/oauth[^\s'"`,)]*)/g,
      method: "UNKNOWN",
      valueIndex: 1,
    },
    {
      regex: /['"`](\/token[^\s'"`,)]*)/g,
      method: "UNKNOWN",
      valueIndex: 1,
    },
    {
      regex: /['"`](\/upload[^\s'"`,)]*)/g,
      method: "UNKNOWN",
      valueIndex: 1,
    },
    {
      regex: /['"`](\/webhook[^\s'"`,)]*)/g,
      method: "UNKNOWN",
      valueIndex: 1,
    },
  ];

  const NETWORK_PATTERNS = [
    { type: "fetch", regex: /fetch\s*\(\s*['"`]([^'"`,)]+)/g, urlIndex: 1 },
    {
      type: "axios.get",
      regex: /axios\.get\s*\(\s*['"`]([^'"`,)]+)/g,
      urlIndex: 1,
      method: "GET",
    },
    {
      type: "axios.post",
      regex: /axios\.post\s*\(\s*['"`]([^'"`,)]+)/g,
      urlIndex: 1,
      method: "POST",
    },
    {
      type: "axios.put",
      regex: /axios\.put\s*\(\s*['"`]([^'"`,)]+)/g,
      urlIndex: 1,
      method: "PUT",
    },
    {
      type: "axios.delete",
      regex: /axios\.delete\s*\(\s*['"`]([^'"`,)]+)/g,
      urlIndex: 1,
      method: "DELETE",
    },
    {
      type: "XMLHttpRequest",
      regex:
        /\.open\s*\(\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]\s*,\s*['"`]([^'"`,)]+)/g,
      methodIndex: 1,
      urlIndex: 2,
    },
    {
      type: "navigator.sendBeacon",
      regex: /navigator\.sendBeacon\s*\(\s*['"`]([^'"`,)]+)/g,
      urlIndex: 1,
      method: "POST",
    },
    {
      type: "EventSource",
      regex: /new\s+EventSource\s*\(\s*['"`]([^'"`,)]+)/g,
      urlIndex: 1,
      method: "GET",
    },
    {
      type: "WebSocket",
      regex: /new\s+WebSocket\s*\(\s*['"`]([^'"`,)]+)/g,
      urlIndex: 1,
    },
  ];

  const CORS_PATTERNS = [
    {
      label: "Wildcard CORS",
      regex: /Access-Control-Allow-Origin\s*[:=]\s*['"]?\*/gi,
      severity: "high",
    },
    {
      label: "withCredentials",
      regex: /withCredentials\s*[:=]\s*true/gi,
      severity: "high",
    },
    {
      label: "credentials: include",
      regex: /credentials\s*:\s*['"]include['"]/gi,
      severity: "medium",
    },
    {
      label: "mode: cors",
      regex: /mode\s*:\s*['"]cors['"]/gi,
      severity: "low",
    },
    {
      label: "Access-Control-Allow-Credentials",
      regex: /Access-Control-Allow-Credentials/gi,
      severity: "medium",
    },
  ];

  const state = createInitialState();

  function createInitialState() {
    return {
      scripts: [],
      secrets: [],
      endpoints: [],
      networkCalls: [],
      subdomains: [],
      websockets: [],
      cors: [],
      domains: {},
      graphData: { nodes: [], links: [] },
      allCode: "",
      totalBytes: 0,
      scanComplete: false,
      isScanning: false,
      currentViewerCode: "",
      currentViewerIndex: null,
      graphLayout: "force",
      activeSection: "overview",
      scriptDomainFilter: "all",
      targetLabel: "",
      targetPageUrl: "",
      targetHost: "",
      extensionTarget: null,
    };
  }

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHTML(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function encodeCopyPayload(value) {
    return encodeURIComponent(String(value));
  }

  function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return "0 B";
    }
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function getByteSize(text) {
    return new Blob([text || ""]).size;
  }

  function normalizeMethod(value) {
    const method = String(value || "UNKNOWN").toUpperCase();
    return ["GET", "POST", "PUT", "DELETE", "PATCH"].includes(method)
      ? method
      : "UNKNOWN";
  }

  function getTargetLabel() {
    if (state.targetLabel) {
      return state.targetLabel;
    }
    const host = window.location.hostname;
    if (host) {
      return host;
    }
    const parts = window.location.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || "local-file";
  }

  function toAbsoluteUrl(value) {
    try {
      return new URL(value, window.location.href).href;
    } catch {
      return value || "";
    }
  }

  function getDomain(value) {
    try {
      const parsed = new URL(value, window.location.href);
      return parsed.hostname || (parsed.protocol === "file:" ? "local-file" : "inline");
    } catch {
      return "inline";
    }
  }

  function getBaseDomain(hostname) {
    if (!hostname) {
      return "";
    }
    const normalizedHost = String(hostname).toLowerCase();
    if (
      /^\d{1,3}(\.\d{1,3}){3}$/.test(normalizedHost) ||
      normalizedHost === "localhost"
    ) {
      return normalizedHost;
    }
    const parts = normalizedHost.split(".").filter(Boolean);
    if (parts.length < 2) {
      return normalizedHost;
    }
    const publicSuffixCandidate = parts.slice(-2, -1)[0];
    const topLevelDomain = parts[parts.length - 1];
    if (
      parts.length >= 3 &&
      topLevelDomain.length === 2 &&
      COMMON_SECOND_LEVEL_PUBLIC_SUFFIXES.has(publicSuffixCandidate)
    ) {
      return parts.slice(-3).join(".");
    }
    return parts.slice(-2).join(".");
  }

  function shortSourceName(source, fallbackIndex) {
    if (!source) {
      return `inline-${fallbackIndex}`;
    }
    try {
      const parsed = new URL(source, window.location.href);
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      return pathParts[pathParts.length - 1] || parsed.hostname || source;
    } catch {
      return source;
    }
  }

  function sanitizeFilename(name, fallback) {
    const base = String(name || fallback || "script.js")
      .split("?")[0]
      .split("#")[0]
      .trim();
    return (base || fallback || "script.js").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-");
  }

  function getScriptDisplayName(script) {
    return script.src
      ? shortSourceName(script.src, script.index)
      : `Inline Script #${script.index}`;
  }

  function getUnavailableScriptMessage(script) {
    const details = script.errorMessage || "Resource could not be fetched.";
    return [
      "// Unable to fetch resource content.",
      `// ${details}`,
      script.src ? `// Source: ${script.src}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  function getContext(code, index, matchLength) {
    const start = Math.max(0, index - 40);
    const end = Math.min(code.length, index + (matchLength || 0) + 60);
    return code.substring(start, end).replace(/\n/g, " ").trim();
  }

  function getScanHost() {
    return state.targetHost || window.location.hostname;
  }

  function syncTargetLabel(label) {
    state.targetLabel = label || state.targetLabel || getTargetLabel();
    const target = el("targetUrl");
    if (target) {
      target.textContent = state.targetLabel;
    }
  }

  function chromeCall(invoker) {
    return new Promise((resolve, reject) => {
      try {
        invoker((result) => {
          if (chrome.runtime?.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(result);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function getStoredExtensionTarget() {
    if (!extensionRuntime) {
      return null;
    }
    const result = await chromeCall((callback) => {
      chrome.storage.session.get("jsReconTarget", callback);
    });
    return result?.jsReconTarget || null;
  }

  async function executeScriptOnTab(tabId, func) {
    if (!extensionRuntime) {
      throw new Error("Extension scripting API is unavailable.");
    }
    const results = await chromeCall((callback) => {
      chrome.scripting.executeScript(
        {
          target: { tabId },
          func,
        },
        callback,
      );
    });
    return results?.[0]?.result;
  }

  async function resolveScanContext() {
    if (!extensionDashboardMode) {
      return {
        mode: "document",
        pageUrl: window.location.href,
        pageHost: getDomain(window.location.href),
        targetLabel: getTargetLabel(),
        target: null,
      };
    }

    const target = await getStoredExtensionTarget();
    if (!target?.tabId) {
      throw new Error(
        "No target tab is attached. Open the extension from the page you want to scan.",
      );
    }

    const pageHost = target.url ? getDomain(target.url) : target.title || "target-tab";
    return {
      mode: "extension",
      target,
      pageUrl: target.url || "",
      pageHost,
      targetLabel: pageHost || target.title || "target-tab",
    };
  }

  function setProgress(percent, status) {
    const progressBar = el("progressBar");
    const progressPct = el("scanPct");
    const progressStatus = el("scanStatus");
    if (progressBar) {
      progressBar.style.width = `${percent}%`;
    }
    if (progressPct) {
      progressPct.textContent = `${percent}%`;
    }
    if (progressStatus) {
      progressStatus.textContent = status;
    }
  }

  function setScanUi(isScanning) {
    const button = el("scanButton");
    const label = el("scanBtnText");
    const progress = el("scanProgress");
    if (button) {
      button.disabled = isScanning;
      button.style.opacity = isScanning ? "0.75" : "1";
    }
    if (label) {
      if (isScanning) {
        label.innerHTML = '<span class="loading-spinner"></span>Scanning...';
      } else {
        label.textContent = state.scanComplete ? "🔄 Re-scan" : "🔍 Scan Page";
      }
    }
    if (progress) {
      progress.classList.toggle("active", isScanning);
      if (!isScanning) {
        setTimeout(() => {
          progress.classList.remove("active");
        }, 500);
      }
    }
  }

  function showToast(message, type = "success") {
    const container = el("toastContainer");
    if (!container) {
      return;
    }
    const toast = document.createElement("div");
    toast.className = "toast-msg";
    toast.style.borderColor =
      type === "error"
        ? "var(--accent-red)"
        : type === "info"
          ? "var(--accent-blue)"
          : "var(--accent-green)";
    toast.style.color =
      type === "error"
        ? "var(--accent-red)"
        : type === "info"
          ? "var(--accent-blue)"
          : "var(--accent-green)";
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
  }

  async function copyText(value, successMessage) {
    const text = String(value || "");
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      showToast(successMessage || "Copied to clipboard.");
    } catch (error) {
      showToast("Clipboard write failed.", "error");
      console.error(error);
    }
  }

  function downloadText(filename, value, mimeType) {
    const blob = new Blob([value], {
      type: mimeType || "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function yieldToBrowser() {
    return new Promise((resolve) => {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  function decodeDataUrl(url) {
    const match = /^data:([^,]*?),(.*)$/i.exec(url);
    if (!match) {
      return "";
    }
    const meta = match[1] || "";
    const payload = match[2] || "";
    if (meta.includes(";base64")) {
      return atob(payload);
    }
    return decodeURIComponent(payload);
  }

  async function fetchResourceText(url, cache, options = {}) {
    const absoluteUrl = toAbsoluteUrl(url);
    const includeCredentials = Boolean(options.includeCredentials);
    const cacheKey = `${includeCredentials ? "include" : "same-origin"}:${absoluteUrl}`;
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    const request = (async () => {
      try {
        const parsed = new URL(absoluteUrl, window.location.href);
        if (parsed.protocol === "data:") {
          return {
            code: decodeDataUrl(absoluteUrl),
            fetchError: false,
            errorMessage: "",
          };
        }
        if (!["http:", "https:", "blob:", "file:"].includes(parsed.protocol)) {
          return {
            code: "",
            fetchError: true,
            errorMessage: `Unsupported protocol: ${parsed.protocol}`,
          };
        }

        const controller =
          typeof AbortController !== "undefined" ? new AbortController() : null;
        const timeoutId = controller
          ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
          : null;

        try {
          const response = await fetch(absoluteUrl, {
            cache: "force-cache",
            credentials: includeCredentials ? "include" : "same-origin",
            signal: controller ? controller.signal : undefined,
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return {
            code: await response.text(),
            fetchError: false,
            errorMessage: "",
          };
        } finally {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        }
      } catch (error) {
        const message =
          error && error.name === "AbortError"
            ? "Request timed out."
            : (error && error.message) || "Fetch failed.";
        return {
          code: "",
          fetchError: true,
          errorMessage: message,
        };
      }
    })();

    cache.set(cacheKey, request);
    return request;
  }

  async function mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let cursor = 0;
    const workerCount = Math.min(concurrency, items.length);

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (cursor < items.length) {
          const index = cursor;
          cursor += 1;
          results[index] = await mapper(items[index], index);
        }
      }),
    );

    return results;
  }

  async function collectScriptsFromDocument() {
    const fetchCache = new Map();
    const scriptElements = Array.from(document.scripts).filter(
      (script) => script.dataset.reconApp !== "true",
    );

    if (scriptElements.length === 0) {
      return [];
    }

    let completed = 0;
    return mapWithConcurrency(
      scriptElements,
      FETCH_CONCURRENCY,
      async (scriptElement, index) => {
        const srcAttr = scriptElement.getAttribute("src") || "";
        const src = srcAttr ? toAbsoluteUrl(srcAttr) : "";
        const fallbackCode = scriptElement.textContent || "";
        let code = fallbackCode;
        let fetchError = false;
        let errorMessage = "";

        if (src) {
          const fetched = await fetchResourceText(src, fetchCache);
          code = fetched.code || fallbackCode;
          fetchError = fetched.fetchError && !code;
          errorMessage = fetched.errorMessage;
        }

        const record = {
          index,
          key: src || `inline:${index}`,
          src,
          type: src ? "external" : "inline",
          domain: src ? getDomain(src) : "inline",
          code,
          sizeBytes: getByteSize(code),
          fetchError,
          errorMessage,
          async: Boolean(scriptElement.async),
          defer: Boolean(scriptElement.defer),
        };

        completed += 1;
        setProgress(
          10 + Math.round((completed / scriptElements.length) * 40),
          `Fetched ${completed}/${scriptElements.length} scripts...`,
        );
        if (completed % 4 === 0) {
          await yieldToBrowser();
        }

        return record;
      },
    );
  }

  async function collectScriptsFromExtensionTarget(scanContext) {
    const pageSnapshot = await executeScriptOnTab(scanContext.target.tabId, () => {
      function toAbsolute(value) {
        try {
          return new URL(value, document.baseURI).href;
        } catch {
          return value || "";
        }
      }

      return {
        pageUrl: window.location.href,
        pageTitle: document.title,
        pageHost: window.location.hostname || "",
        scripts: Array.from(document.scripts).map((script, index) => ({
          index,
          src: script.src ? toAbsolute(script.getAttribute("src") || script.src) : "",
          inlineCode: script.src ? "" : script.textContent || "",
          fallbackCode: script.textContent || "",
          async: Boolean(script.async),
          defer: Boolean(script.defer),
        })),
      };
    });

    if (!pageSnapshot) {
      return [];
    }

    state.targetPageUrl = pageSnapshot.pageUrl || scanContext.pageUrl;
    state.targetHost = pageSnapshot.pageHost || scanContext.pageHost;
    syncTargetLabel(state.targetHost || pageSnapshot.pageTitle || scanContext.targetLabel);

    const fetchCache = new Map();
    const pageScripts = pageSnapshot.scripts || [];
    if (pageScripts.length === 0) {
      return [];
    }

    let completed = 0;
    return mapWithConcurrency(
      pageScripts,
      FETCH_CONCURRENCY,
      async (pageScript, index) => {
        let code = pageScript.inlineCode || "";
        let fetchError = false;
        let errorMessage = "";

        if (pageScript.src) {
          const fetched = await fetchResourceText(pageScript.src, fetchCache, {
            includeCredentials: true,
          });
          code = fetched.code || pageScript.fallbackCode || "";
          fetchError = fetched.fetchError && !code;
          errorMessage = fetched.errorMessage;
        }

        completed += 1;
        setProgress(
          10 + Math.round((completed / pageScripts.length) * 40),
          `Fetched ${completed}/${pageScripts.length} scripts from target tab...`,
        );
        if (completed % 4 === 0) {
          await yieldToBrowser();
        }

        return {
          index,
          key: pageScript.src || `inline:${index}`,
          src: pageScript.src,
          type: pageScript.src ? "external" : "inline",
          domain: pageScript.src ? getDomain(pageScript.src) : "inline",
          code,
          sizeBytes: getByteSize(code),
          fetchError,
          errorMessage,
          async: pageScript.async,
          defer: pageScript.defer,
        };
      },
    );
  }

  async function collectScripts(scanContext) {
    if (scanContext.mode === "extension") {
      return collectScriptsFromExtensionTarget(scanContext);
    }
    return collectScriptsFromDocument();
  }

  function resetScanState() {
    const activeSection = state.activeSection;
    const graphLayout = state.graphLayout;
    const extensionTarget = state.extensionTarget;
    Object.assign(state, createInitialState(), {
      activeSection,
      graphLayout,
      extensionTarget,
    });
  }

  function rebuildDomainMap() {
    state.domains = {};
    state.totalBytes = 0;
    state.scripts.forEach((script) => {
      state.totalBytes += script.sizeBytes;
      if (!state.domains[script.domain]) {
        state.domains[script.domain] = [];
      }
      state.domains[script.domain].push(script);
    });
  }

  function detectMethod(code, index, fallback) {
    const context = code
      .substring(Math.max(0, index - 90), Math.min(code.length, index + 120))
      .toLowerCase();
    if (/\.post\s*\(|method\s*:\s*['"]post['"]/.test(context)) {
      return "POST";
    }
    if (/\.put\s*\(|method\s*:\s*['"]put['"]/.test(context)) {
      return "PUT";
    }
    if (/\.delete\s*\(|method\s*:\s*['"]delete['"]/.test(context)) {
      return "DELETE";
    }
    if (/\.patch\s*\(|method\s*:\s*['"]patch['"]/.test(context)) {
      return "PATCH";
    }
    if (/\.get\s*\(|fetch\s*\(/.test(context)) {
      return "GET";
    }
    return normalizeMethod(fallback);
  }

  function extractSecretsFromScript(script, seen) {
    SECRET_PATTERNS.forEach((pattern) => {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;
      while ((match = regex.exec(script.code)) !== null) {
        const value = String(match[pattern.valueIndex || 0] || "").trim();
        if (!value || value.length < 8 || value.length > 500) {
          continue;
        }
        const key = `${pattern.name}:${value}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        state.secrets.push({
          type: pattern.name,
          value,
          severity: pattern.severity,
          scriptSrc: script.src || `inline-${script.index}`,
          scriptKey: script.key,
          scriptIndex: script.index,
          context: getContext(script.code, match.index, value.length),
          domain: script.domain,
        });
      }
    });
  }

  function extractEndpointsFromScript(script, seen) {
    ENDPOINT_PATTERNS.forEach((pattern) => {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;
      while ((match = regex.exec(script.code)) !== null) {
        const path = String(match[pattern.valueIndex || 1] || "").trim();
        if (!path || path.length < 2 || path.length > 200) {
          continue;
        }
        if (!path.startsWith("/") && !/^https?:\/\//i.test(path)) {
          continue;
        }
        const method = pattern.methodFromMatch
          ? normalizeMethod(match[pattern.methodFromMatch])
          : detectMethod(script.code, match.index, pattern.method);
        const key = `${script.key}|${method}|${path}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        state.endpoints.push({
          path,
          method,
          scriptSrc: script.src || `inline-${script.index}`,
          scriptKey: script.key,
          scriptIndex: script.index,
          domain: script.domain,
        });
      }
    });
  }

  function extractNetworkFromScript(script, seen, websocketSeen) {
    NETWORK_PATTERNS.forEach((pattern) => {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;
      while ((match = regex.exec(script.code)) !== null) {
        const url = String(match[pattern.urlIndex] || "").trim();
        if (!url) {
          continue;
        }

        if (pattern.type === "WebSocket") {
          const wsKey = `${script.key}|${url}`;
          if (websocketSeen.has(wsKey)) {
            continue;
          }
          websocketSeen.add(wsKey);
          state.websockets.push({
            url,
            scriptSrc: script.src || `inline-${script.index}`,
            scriptKey: script.key,
            scriptIndex: script.index,
          });
          continue;
        }

        const method = pattern.methodIndex
          ? normalizeMethod(match[pattern.methodIndex])
          : pattern.method || detectMethod(script.code, match.index, "UNKNOWN");
        const key = `${pattern.type}|${method}|${url}|${script.key}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        state.networkCalls.push({
          type: pattern.type,
          url,
          method: normalizeMethod(method),
          scriptSrc: script.src || `inline-${script.index}`,
          scriptKey: script.key,
          scriptIndex: script.index,
        });
      }
    });
  }

  function shouldKeepSubdomain(host, baseDomain, currentHost) {
    if (!host || !host.includes(".")) {
      return false;
    }
    if (!baseDomain) {
      return true;
    }
    if (host === baseDomain || host === currentHost) {
      return false;
    }
    return host.endsWith(`.${baseDomain}`);
  }

  function maybeAddSubdomain(host, script, seen, baseDomain, currentHost) {
    const normalizedHost = String(host || "")
      .replace(/^\.+|\.+$/g, "")
      .toLowerCase();
    if (!shouldKeepSubdomain(normalizedHost, baseDomain, currentHost)) {
      return;
    }
    if (seen.has(normalizedHost)) {
      return;
    }
    seen.add(normalizedHost);
    state.subdomains.push({
      subdomain: normalizedHost,
      scriptSrc: script.src || `inline-${script.index}`,
      scriptKey: script.key,
      scriptIndex: script.index,
    });
  }

  function extractSubdomainsFromScript(script, seen, baseDomain, currentHost) {
    maybeAddSubdomain(script.domain, script, seen, baseDomain, currentHost);

    const urlRegex = /\b(?:https?|wss?):\/\/([A-Za-z0-9.-]+\.[A-Za-z]{2,})(?::\d+)?/gi;
    let urlMatch;
    while ((urlMatch = urlRegex.exec(script.code)) !== null) {
      maybeAddSubdomain(urlMatch[1], script, seen, baseDomain, currentHost);
    }

    if (!baseDomain) {
      return;
    }

    const bareRegex = new RegExp(
      `\\b((?:[A-Za-z0-9-]+\\.)+${escapeRegExp(baseDomain)})\\b`,
      "gi",
    );
    let bareMatch;
    while ((bareMatch = bareRegex.exec(script.code)) !== null) {
      maybeAddSubdomain(bareMatch[1], script, seen, baseDomain, currentHost);
    }
  }

  function extractCorsFromScript(script, seen) {
    const wildcard =
      /Access-Control-Allow-Origin\s*[:=]\s*['"]?\*/i.test(script.code) ||
      /cors\s*[:=]\s*['"]?\*/i.test(script.code);
    const credentials =
      /withCredentials\s*[:=]\s*true/i.test(script.code) ||
      /credentials\s*:\s*['"]include['"]/i.test(script.code);

    if (wildcard && credentials) {
      const contextMatch = /(?:withCredentials\s*[:=]\s*true|credentials\s*:\s*['"]include['"])/i.exec(
        script.code,
      );
      const context = contextMatch
        ? getContext(script.code, contextMatch.index, contextMatch[0].length)
        : "Wildcard CORS combined with credentialed requests.";
      const key = `critical-cors|${script.key}|${context}`;
      if (!seen.has(key)) {
        seen.add(key);
        state.cors.push({
          pattern: "Wildcard CORS + credentials",
          severity: "critical",
          context,
          scriptSrc: script.src || `inline-${script.index}`,
          scriptKey: script.key,
          scriptIndex: script.index,
        });
      }
    }

    CORS_PATTERNS.forEach((pattern) => {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;
      while ((match = regex.exec(script.code)) !== null) {
        const context = getContext(script.code, match.index, match[0].length);
        const key = `${pattern.label}|${script.key}|${context}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        state.cors.push({
          pattern: pattern.label,
          severity: pattern.severity,
          context,
          scriptSrc: script.src || `inline-${script.index}`,
          scriptKey: script.key,
          scriptIndex: script.index,
        });
      }
    });
  }

  async function analyzeScripts() {
    state.secrets = [];
    state.endpoints = [];
    state.networkCalls = [];
    state.subdomains = [];
    state.websockets = [];
    state.cors = [];
    state.allCode = "";

    const seenSecrets = new Set();
    const seenEndpoints = new Set();
    const seenNetwork = new Set();
    const seenSubdomains = new Set();
    const seenWebSockets = new Set();
    const seenCors = new Set();
    const currentHost = getScanHost();
    const baseDomain = getBaseDomain(currentHost);
    const total = Math.max(state.scripts.length, 1);

    for (let index = 0; index < state.scripts.length; index += 1) {
      const script = state.scripts[index];
      state.allCode += `\n${script.code || ""}`;

      if (script.code) {
        extractSecretsFromScript(script, seenSecrets);
        extractEndpointsFromScript(script, seenEndpoints);
        extractNetworkFromScript(script, seenNetwork, seenWebSockets);
        extractSubdomainsFromScript(script, seenSubdomains, baseDomain, currentHost);
        extractCorsFromScript(script, seenCors);
      }

      if (index % 3 === 0 || index === state.scripts.length - 1) {
        setProgress(
          55 + Math.round(((index + 1) / total) * 35),
          `Analyzed ${index + 1}/${state.scripts.length} scripts...`,
        );
        await yieldToBrowser();
      }
    }

    state.secrets.sort(
      (a, b) =>
        SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
        a.type.localeCompare(b.type),
    );
    state.endpoints.sort(
      (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
    );
    state.networkCalls.sort(
      (a, b) => a.type.localeCompare(b.type) || a.url.localeCompare(b.url),
    );
    state.subdomains.sort((a, b) => a.subdomain.localeCompare(b.subdomain));
    state.websockets.sort((a, b) => a.url.localeCompare(b.url));
    state.cors.sort(
      (a, b) =>
        SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
        a.pattern.localeCompare(b.pattern),
    );
  }

  function buildGraphData() {
    const nodes = [];
    const links = [];
    const nodeSet = new Set();
    const rootId = `root:${state.targetLabel || getTargetLabel()}`;

    function addNode(node) {
      if (nodeSet.has(node.id)) {
        return;
      }
      nodeSet.add(node.id);
      nodes.push(node);
    }

    addNode({
      id: rootId,
      label: state.targetLabel || getTargetLabel(),
      type: "root",
      r: 18,
    });

    state.scripts.forEach((script) => {
      const scriptId = `script:${script.key}`;
      addNode({
        id: scriptId,
        label: getScriptDisplayName(script).slice(0, 28),
        fullLabel: script.src || `inline-${script.index}`,
        type: "script",
        r: 12,
      });
      links.push({ source: rootId, target: scriptId });
    });

    const endpointNodeSet = new Set();
    state.endpoints.forEach((endpoint) => {
      const endpointId = `endpoint:${endpoint.path}`;
      if (!endpointNodeSet.has(endpointId)) {
        endpointNodeSet.add(endpointId);
        addNode({
          id: endpointId,
          label: endpoint.path.slice(0, 26),
          fullLabel: endpoint.path,
          type: "endpoint",
          method: normalizeMethod(endpoint.method),
          r: 9,
        });
      }
      links.push({
        source: `script:${endpoint.scriptKey}`,
        target: endpointId,
        method: normalizeMethod(endpoint.method),
      });
    });

    state.graphData = { nodes, links };
  }

  function getUniqueEndpointCount() {
    return new Set(state.endpoints.map((endpoint) => endpoint.path)).size;
  }

  function updateStats() {
    el("statScripts").textContent = String(state.scripts.length);
    el("statSecrets").textContent = String(state.secrets.length);
    el("statEndpoints").textContent = String(getUniqueEndpointCount());
    el("statNetwork").textContent = String(state.networkCalls.length);
    el("statSubdomains").textContent = String(state.subdomains.length);
    el("statWS").textContent = String(state.websockets.length);
    el("statCORS").textContent = String(state.cors.length);
    el("statSize").textContent = formatSize(state.totalBytes);
  }

  function buildScriptIssueCountMap() {
    const counts = new Map();
    function bump(scriptKey) {
      counts.set(scriptKey, (counts.get(scriptKey) || 0) + 1);
    }
    state.secrets.forEach((secret) => bump(secret.scriptKey));
    state.cors.forEach((issue) => bump(issue.scriptKey));
    state.scripts.forEach((script) => {
      if (script.fetchError) {
        bump(script.key);
      }
    });
    return counts;
  }

  function getGroupedEndpoints() {
    const groups = new Map();
    state.endpoints.forEach((endpoint) => {
      const key = `${normalizeMethod(endpoint.method)}|${endpoint.path}`;
      if (!groups.has(key)) {
        groups.set(key, {
          method: normalizeMethod(endpoint.method),
          path: endpoint.path,
          sources: new Set(),
        });
      }
      groups.get(key).sources.add(
        shortSourceName(endpoint.scriptSrc, endpoint.scriptIndex),
      );
    });
    return Array.from(groups.values())
      .map((entry) => ({
        method: entry.method,
        path: entry.path,
        sources: Array.from(entry.sources).sort(),
      }))
      .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  }

  function renderOverview() {
    const risk = el("riskSummary");
    const domainBreakdown = el("domainBreakdown");
    if (!risk || !domainBreakdown) {
      return;
    }

    if (!state.scanComplete) {
      risk.innerHTML =
        '<div class="empty-state"><div class="icon">🔍</div><div>Run a scan to see results</div></div>';
      domainBreakdown.innerHTML =
        '<div class="empty-state"><div class="icon">🌐</div><div>Run a scan to see domains</div></div>';
      return;
    }

    const criticals = state.secrets.filter(
      (secret) => secret.severity === "critical",
    ).length;
    const highs = state.secrets.filter((secret) => secret.severity === "high").length;
    const externals = state.scripts.filter((script) => script.type === "external").length;
    const fetchFailures = state.scripts.filter((script) => script.fetchError).length;

    risk.innerHTML = `
      <div class="d-flex flex-column gap-2">
        ${
          criticals > 0
            ? `<div class="d-flex justify-content-between align-items-center p-2" style="background:rgba(239,68,68,0.1);border-radius:6px"><span>Critical Secrets</span><span class="severity-critical fw-bold">${criticals}</span></div>`
            : ""
        }
        ${
          highs > 0
            ? `<div class="d-flex justify-content-between align-items-center p-2" style="background:rgba(249,115,22,0.1);border-radius:6px"><span>High Severity</span><span class="severity-high fw-bold">${highs}</span></div>`
            : ""
        }
        <div class="d-flex justify-content-between align-items-center p-2" style="background:rgba(59,130,246,0.1);border-radius:6px"><span>External Scripts</span><span style="color:var(--accent-blue)" class="fw-bold">${externals}</span></div>
        <div class="d-flex justify-content-between align-items-center p-2" style="background:rgba(6,182,212,0.1);border-radius:6px"><span>Unique Endpoints</span><span style="color:var(--accent-cyan)" class="fw-bold">${getUniqueEndpointCount()}</span></div>
        ${
          fetchFailures > 0
            ? `<div class="d-flex justify-content-between align-items-center p-2" style="background:rgba(245,158,11,0.1);border-radius:6px"><span>Fetch Failures</span><span class="severity-medium fw-bold">${fetchFailures}</span></div>`
            : ""
        }
        ${
          criticals === 0 && highs === 0
            ? '<div class="text-center py-2" style="color:var(--accent-green)">No critical issues found.</div>'
            : ""
        }
      </div>
    `;

    const domainEntries = Object.entries(state.domains).sort(
      (left, right) => right[1].length - left[1].length,
    );
    if (domainEntries.length === 0) {
      domainBreakdown.innerHTML =
        '<div class="empty-state"><div class="icon">🌐</div><div>No domains found</div></div>';
      return;
    }

    const maxCount = Math.max(...domainEntries.map((entry) => entry[1].length), 1);
    domainBreakdown.innerHTML = domainEntries
      .map(
        ([domain, scripts]) => `
          <div class="mb-3">
            <div class="d-flex justify-content-between mb-1">
              <span class="small">${escapeHTML(domain)}</span>
              <span class="small text-muted">${scripts.length} script${scripts.length > 1 ? "s" : ""}</span>
            </div>
            <div style="background:var(--bg-dark);border-radius:4px;height:6px;">
              <div style="width:${((scripts.length / maxCount) * 100).toFixed(0)}%;height:100%;background:linear-gradient(90deg,var(--accent-blue),var(--accent-cyan));border-radius:4px;"></div>
            </div>
          </div>
        `,
      )
      .join("");
  }

  function renderScriptFilters() {
    const container = el("filterChips");
    if (!container) {
      return;
    }
    if (state.scripts.length === 0) {
      container.innerHTML = "";
      return;
    }

    const filters = [
      {
        key: "all",
        label: "All",
      },
      ...Object.keys(state.domains)
        .sort()
        .map((domain) => ({
          key: domain,
          label: domain,
        })),
    ];

    if (state.scripts.some((script) => script.fetchError)) {
      filters.push({
        key: "__fetch_errors__",
        label: "Fetch Errors",
      });
    }

    container.innerHTML = filters
      .map(
        (filter) => `
          <span class="filter-chip ${state.scriptDomainFilter === filter.key ? "active" : ""}" data-script-domain-filter="${escapeHTML(filter.key)}">${escapeHTML(filter.label)}</span>
        `,
      )
      .join("");
  }

  function getFilteredScripts() {
    const query = (el("scriptSearch")?.value || "").toLowerCase();
    const typeFilter = el("scriptTypeFilter")?.value || "all";
    return state.scripts.filter((script) => {
      const matchesQuery =
        !query ||
        (script.src || "").toLowerCase().includes(query) ||
        script.domain.toLowerCase().includes(query) ||
        getScriptDisplayName(script).toLowerCase().includes(query);
      const matchesType = typeFilter === "all" || script.type === typeFilter;
      const matchesDomain =
        state.scriptDomainFilter === "all" ||
        (state.scriptDomainFilter === "__fetch_errors__"
          ? script.fetchError
          : script.domain === state.scriptDomainFilter);
      return matchesQuery && matchesType && matchesDomain;
    });
  }

  function renderScripts() {
    renderScriptFilters();
    const container = el("scriptList");
    if (!container) {
      return;
    }
    if (state.scripts.length === 0) {
      container.innerHTML =
        '<div class="empty-state"><div class="icon">📜</div><div>No scripts found</div></div>';
      return;
    }

    const filteredScripts = getFilteredScripts();
    if (filteredScripts.length === 0) {
      container.innerHTML =
        '<div class="empty-state"><div class="icon">📜</div><div>No scripts match the current filters</div></div>';
      return;
    }

    const issueCounts = buildScriptIssueCountMap();
    container.innerHTML = filteredScripts
      .map((script) => {
        const warningCount = issueCounts.get(script.key) || 0;
        const sourceLabel = script.src
          ? escapeHTML(script.src)
          : `[inline script ${script.index}]`;
        return `
          <div class="script-row" id="script-row-${script.index}" data-script-row="${script.index}">
            <div class="d-flex justify-content-between align-items-center">
              <div class="d-flex align-items-center gap-2 flex-wrap">
                <span class="text-muted small">#${script.index + 1}</span>
                <span class="badge-type-${script.type}">${script.type}</span>
                <span class="badge-domain">${escapeHTML(script.domain)}</span>
                ${
                  warningCount > 0
                    ? `<span class="badge-warn">${warningCount} flag${warningCount > 1 ? "s" : ""}</span>`
                    : ""
                }
                ${
                  script.fetchError
                    ? '<span class="badge-danger">fetch failed</span>'
                    : ""
                }
                <span class="text-muted small">${formatSize(script.sizeBytes)}</span>
              </div>
              <div class="d-flex gap-2">
                <button class="btn-sm-icon" data-script-copy="${script.index}" title="Copy">📋</button>
                <button class="btn-sm-icon" data-script-download="${script.index}" title="Download">⬇</button>
              </div>
            </div>
            <div class="mt-1 small text-muted text-truncate" style="max-width:100%">${sourceLabel}</div>
            ${
              script.fetchError
                ? `<div class="mt-1 small" style="color:var(--accent-red)">${escapeHTML(script.errorMessage || "Resource fetch failed.")}</div>`
                : ""
            }
          </div>
        `;
      })
      .join("");

    if (state.currentViewerIndex !== null) {
      const selectedRow = el(`script-row-${state.currentViewerIndex}`);
      if (selectedRow) {
        selectedRow.classList.add("selected");
      }
    }
  }

  function highlightCode(code) {
    let html = escapeHTML(code);
    const patterns = [
      { regex: /(https?:\/\/[^\s"'`<>&]+)/g, cls: "highlight-url" },
      {
        regex: /\b(localStorage|sessionStorage|indexedDB)\b/g,
        cls: "highlight-storage",
      },
      { regex: /\b(document\.cookie|cookie)\b/gi, cls: "highlight-cookie" },
      { regex: /\b(Authorization|Bearer|jwt|token)\b/gi, cls: "highlight-token" },
      { regex: /\b(fetch|axios|XMLHttpRequest)\b/g, cls: "highlight-http" },
      {
        regex: /(\/api\/[^\s"'`<>]+|\/v\d+\/[^\s"'`<>]+|\/graphql[^\s"'`<>]*)/g,
        cls: "highlight-endpoint",
      },
    ];

    patterns.forEach((pattern) => {
      html = html.replace(pattern.regex, (match) => {
        return `<span class="${pattern.cls}">${match}</span>`;
      });
    });
    return html;
  }

  function getScriptText(script) {
    return script.code || getUnavailableScriptMessage(script);
  }

  function formatScriptCode(script) {
    if (script.formattedCode) {
      return script.formattedCode;
    }
    const rawCode = getScriptText(script);
    let formatted = rawCode;
    if (rawCode && rawCode.length < 400000 && typeof js_beautify !== "undefined") {
      try {
        formatted = js_beautify(rawCode, { indent_size: 2 });
      } catch (error) {
        console.error(error);
      }
    }
    script.formattedCode = formatted;
    return formatted;
  }

  function viewScript(index) {
    const script = state.scripts[index];
    if (!script) {
      return;
    }

    const viewer = el("scriptViewer");
    const title = el("viewerTitle");
    const codeBlock = el("viewerCode");
    if (!viewer || !title || !codeBlock) {
      return;
    }

    const formattedCode = formatScriptCode(script);
    state.currentViewerIndex = index;
    state.currentViewerCode = formattedCode;

    title.textContent = getScriptDisplayName(script);
    codeBlock.innerHTML = highlightCode(formattedCode);
    viewer.style.display = "block";

    document.querySelectorAll(".script-row").forEach((row) => {
      row.classList.remove("selected");
    });
    const selectedRow = el(`script-row-${index}`);
    if (selectedRow) {
      selectedRow.classList.add("selected");
      selectedRow.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    viewer.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeViewer() {
    const viewer = el("scriptViewer");
    if (viewer) {
      viewer.style.display = "none";
    }
    document.querySelectorAll(".script-row").forEach((row) => {
      row.classList.remove("selected");
    });
    state.currentViewerIndex = null;
    state.currentViewerCode = "";
  }

  function copyViewerCode() {
    copyText(state.currentViewerCode, "Code copied.");
  }

  function downloadViewerCode() {
    const script =
      state.currentViewerIndex !== null ? state.scripts[state.currentViewerIndex] : null;
    const filename = script
      ? sanitizeFilename(shortSourceName(script.src, script.index), `inline-${script.index}.js`)
      : "script.js";
    downloadText(filename, state.currentViewerCode, "text/javascript;charset=utf-8");
    showToast("Download started.");
  }

  function copyScript(index) {
    const script = state.scripts[index];
    if (!script) {
      return;
    }
    copyText(getScriptText(script), "Code copied.");
  }

  function downloadScript(index) {
    const script = state.scripts[index];
    if (!script) {
      return;
    }
    const filename = script.src
      ? sanitizeFilename(shortSourceName(script.src, script.index), `script-${index}.js`)
      : `inline-${index}.js`;
    downloadText(filename, getScriptText(script), "text/javascript;charset=utf-8");
  }

  function renderSecrets() {
    const chipContainer = el("secretFilterChips");
    const listContainer = el("secretList");
    if (!chipContainer || !listContainer) {
      return;
    }
    if (state.secrets.length === 0) {
      chipContainer.innerHTML = "";
      listContainer.innerHTML =
        '<div class="empty-state"><div class="icon">🔐</div><div>No secrets found.</div></div>';
      return;
    }

    const types = Array.from(new Set(state.secrets.map((secret) => secret.type))).sort();
    chipContainer.innerHTML = types
      .map((type) => {
        const count = state.secrets.filter((secret) => secret.type === type).length;
        return `<span class="filter-chip active" data-type="${escapeHTML(type)}">${escapeHTML(type)} <span class="text-muted">${count}</span></span>`;
      })
      .join("");

    renderSecretList();
  }

  function getActiveSecretTypes() {
    return Array.from(
      document.querySelectorAll("#secretFilterChips .filter-chip.active"),
    ).map((chip) => chip.dataset.type || "");
  }

  function renderSecretList() {
    const container = el("secretList");
    if (!container) {
      return;
    }
    const query = (el("secretSearch")?.value || "").toLowerCase();
    const activeTypes = getActiveSecretTypes();
    const filtered = state.secrets.filter((secret) => {
      const matchesType =
        activeTypes.length === 0 || activeTypes.includes(secret.type);
      const haystack = [
        secret.type,
        secret.value,
        secret.context,
        shortSourceName(secret.scriptSrc, secret.scriptIndex),
      ]
        .join(" ")
        .toLowerCase();
      return matchesType && (!query || haystack.includes(query));
    });

    if (filtered.length === 0) {
      container.innerHTML =
        '<div class="empty-state"><div class="icon">🔐</div><div>No secrets match the current filters</div></div>';
      return;
    }

    container.innerHTML = filtered
      .map(
        (secret) => `
          <div class="secret-item">
            <div class="d-flex justify-content-between align-items-start">
              <div class="secret-type">${escapeHTML(secret.type)} <span class="severity-${secret.severity}">[${secret.severity}]</span></div>
              <button class="btn-sm-icon" data-copy="${encodeCopyPayload(secret.value)}" title="Copy">📋</button>
            </div>
            <div class="secret-value">${escapeHTML(secret.value.substring(0, 120))}${secret.value.length > 120 ? "..." : ""}</div>
            <div class="mt-1" style="font-size:0.75rem;color:var(--text-muted)">Found in: ${escapeHTML(shortSourceName(secret.scriptSrc, secret.scriptIndex))}</div>
            <div class="mt-1 p-1" style="background:rgba(0,0,0,0.3);border-radius:4px;font-size:0.75rem;color:var(--text-muted);font-family:monospace">...${escapeHTML(secret.context.substring(0, 120))}...</div>
          </div>
        `,
      )
      .join("");
  }

  function toggleSecretFilter(chip) {
    chip.classList.toggle("active");
    renderSecretList();
  }

  function filterSecrets() {
    renderSecretList();
  }

  function renderEndpoints() {
    const container = el("endpointList");
    if (!container) {
      return;
    }

    const query = (el("endpointSearch")?.value || "").toLowerCase();
    const groupedEndpoints = getGroupedEndpoints().filter((endpoint) => {
      if (!query) {
        return true;
      }
      return (
        endpoint.path.toLowerCase().includes(query) ||
        endpoint.method.toLowerCase().includes(query) ||
        endpoint.sources.join(" ").toLowerCase().includes(query)
      );
    });

    if (groupedEndpoints.length === 0) {
      container.innerHTML = state.endpoints.length
        ? '<div class="empty-state"><div class="icon">🌐</div><div>No endpoints match the current filter</div></div>'
        : '<div class="empty-state"><div class="icon">🌐</div><div>No endpoints discovered</div></div>';
      return;
    }

    container.innerHTML = groupedEndpoints
      .map(
        (endpoint) => `
          <div class="endpoint-item">
            <span class="method-badge method-${normalizeMethod(endpoint.method)}">${normalizeMethod(endpoint.method)}</span>
            <span style="color:var(--accent-cyan);flex:1;word-break:break-all">${escapeHTML(endpoint.path)}</span>
            <span class="text-muted small">${escapeHTML(endpoint.sources.slice(0, 2).join(", "))}${endpoint.sources.length > 2 ? ` +${endpoint.sources.length - 2}` : ""}</span>
            <button class="btn-sm-icon" data-copy="${encodeCopyPayload(endpoint.path)}" title="Copy">📋</button>
          </div>
        `,
      )
      .join("");
  }

  function filterEndpoints() {
    renderEndpoints();
  }

  function renderNetwork() {
    const container = el("networkList");
    if (!container) {
      return;
    }
    if (state.networkCalls.length === 0) {
      container.innerHTML =
        '<div class="empty-state"><div class="icon">📡</div><div>No network calls detected</div></div>';
      return;
    }

    const groups = new Map();
    state.networkCalls.forEach((call) => {
      if (!groups.has(call.type)) {
        groups.set(call.type, []);
      }
      groups.get(call.type).push(call);
    });

    container.innerHTML = Array.from(groups.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(
        ([type, calls]) => `
          <div class="panel mb-3">
            <div class="panel-header">${escapeHTML(type)} <span class="badge-domain ms-2">${calls.length}</span></div>
            <div class="panel-body">
              ${calls
                .map(
                  (call) => `
                    <div class="endpoint-item">
                      <span class="method-badge method-${normalizeMethod(call.method)}">${normalizeMethod(call.method)}</span>
                      <span style="color:var(--text-primary);flex:1;word-break:break-all">${escapeHTML(call.url)}</span>
                      <span class="text-muted small">${escapeHTML(shortSourceName(call.scriptSrc, call.scriptIndex))}</span>
                      <button class="btn-sm-icon" data-copy="${encodeCopyPayload(call.url)}" title="Copy">📋</button>
                    </div>
                  `,
                )
                .join("")}
            </div>
          </div>
        `,
      )
      .join("");
  }

  function renderSubdomains() {
    const container = el("subdomainList");
    if (!container) {
      return;
    }
    if (state.subdomains.length === 0) {
      container.innerHTML =
        '<div class="empty-state"><div class="icon">🔗</div><div>No subdomains found</div></div>';
      return;
    }

    container.innerHTML = state.subdomains
      .map(
        (item) => `
          <div class="endpoint-item">
            <span style="color:var(--accent-green);flex:1">${escapeHTML(item.subdomain)}</span>
            <span class="text-muted small">${escapeHTML(shortSourceName(item.scriptSrc, item.scriptIndex))}</span>
            <button class="btn-sm-icon" data-copy="${encodeCopyPayload(item.subdomain)}" title="Copy">📋</button>
          </div>
        `,
      )
      .join("");
  }

  function renderDepTree() {
    const container = el("depTree");
    if (!container) {
      return;
    }
    if (state.scripts.length === 0) {
      container.innerHTML =
        '<div class="empty-state"><div class="icon">🌲</div><div>No scripts to analyze</div></div>';
      return;
    }

    const domainGroups = Object.entries(state.domains).sort(
      (left, right) => right[1].length - left[1].length,
    );

    container.innerHTML = domainGroups
      .map(
        ([domain, scripts]) => `
          <div class="panel mb-3">
            <div class="panel-header">
              <span>📦 ${escapeHTML(domain)}</span>
              <span class="badge-domain">${scripts.length} scripts</span>
            </div>
            <div class="panel-body">
              <div class="dep-tree-item root">🌐 ${escapeHTML(domain)}</div>
              ${scripts
                .map(
                  (script, offset) => `
                    <div class="dep-tree-item" style="margin-left:${20 + (offset % 3) * 10}px">
                      <span style="color:var(--accent-cyan)">↳</span>
                      <span class="ms-1">${escapeHTML(getScriptDisplayName(script))}</span>
                      <span class="ms-2 text-muted small">${formatSize(script.sizeBytes)}</span>
                      ${
                        script.type === "external"
                          ? '<span class="badge-type-external ms-2">ext</span>'
                          : '<span class="badge-type-inline ms-2">inline</span>'
                      }
                    </div>
                  `,
                )
                .join("")}
            </div>
          </div>
        `,
      )
      .join("");
  }

  function renderCORSandWS() {
    const corsContainer = el("corsList");
    const wsContainer = el("wsList");
    if (!corsContainer || !wsContainer) {
      return;
    }

    corsContainer.innerHTML =
      state.cors.length === 0
        ? '<div class="empty-state"><div class="icon">🛡</div><div>No CORS indicators found</div></div>'
        : state.cors
            .map(
              (issue) => `
                <div class="secret-item" style="background:rgba(245,158,11,0.08);border-color:rgba(245,158,11,0.22)">
                  <div class="d-flex justify-content-between align-items-start">
                    <div class="secret-type" style="color:var(--accent-yellow)">${escapeHTML(issue.pattern)} <span class="severity-${issue.severity}">[${issue.severity}]</span></div>
                    <button class="btn-sm-icon" data-copy="${encodeCopyPayload(issue.context)}" title="Copy">📋</button>
                  </div>
                  <div style="font-family:monospace;font-size:0.78rem;color:var(--text-secondary)">${escapeHTML(issue.context.substring(0, 140))}</div>
                  <div class="mt-1" style="font-size:0.72rem;color:var(--text-muted)">in: ${escapeHTML(shortSourceName(issue.scriptSrc, issue.scriptIndex))}</div>
                </div>
              `,
            )
            .join("");

    wsContainer.innerHTML =
      state.websockets.length === 0
        ? '<div class="empty-state"><div class="icon">🔌</div><div>No WebSocket connections found</div></div>'
        : state.websockets
            .map(
              (socket) => `
                <div class="endpoint-item">
                  <span style="color:var(--accent-purple);font-weight:600">WebSocket</span>
                  <span style="flex:1;word-break:break-all">${escapeHTML(socket.url)}</span>
                  <span class="text-muted small">${escapeHTML(shortSourceName(socket.scriptSrc, socket.scriptIndex))}</span>
                  <button class="btn-sm-icon" data-copy="${encodeCopyPayload(socket.url)}" title="Copy">📋</button>
                </div>
              `,
            )
            .join("");
  }

  function renderGraphFallback(container) {
    const width = container.clientWidth || 800;
    const height = 520;
    const svgNS = "http://www.w3.org/2000/svg";
    const centerX = width / 2;
    const centerY = height / 2;
    const nodes = state.graphData.nodes;
    const links = state.graphData.links;
    const root = nodes.find((node) => node.type === "root");
    const scripts = nodes.filter((node) => node.type === "script");
    const endpoints = nodes.filter((node) => node.type === "endpoint");

    const layout = new Map();

    function distributeVertical(items, x, topPadding, bottomPadding) {
      if (items.length === 0) {
        return;
      }
      const usableHeight = Math.max(height - topPadding - bottomPadding, 1);
      const gap = items.length === 1 ? 0 : usableHeight / (items.length - 1);
      items.forEach((item, index) => {
        layout.set(item.id, {
          x,
          y: topPadding + gap * index,
        });
      });
    }

    function distributeCircular(items, radius, startAngle = -Math.PI / 2) {
      if (items.length === 0) {
        return;
      }
      const step = (Math.PI * 2) / items.length;
      items.forEach((item, index) => {
        const angle = startAngle + step * index;
        layout.set(item.id, {
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius,
        });
      });
    }

    if (state.graphLayout === "radial") {
      if (root) {
        layout.set(root.id, { x: centerX, y: centerY });
      }
      const minDimension = Math.min(width, height);
      const scriptRadius = Math.max(90, Math.min(minDimension * 0.22, 150));
      const endpointRadius = Math.max(
        scriptRadius + 80,
        Math.min(minDimension * 0.38, 235),
      );
      distributeCircular(scripts, scriptRadius);
      distributeCircular(endpoints, endpointRadius, -Math.PI / 2 + Math.PI / 10);
    } else {
      if (root) {
        layout.set(root.id, { x: 100, y: height / 2 });
      }
      distributeVertical(scripts, Math.round(width * 0.38), 70, 70);
      distributeVertical(endpoints, Math.round(width * 0.78), 50, 50);
    }

    const methodColors = {
      GET: "#10b981",
      POST: "#3b82f6",
      PUT: "#f59e0b",
      DELETE: "#ef4444",
      PATCH: "#f59e0b",
      UNKNOWN: "#94a3b8",
    };

    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.style.background = "var(--bg-deep)";

    links.forEach((link) => {
      const source = layout.get(link.source);
      const target = layout.get(link.target);
      if (!source || !target) {
        return;
      }
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", String(source.x));
      line.setAttribute("y1", String(source.y));
      line.setAttribute("x2", String(target.x));
      line.setAttribute("y2", String(target.y));
      line.setAttribute(
        "stroke",
        methodColors[normalizeMethod(link.method)] || "#334155",
      );
      line.setAttribute("stroke-opacity", "0.6");
      line.setAttribute("stroke-width", "1.4");
      svg.appendChild(line);
    });

    nodes.forEach((node) => {
      const position = layout.get(node.id);
      if (!position) {
        return;
      }

      const group = document.createElementNS(svgNS, "g");
      const circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("cx", String(position.x));
      circle.setAttribute("cy", String(position.y));
      circle.setAttribute("r", String(node.r));
      circle.setAttribute(
        "fill",
        node.type === "root"
          ? "#3b82f6"
          : node.type === "script"
            ? "#8b5cf6"
            : methodColors[normalizeMethod(node.method)] || methodColors.UNKNOWN,
      );
      circle.setAttribute(
        "stroke",
        node.type === "root" ? "#60a5fa" : "rgba(255,255,255,0.15)",
      );
      circle.setAttribute("stroke-width", node.type === "root" ? "2.5" : "1");

      const label = document.createElementNS(svgNS, "text");
      label.setAttribute("fill", "#94a3b8");
      label.setAttribute("font-size", "10");
      if (state.graphLayout === "radial" && node.type !== "root") {
        const isLeftSide = position.x < centerX - 12;
        const isRightSide = position.x > centerX + 12;
        const labelX =
          position.x +
          (isLeftSide ? -(node.r + 8) : isRightSide ? node.r + 8 : 0);
        label.setAttribute("x", String(labelX));
        label.setAttribute(
          "y",
          String(position.y + (isLeftSide || isRightSide ? 3 : node.r + 14)),
        );
        label.setAttribute(
          "text-anchor",
          isLeftSide ? "end" : isRightSide ? "start" : "middle",
        );
      } else {
        label.setAttribute("x", String(position.x));
        label.setAttribute("y", String(position.y + node.r + 14));
        label.setAttribute("text-anchor", "middle");
      }
      label.textContent = node.label;

      const title = document.createElementNS(svgNS, "title");
      title.textContent = node.fullLabel || node.label;

      group.appendChild(circle);
      group.appendChild(label);
      group.appendChild(title);
      svg.appendChild(group);
    });

    const legend = document.createElementNS(svgNS, "g");
    const legendItems = [
      ["Root", "#3b82f6"],
      ["Script", "#8b5cf6"],
      ["GET", "#10b981"],
      ["POST", "#3b82f6"],
      ["PUT", "#f59e0b"],
      ["DELETE", "#ef4444"],
    ];
    legendItems.forEach(([label, color], index) => {
      const y = 18 + index * 20;
      const dot = document.createElementNS(svgNS, "circle");
      dot.setAttribute("cx", "18");
      dot.setAttribute("cy", String(y));
      dot.setAttribute("r", "5");
      dot.setAttribute("fill", color);
      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", "30");
      text.setAttribute("y", String(y + 3));
      text.setAttribute("fill", "#94a3b8");
      text.setAttribute("font-size", "10");
      text.textContent = label;
      legend.appendChild(dot);
      legend.appendChild(text);
    });
    svg.appendChild(legend);
    container.appendChild(svg);
  }

  function syncGraphLayoutButton() {
    const button = el("toggleGraphLayoutButton");
    if (!button) {
      return;
    }
    button.textContent = state.graphLayout === "radial" ? "Layout: Radial" : "Layout: Force";
  }

  function renderGraph() {
    const container = el("graphContainer");
    if (!container) {
      return;
    }
    syncGraphLayoutButton();
    container.innerHTML = "";

    if (!state.scanComplete || state.graphData.nodes.length === 0) {
      container.innerHTML =
        '<div class="empty-state" style="padding:80px"><div class="icon">🕸</div><div>Run a scan first to see the call graph</div></div>';
      return;
    }

    if (typeof d3 === "undefined") {
      renderGraphFallback(container);
      return;
    }

    const width = container.clientWidth || 800;
    const height = 520;
    const nodes = state.graphData.nodes.map((node) => ({ ...node }));
    const links = state.graphData.links.map((link) => ({ ...link }));
    const rootNode = nodes.find((node) => node.type === "root");
    if (rootNode) {
      rootNode.fx = width / 2;
      rootNode.fy = height / 2;
    }

    const svg = d3
      .select(container)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .style("background", "var(--bg-deep)");

    const graphGroup = svg.append("g");
    svg.call(
      d3
        .zoom()
        .scaleExtent([0.3, 3])
        .on("zoom", (event) => graphGroup.attr("transform", event.transform)),
    );

    const simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((node) => node.id)
          .distance(state.graphLayout === "radial" ? 85 : 110)
          .strength(0.7),
      )
      .force(
        "charge",
        d3.forceManyBody().strength(state.graphLayout === "radial" ? -90 : -240),
      )
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius((node) => node.r + 10));

    if (state.graphLayout === "radial") {
      simulation.force(
        "radial",
        d3
          .forceRadial(
            (node) =>
              node.type === "root" ? 0 : node.type === "script" ? 150 : 260,
            width / 2,
            height / 2,
          )
          .strength(0.9),
      );
    }

    const methodColors = {
      GET: "#10b981",
      POST: "#3b82f6",
      PUT: "#f59e0b",
      DELETE: "#ef4444",
      PATCH: "#f59e0b",
      UNKNOWN: "#94a3b8",
    };

    const linksSelection = graphGroup
      .append("g")
      .selectAll("line")
      .data(links)
      .enter()
      .append("line")
      .attr("class", "link")
      .attr("stroke", (link) => methodColors[normalizeMethod(link.method)] || "#334155")
      .attr("stroke-width", 1.2)
      .attr("stroke-opacity", 0.6);

    const nodesSelection = graphGroup
      .append("g")
      .selectAll("g")
      .data(nodes)
      .enter()
      .append("g")
      .attr("class", "node")
      .call(
        d3
          .drag()
          .on("start", (event, node) => {
            if (!event.active) {
              simulation.alphaTarget(0.3).restart();
            }
            node.fx = node.x;
            node.fy = node.y;
          })
          .on("drag", (event, node) => {
            node.fx = event.x;
            node.fy = event.y;
          })
          .on("end", (event, node) => {
            if (!event.active) {
              simulation.alphaTarget(0);
            }
            if (node.type !== "root") {
              node.fx = null;
              node.fy = null;
            }
          }),
      );

    nodesSelection
      .append("circle")
      .attr("r", (node) => node.r)
      .attr("fill", (node) => {
        if (node.type === "root") {
          return "#3b82f6";
        }
        if (node.type === "script") {
          return "#8b5cf6";
        }
        return methodColors[normalizeMethod(node.method)] || methodColors.UNKNOWN;
      })
      .attr("stroke", (node) =>
        node.type === "root" ? "#60a5fa" : "rgba(255,255,255,0.15)",
      )
      .attr("stroke-width", (node) => (node.type === "root" ? 2.5 : 1));

    nodesSelection
      .append("text")
      .attr("dy", (node) => node.r + 12)
      .attr("text-anchor", "middle")
      .attr("fill", "#94a3b8")
      .attr("font-size", 9)
      .text((node) => node.label);

    nodesSelection.append("title").text((node) => node.fullLabel || node.label);

    simulation.on("tick", () => {
      linksSelection
        .attr("x1", (link) => link.source.x)
        .attr("y1", (link) => link.source.y)
        .attr("x2", (link) => link.target.x)
        .attr("y2", (link) => link.target.y);
      nodesSelection.attr("transform", (node) => `translate(${node.x},${node.y})`);
    });
  }

  function renderAll() {
    updateStats();
    renderOverview();
    renderScripts();
    renderSecrets();
    renderEndpoints();
    renderNetwork();
    renderSubdomains();
    renderDepTree();
    renderCORSandWS();
    if (state.activeSection === "graph") {
      renderGraph();
    }
  }

  async function startScan() {
    if (state.isScanning) {
      return;
    }

    resetScanState();
    state.isScanning = true;
    closeViewer();
    setScanUi(true);

    try {
      const scanContext = await resolveScanContext();
      state.extensionTarget = scanContext.target;
      state.targetPageUrl = scanContext.pageUrl;
      state.targetHost = scanContext.pageHost;
      syncTargetLabel(scanContext.targetLabel);
      setProgress(
        5,
        scanContext.mode === "extension"
          ? "Collecting scripts from target tab..."
          : "Collecting scripts...",
      );

      state.scripts = await collectScripts(scanContext);
      rebuildDomainMap();

      setProgress(55, "Analyzing fetched resources...");
      await analyzeScripts();

      setProgress(93, "Building graph...");
      buildGraphData();

      state.scanComplete = true;
      renderAll();
      setProgress(100, "Scan complete.");
      showToast(`Scan complete. ${state.scripts.length} scripts analyzed.`);
    } catch (error) {
      console.error(error);
      showToast(`Scan failed: ${(error && error.message) || "Unknown error."}`, "error");
    } finally {
      state.isScanning = false;
      setScanUi(false);
    }
  }

  function filterScripts() {
    renderScripts();
  }

  function setScriptDomainFilter(filterKey) {
    state.scriptDomainFilter = filterKey;
    renderScripts();
  }

  function showSection(name) {
    document.querySelectorAll('[id^="section-"]').forEach((section) => {
      section.style.display = "none";
    });
    document.querySelectorAll(".sidebar-item").forEach((item) => {
      item.classList.remove("active");
    });

    const section = el(`section-${name}`);
    if (section) {
      section.style.display = "block";
    }

    document.querySelectorAll(".sidebar-item").forEach((item) => {
      const targetSection = item.dataset.section || "";
      if (targetSection === name) {
        item.classList.add("active");
      }
    });

    state.activeSection = name;
    if (name === "graph" && state.scanComplete) {
      renderGraph();
    }
  }

  function resetGraph() {
    if (state.scanComplete) {
      renderGraph();
    }
  }

  function toggleGraphLayout() {
    state.graphLayout = state.graphLayout === "force" ? "radial" : "force";
    syncGraphLayoutButton();
    if (state.activeSection === "graph" && state.scanComplete) {
      renderGraph();
    }
  }

  function exportResults() {
    const report = {
      target: state.targetPageUrl || window.location.href,
      targetLabel: state.targetLabel || getTargetLabel(),
      scanDate: new Date().toISOString(),
      summary: {
        totalScripts: state.scripts.length,
        secrets: state.secrets.length,
        uniqueEndpoints: getUniqueEndpointCount(),
        networkCalls: state.networkCalls.length,
        subdomains: state.subdomains.length,
        websockets: state.websockets.length,
        corsIndicators: state.cors.length,
        fetchFailures: state.scripts.filter((script) => script.fetchError).length,
        totalBytes: state.totalBytes,
      },
      scripts: state.scripts.map((script) => ({
        index: script.index,
        src: script.src,
        type: script.type,
        domain: script.domain,
        sizeBytes: script.sizeBytes,
        fetchError: script.fetchError,
        errorMessage: script.errorMessage,
      })),
      secrets: state.secrets,
      endpoints: state.endpoints,
      networkCalls: state.networkCalls,
      subdomains: state.subdomains,
      websockets: state.websockets,
      corsIndicators: state.cors,
    };

    downloadText(
      `recon-report-${new Date().toISOString().split("T")[0]}.json`,
      JSON.stringify(report, null, 2),
      "application/json;charset=utf-8",
    );
    showToast("Report exported.");
  }

  async function loadDemoData() {
    if (state.isScanning) {
      return;
    }

    resetScanState();
    closeViewer();

    const demoScripts = [
      {
        src: "https://cdn.example.com/app.min.js",
        code:
          "fetch('/api/v1/users',{headers:{Authorization:'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMTIzIn0.abc123'}});\nconst API_KEY='AIzaSyD-example1234567890abcdefghijk';\nlocalStorage.setItem('token','jwt-token-here');\naxios.post('/api/auth/login',{credentials:'include'});\nnew WebSocket('wss://ws.example.com/live');\nconst STRIPE_KEY='pk_live_abcdefghijklmnopqrstuvwx';",
      },
      {
        src: "https://cdn.example.com/vendor.js",
        code:
          "axios.get('/api/v2/products');\naxios.get('/api/v2/orders');\nfetch('/graphql',{method:'POST'});\ndocument.cookie='session=abc123';\nconst AWS_KEY='AKIAIOSFODNN7EXAMPLE';",
      },
      {
        src: "https://analytics.tracker.io/track.js",
        code:
          "fetch('https://analytics.tracker.io/collect',{method:'POST',mode:'cors',credentials:'include'});\nconst SENDGRID='SG.abcdefghijk1234567890.ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234';",
      },
      {
        src: "",
        code:
          "window.__CONFIG__={apiBase:'/api/v1',wsUrl:'wss://socket.example.com',clientSecret:'super_secret_client_key_here_12345'};\nfetch('/api/v1/config');\nfetch('/auth/token');",
      },
      {
        src: "https://cdn.stripe.com/v3/",
        code:
          "Stripe('pk_live_51Htest1234567890abcdefghijk');\nfetch('/api/payment/intent',{method:'POST'});\nfetch('/api/payment/confirm',{method:'POST'});",
      },
      {
        src: "https://sub.example.com/utils.js",
        code:
          "const MONGO='mongodb+srv://admin:password123@cluster.example.mongodb.net/mydb';\nfetch('/api/admin/users');\nfetch('/api/admin/logs');\nxhr = new XMLHttpRequest();\nxhr.withCredentials = true;\nxhr.open('GET','/api/v1/reports');",
      },
    ];

    state.scripts = demoScripts.map((script, index) => ({
      index,
      key: script.src || `inline:${index}`,
      src: script.src,
      type: script.src ? "external" : "inline",
      domain: script.src ? getDomain(script.src) : "inline",
      code: script.code,
      sizeBytes: getByteSize(script.code),
      fetchError: false,
      errorMessage: "",
      async: false,
      defer: false,
    }));

    rebuildDomainMap();
    state.targetPageUrl = "https://demo.example.com/";
    state.targetHost = "demo.example.com";
    syncTargetLabel("demo.example.com");
    await analyzeScripts();
    buildGraphData();
    state.scanComplete = true;
    renderAll();
    setScanUi(false);
    showToast("Demo data loaded.");
  }

  function showBookmarklet() {
    const bookmarkletCode =
      "javascript:(()=>{const esc=(v)=>String(v).replace(/[&<>]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));const rows=[...document.scripts].map((s,i)=>'<tr><td style=\"padding:8px;border-bottom:1px solid #334155\">'+(i+1)+'</td><td style=\"padding:8px;border-bottom:1px solid #334155\">'+esc(s.src||'inline')+'</td><td style=\"padding:8px;border-bottom:1px solid #334155\">'+(new Blob([s.textContent||'']).size/1024).toFixed(1)+' KB</td></tr>').join('');const html='<body style=\"background:#0f172a;color:#e2e8f0;font-family:monospace;padding:20px\"><h2>JS Recon Snapshot</h2><table style=\"width:100%;border-collapse:collapse\">'+rows+'</table></body>';const w=window.open('','_blank');if(w){w.document.write(html);w.document.close();}})();";

    const modal = document.createElement("div");
    modal.dataset.reconModal = "true";
    modal.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;";

    const panel = document.createElement("div");
    panel.style.cssText =
      "background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:28px;max-width:640px;width:100%;";

    const title = document.createElement("h5");
    title.textContent = "Bookmarklet Generator";
    title.style.cssText = "color:var(--text-primary);margin-bottom:16px;";

    const description = document.createElement("p");
    description.textContent =
      "Drag the link below to your bookmarks bar, then click it on any page to capture a quick script inventory.";
    description.style.cssText =
      "color:var(--text-secondary);font-size:0.88rem;margin-bottom:16px;";

    const codeWrap = document.createElement("div");
    codeWrap.style.cssText =
      "background:var(--bg-deep);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:16px;";
    const codeLabel = document.createElement("div");
    codeLabel.textContent = "Bookmarklet Code";
    codeLabel.style.cssText =
      "font-size:0.75rem;color:var(--text-muted);margin-bottom:8px;";
    const codeBlock = document.createElement("div");
    codeBlock.textContent = bookmarkletCode;
    codeBlock.style.cssText =
      "font-family:monospace;font-size:0.72rem;color:var(--accent-cyan);word-break:break-all;max-height:120px;overflow-y:auto;";
    codeWrap.appendChild(codeLabel);
    codeWrap.appendChild(codeBlock);

    const actionsRow = document.createElement("div");
    actionsRow.style.cssText =
      "display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:20px;";
    const bookmarkletLink = document.createElement("a");
    bookmarkletLink.href = bookmarkletCode;
    bookmarkletLink.textContent = "JS Recon Tool";
    bookmarkletLink.style.cssText =
      "background:var(--accent-blue);color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.9rem;border:2px dashed #60a5fa;";
    const dragHint = document.createElement("span");
    dragHint.textContent = "<- Drag this to the bookmarks bar";
    dragHint.style.cssText = "color:var(--text-muted);font-size:0.82rem;";
    actionsRow.appendChild(bookmarkletLink);
    actionsRow.appendChild(dragHint);

    const note = document.createElement("div");
    note.style.cssText =
      "background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:12px;margin-bottom:16px;";
    note.innerHTML =
      '<div style="color:var(--accent-yellow);font-size:0.82rem;font-weight:600;margin-bottom:4px;">Usage Note</div><div style="color:var(--text-secondary);font-size:0.8rem;">Use this only on pages you are authorized to inspect.</div>';

    const footer = document.createElement("div");
    footer.style.cssText = "display:flex;justify-content:flex-end;gap:10px;";
    const copyButton = document.createElement("button");
    copyButton.className = "btn-outline-custom";
    copyButton.textContent = "Copy Code";
    copyButton.addEventListener("click", () => {
      copyText(bookmarkletCode, "Bookmarklet copied.");
    });
    const closeButton = document.createElement("button");
    closeButton.className = "btn-primary-custom";
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", () => {
      modal.remove();
    });
    footer.appendChild(copyButton);
    footer.appendChild(closeButton);

    panel.appendChild(title);
    panel.appendChild(description);
    panel.appendChild(codeWrap);
    panel.appendChild(actionsRow);
    panel.appendChild(note);
    panel.appendChild(footer);
    modal.appendChild(panel);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        modal.remove();
      }
    });
    document.body.appendChild(modal);
  }

  function handleGlobalClick(event) {
    const copyTarget = event.target.closest("[data-copy]");
    if (copyTarget) {
      copyText(decodeURIComponent(copyTarget.dataset.copy || ""), "Copied.");
      return;
    }

    const scriptCopy = event.target.closest("[data-script-copy]");
    if (scriptCopy) {
      copyScript(Number(scriptCopy.dataset.scriptCopy));
      return;
    }

    const scriptDownload = event.target.closest("[data-script-download]");
    if (scriptDownload) {
      downloadScript(Number(scriptDownload.dataset.scriptDownload));
      return;
    }

    const scriptRow = event.target.closest("[data-script-row]");
    if (scriptRow) {
      viewScript(Number(scriptRow.dataset.scriptRow));
      return;
    }

    const secretChip = event.target.closest("#secretFilterChips .filter-chip");
    if (secretChip) {
      toggleSecretFilter(secretChip);
      return;
    }

    const sectionTrigger = event.target.closest("[data-section]");
    if (sectionTrigger) {
      showSection(sectionTrigger.dataset.section);
      return;
    }

    const summaryTrigger = event.target.closest("[data-open-section]");
    if (summaryTrigger) {
      showSection(summaryTrigger.dataset.openSection);
      return;
    }

    const domainFilter = event.target.closest("[data-script-domain-filter]");
    if (domainFilter) {
      setScriptDomainFilter(domainFilter.dataset.scriptDomainFilter);
    }
  }

  function handleKeyboardShortcuts(event) {
    if (event.ctrlKey || event.metaKey) {
      switch (event.key) {
        case "1":
          event.preventDefault();
          showSection("overview");
          return;
        case "2":
          event.preventDefault();
          showSection("scripts");
          return;
        case "3":
          event.preventDefault();
          showSection("secrets");
          return;
        case "4":
          event.preventDefault();
          showSection("endpoints");
          return;
        case "5":
          event.preventDefault();
          showSection("network");
          return;
        case "6":
          event.preventDefault();
          showSection("subdomains");
          return;
        case "7":
          event.preventDefault();
          showSection("graph");
          return;
        case "8":
          event.preventDefault();
          showSection("deptree");
          return;
        case "9":
          event.preventDefault();
          showSection("cors");
          return;
        case "e":
        case "E":
          event.preventDefault();
          exportResults();
          return;
        default:
          break;
      }
    }

    if (event.key === "Escape") {
      closeViewer();
      document.querySelectorAll('[data-recon-modal="true"]').forEach((modal) => {
        modal.remove();
      });
    }
  }

  function injectToolbarButtons() {
    const navActions = el("navActions");
    if (!navActions) {
      return;
    }

    if (!el("loadDemoButton")) {
      const demoButton = document.createElement("button");
      demoButton.className = "btn-outline-custom";
      demoButton.id = "loadDemoButton";
      demoButton.textContent = "Load Demo";
      demoButton.addEventListener("click", () => {
        loadDemoData();
      });
      navActions.appendChild(demoButton);
    }

    if (!el("bookmarkletButton")) {
      const bookmarkletButton = document.createElement("button");
      bookmarkletButton.className = "btn-outline-custom";
      bookmarkletButton.id = "bookmarkletButton";
      bookmarkletButton.textContent = "Bookmarklet";
      bookmarkletButton.addEventListener("click", showBookmarklet);
      navActions.appendChild(bookmarkletButton);
    }
  }

  function handleResize() {
    if (state.activeSection === "graph" && state.scanComplete) {
      renderGraph();
    }
  }

  function bindStaticEvents() {
    el("scanButton")?.addEventListener("click", startScan);
    el("exportButton")?.addEventListener("click", exportResults);
    el("scriptSearch")?.addEventListener("input", filterScripts);
    el("scriptTypeFilter")?.addEventListener("change", filterScripts);
    el("copyViewerButton")?.addEventListener("click", copyViewerCode);
    el("downloadViewerButton")?.addEventListener("click", downloadViewerCode);
    el("closeViewerButton")?.addEventListener("click", closeViewer);
    el("secretSearch")?.addEventListener("input", filterSecrets);
    el("endpointSearch")?.addEventListener("input", filterEndpoints);
    el("resetGraphButton")?.addEventListener("click", resetGraph);
    el("toggleGraphLayoutButton")?.addEventListener("click", toggleGraphLayout);
  }

  async function init() {
    setScanUi(false);
    document.addEventListener("click", handleGlobalClick);
    document.addEventListener("keydown", handleKeyboardShortcuts);
    window.addEventListener("resize", handleResize);
    bindStaticEvents();
    syncGraphLayoutButton();
    injectToolbarButtons();

    if (extensionDashboardMode) {
      try {
        const target = await getStoredExtensionTarget();
        state.extensionTarget = target;
        state.targetPageUrl = target?.url || "";
        state.targetHost = target?.url ? getDomain(target.url) : "";
        syncTargetLabel(
          state.targetHost ||
            target?.title ||
            "Open the extension from a page to attach a target tab.",
        );
      } catch (error) {
        console.error(error);
        syncTargetLabel("Extension target unavailable");
      }
    } else {
      syncTargetLabel();
    }

    if (autoStartRequested) {
      try {
        await startScan();
      } catch (error) {
        console.error(error);
      }
    }
  }

  Object.assign(window, {
    startScan,
    showSection,
    exportResults,
    filterScripts,
    setScriptDomainFilter,
    viewScript,
    closeViewer,
    copyViewerCode,
    downloadViewerCode,
    copyScript,
    downloadScript,
    toggleSecretFilter,
    filterSecrets,
    filterEndpoints,
    resetGraph,
    toggleGraphLayout,
    loadDemoData,
    showBookmarklet,
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
