(function (global) {
  "use strict";

  var namespace = (global.AIChatExporter = global.AIChatExporter || {});

  var MESSAGE_TYPE = "AI_CHAT_EXPORTER_TIMESTAMP";
  var CACHE_STORAGE_KEY = "aiChatExporterTimestampCache";
  var MAX_CACHE_SIZE = 2000;
  var CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  // In-memory cache: conversationId → { timestamp, updatedAt, title, platform, cachedAt }
  var memoryCache = {};

  // ---------------------------------------------------------------------------
  // Persistence via chrome.storage.local
  // ---------------------------------------------------------------------------

  function loadCacheFromStorage() {
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(CACHE_STORAGE_KEY, function (result) {
          if (chrome.runtime.lastError) {
            return;
          }

          var stored = result && result[CACHE_STORAGE_KEY];
          if (stored && typeof stored === "object") {
            var now = Date.now();
            var keys = Object.keys(stored);
            for (var i = 0; i < keys.length; i++) {
              var entry = stored[keys[i]];
              if (entry && entry.timestamp && (!entry.cachedAt || now - entry.cachedAt < CACHE_TTL_MS)) {
                memoryCache[keys[i]] = entry;
              }
            }
          }
        });
      }
    } catch (_e) {
      // Storage access error, ignore
    }
  }

  function saveCacheToStorage() {
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        // Evict old entries if cache is too large
        var keys = Object.keys(memoryCache);
        if (keys.length > MAX_CACHE_SIZE) {
          var entries = keys.map(function (key) {
            return { key: key, cachedAt: memoryCache[key].cachedAt || 0 };
          });
          entries.sort(function (a, b) { return a.cachedAt - b.cachedAt; });

          var toRemove = entries.slice(0, keys.length - MAX_CACHE_SIZE);
          for (var i = 0; i < toRemove.length; i++) {
            delete memoryCache[toRemove[i].key];
          }
        }

        var obj = {};
        obj[CACHE_STORAGE_KEY] = memoryCache;
        chrome.storage.local.set(obj);
      }
    } catch (_e) {
      // Storage access error, ignore
    }
  }

  // Debounce save to avoid hammering storage
  var saveTimer = null;

  function scheduleSave() {
    if (saveTimer) {
      return;
    }
    saveTimer = setTimeout(function () {
      saveTimer = null;
      saveCacheToStorage();
    }, 2000);
  }

  // ---------------------------------------------------------------------------
  // Cache operations
  // ---------------------------------------------------------------------------

  function cacheTimestamp(conversationId, timestamp, platform, extra) {
    if (!conversationId || !timestamp) {
      return;
    }

    var existing = memoryCache[conversationId];
    // Prefer earlier (creation) timestamps, but update title/updatedAt
    if (existing && existing.timestamp && existing.timestamp <= timestamp) {
      if (extra && extra.title && !existing.title) {
        existing.title = extra.title;
      }
      if (extra && extra.updatedAt) {
        existing.updatedAt = extra.updatedAt;
      }
      return;
    }

    memoryCache[conversationId] = {
      timestamp: timestamp,
      updatedAt: (extra && extra.updatedAt) || "",
      title: (extra && extra.title) || "",
      platform: platform || "",
      cachedAt: Date.now()
    };

    scheduleSave();
  }

  function getTimestamp(conversationId) {
    if (!conversationId) {
      return "";
    }

    var entry = memoryCache[conversationId];
    return entry && entry.timestamp ? entry.timestamp : "";
  }

  function getCacheEntry(conversationId) {
    return conversationId ? memoryCache[conversationId] || null : null;
  }

  function getAllEntries() {
    return memoryCache;
  }

  // ---------------------------------------------------------------------------
  // Listen for messages from the MAIN world interceptor
  // ---------------------------------------------------------------------------

  function handleMessage(event) {
    if (!event || !event.data || event.data.type !== MESSAGE_TYPE) {
      return;
    }

    var data = event.data;
    cacheTimestamp(data.conversationId, data.timestamp, data.platform, {
      title: data.title || "",
      updatedAt: data.updatedAt || ""
    });
  }

  global.addEventListener("message", handleMessage);

  // Load persisted cache on startup
  loadCacheFromStorage();

  // ---------------------------------------------------------------------------
  // Expose API
  // ---------------------------------------------------------------------------

  namespace.TimestampCache = {
    cacheTimestamp: cacheTimestamp,
    getTimestamp: getTimestamp,
    getCacheEntry: getCacheEntry,
    getAllEntries: getAllEntries
  };
})(globalThis);
