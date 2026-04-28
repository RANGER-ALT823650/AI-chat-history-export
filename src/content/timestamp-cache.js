(function (global) {
  "use strict";

  var namespace = (global.AIChatExporter = global.AIChatExporter || {});

  var MESSAGE_TYPE = "AI_CHAT_EXPORTER_TIMESTAMP";
  var GEMINI_DEBUG_MESSAGE_TYPE = "AI_CHAT_EXPORTER_GEMINI_DEBUG";
  var CACHE_STORAGE_KEY = "aiChatExporterTimestampCache";
  var GEMINI_DEBUG_STORAGE_KEY = "aiChatExporterGeminiDebugEvidence";
  var MAX_CACHE_SIZE = 2000;
  var MAX_GEMINI_DEBUG_ENTRIES = 200;
  var CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  // In-memory cache: conversationId → { timestamp, updatedAt, title, platform, cachedAt }
  var memoryCache = {};
  var geminiDebugEvidence = [];

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

        chrome.storage.local.get(GEMINI_DEBUG_STORAGE_KEY, function (result) {
          if (chrome.runtime.lastError) {
            return;
          }

          var stored = result && result[GEMINI_DEBUG_STORAGE_KEY];
          if (Array.isArray(stored)) {
            geminiDebugEvidence = stored.slice(-MAX_GEMINI_DEBUG_ENTRIES);
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

  function saveGeminiDebugEvidenceToStorage() {
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        var obj = {};
        obj[GEMINI_DEBUG_STORAGE_KEY] = geminiDebugEvidence.slice(-MAX_GEMINI_DEBUG_ENTRIES);
        chrome.storage.local.set(obj);
      }
    } catch (_e) {
      // Storage access error, ignore
    }
  }

  // Debounce save to avoid hammering storage
  var saveTimer = null;
  var geminiDebugSaveTimer = null;

  function scheduleSave() {
    if (saveTimer) {
      return;
    }
    saveTimer = setTimeout(function () {
      saveTimer = null;
      saveCacheToStorage();
    }, 2000);
  }

  function scheduleGeminiDebugSave() {
    if (geminiDebugSaveTimer) {
      return;
    }
    geminiDebugSaveTimer = setTimeout(function () {
      geminiDebugSaveTimer = null;
      saveGeminiDebugEvidenceToStorage();
    }, 1000);
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
      existing.cachedAt = Date.now();
      if (extra && extra.title && !existing.title) {
        existing.title = extra.title;
      }
      if (extra && extra.updatedAt) {
        existing.updatedAt = extra.updatedAt;
      }
      scheduleSave();
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

  function cacheGeminiDebugEvidence(evidence) {
    if (!evidence || evidence.platform !== "Gemini" || !Array.isArray(evidence.ids) || !evidence.ids.length) {
      return;
    }

    geminiDebugEvidence.push({
      capturedAt: String(evidence.capturedAt || new Date().toISOString()),
      source: String(evidence.source || ""),
      rpcid: String(evidence.rpcid || ""),
      url: String(evidence.url || ""),
      responseLength: Number(evidence.responseLength || 0),
      timestampCandidateCount: Number(evidence.timestampCandidateCount || 0),
      ids: evidence.ids.slice(0, 40).map(function (item) {
        return {
          conversationId: String(item.conversationId || ""),
          hitCount: Number(item.hitCount || 0),
          timestampCandidates: Array.isArray(item.timestampCandidates)
            ? item.timestampCandidates.slice(0, 12).map(function (candidate) {
              return {
                timestamp: String(candidate.timestamp || ""),
                shape: String(candidate.shape || ""),
                distanceFromConversationIdChars: Number(candidate.distanceFromConversationIdChars || 0)
              };
            })
            : []
        };
      }).filter(function (item) {
        return item.conversationId;
      })
    });

    if (geminiDebugEvidence.length > MAX_GEMINI_DEBUG_ENTRIES) {
      geminiDebugEvidence.splice(0, geminiDebugEvidence.length - MAX_GEMINI_DEBUG_ENTRIES);
    }

    scheduleGeminiDebugSave();
  }

  function getGeminiDebugEvidence(conversationId) {
    if (!conversationId) {
      return geminiDebugEvidence.slice();
    }

    return geminiDebugEvidence.filter(function (entry) {
      return entry.ids.some(function (item) {
        return item.conversationId === conversationId;
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Listen for messages from the MAIN world interceptor
  // ---------------------------------------------------------------------------

  function handleMessage(event) {
    if (!event || !event.data) {
      return;
    }

    var data = event.data;
    if (data.type === MESSAGE_TYPE) {
      cacheTimestamp(data.conversationId, data.timestamp, data.platform, {
        title: data.title || "",
        updatedAt: data.updatedAt || ""
      });
      return;
    }

    if (data.type === GEMINI_DEBUG_MESSAGE_TYPE) {
      cacheGeminiDebugEvidence(data.evidence);
    }
  }

  global.addEventListener("message", handleMessage);

  // Load persisted cache on startup
  loadCacheFromStorage();

  // ---------------------------------------------------------------------------
  // Expose API
  // ---------------------------------------------------------------------------

  namespace.TimestampCache = {
    cacheTimestamp: cacheTimestamp,
    getGeminiDebugEvidence: getGeminiDebugEvidence,
    getTimestamp: getTimestamp,
    getCacheEntry: getCacheEntry,
    getAllEntries: getAllEntries
  };
})(globalThis);
