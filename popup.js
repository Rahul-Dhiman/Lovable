(() => {
  const scanButton = document.getElementById("scanTabButton");
  const openDashboardButton = document.getElementById("openDashboardButton");
  const statusText = document.getElementById("statusText");
  const tabTitle = document.getElementById("tabTitle");
  const tabUrl = document.getElementById("tabUrl");

  let activeTab = null;

  function setStatus(message, isError = false) {
    statusText.textContent = message;
    statusText.classList.toggle("error", isError);
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

  function isScannableUrl(url) {
    return /^(https?:\/\/|file:\/\/)/i.test(url || "");
  }

  async function storeTargetTab(tab) {
    await chromeCall((callback) => {
      chrome.storage.session.set(
        {
          jsReconTarget: {
            tabId: tab.id,
            windowId: tab.windowId,
            title: tab.title || "",
            url: tab.url || "",
          },
        },
        callback,
      );
    });
  }

  async function clearTargetTab() {
    await chromeCall((callback) => {
      chrome.storage.session.remove("jsReconTarget", callback);
    });
  }

  async function openDashboard(autoStart) {
    const url = chrome.runtime.getURL(
      `resourceFetcher.html?extension=1${autoStart ? "&autostart=1" : ""}`,
    );
    await chromeCall((callback) => {
      chrome.tabs.create({ url }, callback);
    });
    window.close();
  }

  async function init() {
    try {
      const tabs = await chromeCall((callback) => {
        chrome.tabs.query({ active: true, currentWindow: true }, callback);
      });
      activeTab = tabs?.[0] || null;

      if (!activeTab) {
        tabTitle.textContent = "No active tab found";
        setStatus("Open a page and relaunch the popup.", true);
        scanButton.disabled = true;
        return;
      }

      tabTitle.textContent = activeTab.title || "Untitled tab";
      tabUrl.textContent = activeTab.url || "";

      if (isScannableUrl(activeTab.url)) {
        setStatus("Ready to attach the scanner to this tab.");
      } else {
        setStatus(
          "This page cannot be scanned directly. Open the popup on a regular web page instead.",
          true,
        );
        scanButton.disabled = true;
      }
    } catch (error) {
      console.error(error);
      tabTitle.textContent = "Extension error";
      setStatus(error.message || "Failed to inspect the active tab.", true);
      scanButton.disabled = true;
    }
  }

  scanButton.addEventListener("click", async () => {
    if (!activeTab || !isScannableUrl(activeTab.url)) {
      return;
    }
    scanButton.disabled = true;
    openDashboardButton.disabled = true;
    setStatus("Opening scanner...");
    try {
      await storeTargetTab(activeTab);
      await openDashboard(true);
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Failed to open the scanner.", true);
      scanButton.disabled = false;
      openDashboardButton.disabled = false;
    }
  });

  openDashboardButton.addEventListener("click", async () => {
    openDashboardButton.disabled = true;
    scanButton.disabled = true;
    setStatus("Opening dashboard...");
    try {
      if (activeTab && isScannableUrl(activeTab.url)) {
        await storeTargetTab(activeTab);
      } else {
        await clearTargetTab();
      }
      await openDashboard(false);
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Failed to open the dashboard.", true);
      scanButton.disabled = !isScannableUrl(activeTab?.url);
      openDashboardButton.disabled = false;
    }
  });

  init();
})();
