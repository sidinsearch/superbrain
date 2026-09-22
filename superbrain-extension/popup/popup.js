/**
 * SuperBrain Extension - Popup Script
 * UI for triggering scan, import, and retry
 */

let isRunning = false;
let currentDbStats = {
  totalPosts: 0, processed: 0, pending: 0, failed: 0, collections: 0, failedItems: []
};

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await checkConnection();
  } catch(e) { console.error(e); }
  
  try {
    await loadDbStats();
  } catch(e) { console.error(e); }
  
  try {
    await loadCollections();
  } catch(e) { console.error(e); }
  
  setupEventListeners();
});

function setupEventListeners() {
  document.getElementById('scrapeBtn').addEventListener('click', startScrape);
  if (document.getElementById('youtubeScanBtn')) {
    document.getElementById('youtubeScanBtn').addEventListener('click', startYoutubeScrape);
  }
  if (document.getElementById('savePageBtn')) {
    document.getElementById('savePageBtn').addEventListener('click', saveCurrentPage);
  }
  if (document.getElementById('importBookmarksBtn')) {
    document.getElementById('importBookmarksBtn').addEventListener('click', importBookmarks);
  }
  document.getElementById('stopBtn').addEventListener('click', stopScrape);
  document.getElementById('settingsLink').addEventListener('click', openSettings);
  document.getElementById('retryFailedBtn').addEventListener('click', retryFailed);
  document.getElementById('clearFailedBtn').addEventListener('click', clearFailed);
  document.getElementById('clearDbLink').addEventListener('click', clearDatabase);
  
  // Tab switching logic
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      const tabId = e.currentTarget.getAttribute('data-tab');
      e.currentTarget.classList.add('active');
      document.getElementById(tabId).classList.add('active');
    });
  });

  chrome.runtime.onMessage.addListener(handleMessage);
}

function isSaveableUrl(url) {
  if (!url) return false;
  // Only allow standard web URLs (http/https).
  // Blocks: chrome://, chrome-extension://, edge://, about:, devtools://,
  //         view-source:, file://, data:, blob:, javascript:, etc.
  return /^https?:\/\//i.test(url);
}

async function loadCollections() {
  const result = await chrome.storage.sync.get(['serverUrl', 'apiToken']);
  if (!result.serverUrl || !result.apiToken) return;

  const trigger = document.getElementById('collectionTrigger');
  const optionsContainer = document.getElementById('collectionOptions');
  const valueDisplay = document.getElementById('collectionValue');
  const dropdown = document.getElementById('collectionDropdown');

  if (!trigger || !optionsContainer) return;

  // Toggle dropdown
  trigger.addEventListener('click', () => {
    dropdown.classList.toggle('open');
    optionsContainer.classList.toggle('hidden');
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target)) {
      dropdown.classList.remove('open');
      optionsContainer.classList.add('hidden');
    }
  });

  // Handle selection
  optionsContainer.addEventListener('click', (e) => {
    const option = e.target.closest('.select-option');
    if (!option) return;

    // Update selection UI
    optionsContainer.querySelectorAll('.select-option').forEach(opt => opt.classList.remove('selected'));
    option.classList.add('selected');

    // Update value
    valueDisplay.textContent = option.textContent.trim();
    valueDisplay.dataset.value = option.dataset.value;

    // Close dropdown
    dropdown.classList.remove('open');
    optionsContainer.classList.add('hidden');
  });

  try {
    const url = result.serverUrl.replace(/\/$/, '') + '/collections';
    const response = await fetch(url, {
      headers: { 'X-API-Key': result.apiToken }
    });
    const data = await response.json();
    
    if (data.success && data.data && data.data.length > 0) {
      // Keep default collection, append others
      const defaultOption = '<div class="select-option selected" data-value=""><span class="option-icon">📁</span> Unsorted</div>';
      optionsContainer.innerHTML = defaultOption;
      
      const ICON_MAP = {
        'folder': '📁', 'airplane': '✈️', 'restaurant': '🍽️', 'shirt': '👕', 
        'fitness': '💪', 'book': '📚', 'film': '🎬', 'camera': '📷', 
        'star': '⭐', 'heart': '❤️', 'flame': '🔥', 'pin': '📍', 'time': '🕒'
      };
      
      data.data.forEach(col => {
        const div = document.createElement('div');
        div.className = 'select-option';
        div.dataset.value = col.id;
        const iconEmoji = ICON_MAP[col.icon] || '📁';
        div.innerHTML = `<span class="option-icon">${iconEmoji}</span> ${escapeHtml(col.name)}`;
        optionsContainer.appendChild(div);
      });
    }
  } catch (error) {
    console.error('Failed to load collections:', error);
  }
}

async function saveCurrentPage() {
  const btn = document.getElementById('savePageBtn');
  const spinner = document.getElementById('savePageSpinner');
  const btnText = document.getElementById('savePageText');
  const valueDisplay = document.getElementById('collectionValue');
  
  if (btn.disabled) return;
  
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) return;
    
    const url = tabs[0].url;
    if (!isSaveableUrl(url)) {
      addLog('Cannot save browser internal pages', 'error');
      return;
    }

    const { serverUrl, apiToken } = await chrome.storage.sync.get(['serverUrl', 'apiToken']);
    if (!serverUrl || !apiToken) return;

    btn.disabled = true;
    spinner.classList.remove('hidden');
    btnText.textContent = 'Saving...';
    
    addLog(`Saving: ${tabs[0].title}`, 'info');

    // 1. Analyze page
    const apiUrl = serverUrl.replace(/\/$/, '') + '/analyze';
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-API-Key': apiToken 
      },
      body: JSON.stringify({ url: url, force: false })
    });

    const data = await response.json();
    
    if (response.ok && data.shortcode) {
      addLog(`Saved successfully`, 'success');
      
      // 2. Add to collection if selected
      const collectionId = valueDisplay ? valueDisplay.dataset.value : '';
      if (collectionId) {
        await addPostToCollection(collectionId, data.shortcode, serverUrl, apiToken);
      }
      
      await loadDbStats();
    } else {
      addLog(`Failed to save: ${data.detail || 'Unknown error'}`, 'error');
    }
  } catch (error) {
    addLog(`Error: ${error.message}`, 'error');
  } finally {
    btn.disabled = false;
    spinner.classList.add('hidden');
    btnText.textContent = 'Save Current Page';
  }
}

async function addPostToCollection(collectionId, shortcode, serverUrl, apiToken) {
  try {
    const baseUrl = serverUrl.replace(/\/$/, '');
    
    // Fetch current collection
    const getRes = await fetch(`${baseUrl}/collections`, {
      headers: { 'X-API-Key': apiToken }
    });
    const data = await getRes.json();
    const collection = data.data?.find(c => c.id === collectionId);
    
    if (collection) {
      const postIds = new Set(collection.post_ids || []);
      if (!postIds.has(shortcode)) {
        postIds.add(shortcode);
        
        await fetch(`${baseUrl}/collections/${collectionId}/posts`, {
          method: 'PUT',
          headers: { 
            'Content-Type': 'application/json',
            'X-API-Key': apiToken 
          },
          body: JSON.stringify({ post_ids: Array.from(postIds) })
        });
        addLog(`Added to collection ${collection.name}`, 'success');
      }
    }
  } catch (err) {
    console.error('Collection add failed:', err);
  }
}

// ... rest of the code down to checkConnection()


async function checkConnection() {
  const result = await chrome.storage.sync.get(["serverUrl", "apiToken"]);
  const statusDot = document.getElementById("statusDot");
  const serverInfo = document.getElementById("serverInfo");
  const scrapeBtn = document.getElementById("scrapeBtn");

  if (!result.serverUrl || !result.apiToken) {
    if (statusDot) statusDot.classList.remove("connected");
    if (serverInfo) {
      serverInfo.textContent = "Configure in settings";
      serverInfo.classList.add("error");
    }
    if (scrapeBtn) scrapeBtn.disabled = true;
    return false;
  }

  const serverUrl = result.serverUrl.replace(/\/$/, "");
  if (serverInfo) {
    serverInfo.textContent = serverUrl;
    serverInfo.classList.remove("error");
  }

  try {
    const response = await fetch(`${serverUrl}/ping`, {
      method: "GET",
      headers: { "X-API-Key": result.apiToken }
    });
    if (response.ok) {
      if (statusDot) statusDot.classList.add("connected");
      if (scrapeBtn) scrapeBtn.disabled = false;
      addLog("Connected to SuperBrain", "success");
      return true;
    } else {
      throw new Error("Server error");
    }
  } catch (error) {
    if (statusDot) statusDot.classList.remove("connected");
    if (serverInfo) {
      serverInfo.textContent = "Connection failed";
      serverInfo.classList.add("error");
    }
    if (scrapeBtn) scrapeBtn.disabled = true;
    addLog("Server connection failed", "error");
    return false;
  }
}
async function loadDbStats() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url || !tab.url.includes('instagram.com')) {
    updateDbStatsUI(currentDbStats);
    return;
  }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_DB_STATS' });
    if (response) {
      currentDbStats = response;
      updateDbStatsUI(response);
    }
  } catch (error) {
    console.log('Could not load DB stats (content script may not be injected yet)');
  }
}

function updateDbStatsUI(stats) {
  document.getElementById('dbTotal').textContent = stats.totalPosts || 0;
  document.getElementById('dbSaved').textContent = stats.processed || 0;
  document.getElementById('dbPending').textContent = stats.pending || 0;
  document.getElementById('dbFailed').textContent = stats.failed || 0;
  document.getElementById('dbCollections').textContent = stats.collections || 0;
  document.getElementById('failedCount').textContent = stats.failed || 0;

  const retryBtn = document.getElementById('retryFailedBtn');
  const clearBtn = document.getElementById('clearFailedBtn');
  retryBtn.disabled = !(stats.failed > 0);
  clearBtn.disabled = !(stats.failed > 0);

  updateFailedList(stats.failedItems || []);
}

function updateFailedList(failedItems) {
  const list = document.getElementById('failedList');
  if (!failedItems || failedItems.length === 0) {
    list.innerHTML = '<div class="failed-empty">No failed posts</div>';
    return;
  }
  list.innerHTML = failedItems.slice(0, 5).map(item => `
    <div class="failed-item">
      <span class="failed-shortcode">${item.shortcode?.substring(0, 12) || '?'}...</span>
      <span class="failed-error">${escapeHtml((item.error || 'Unknown error').substring(0, 40))}</span>
    </div>
  `).join('');
  if (failedItems.length > 5) {
    list.innerHTML += `<div class="failed-more">+${failedItems.length - 5} more</div>`;
  }
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'GET_DB_STATS' });
    return true;
  } catch (e) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content/content.js'] });
      await chrome.scripting.insertCSS({ target: { tabId }, files: ['content/content.css'] });
      await new Promise(r => setTimeout(r, 500));
      return true;
    } catch (err) {
      console.error('Failed to inject content script:', err);
      return false;
    }
  }
}

async function startScrape() {
  if (isRunning) return;

  const result = await chrome.storage.sync.get(['serverUrl', 'apiToken']);
  if (!result.serverUrl || !result.apiToken) {
    addLog('Configure settings first', 'error');
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url || !tab.url.includes('instagram.com')) {
    addLog('Navigate to Instagram first', 'error');
    return;
  }
  if (!tab.url.includes('/saved')) {
    addLog('Navigate to your Instagram Saved page first', 'error');
    addLog('Go to: Profile → ☰ → Saved', 'info');
    return;
  }

  isRunning = true;
  updateRunningUI(true);
  addLog('Starting scan...', 'info');

  try {
    const injected = await ensureContentScript(tab.id);
    if (!injected) throw new Error('Could not inject content script');

    chrome.tabs.sendMessage(tab.id, {
      action: 'START_SCRAPE',
      settings: {
        serverUrl: result.serverUrl.replace(/\/$/, ''),
        apiToken: result.apiToken
      }
    }, (response) => {
      if (chrome.runtime.lastError) {
        addLog('Failed: ' + chrome.runtime.lastError.message, 'error');
        isRunning = false;
        updateRunningUI(false);
      }
    });
  } catch (error) {
    addLog('Failed to start: ' + error.message, 'error');
    isRunning = false;
    updateRunningUI(false);
  }
}

async function stopScrape() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab.id) {
    try { chrome.tabs.sendMessage(tab.id, { action: 'STOP_SCRAPE' }); } catch (e) {}
  }
  isRunning = false;
  updateRunningUI(false);
  addLog('Stopped by user', 'info');
}

function updateRunningUI(running) {
  const scrapeBtn = document.getElementById('scrapeBtn');
  const scrapeSpinner = document.getElementById('scrapeSpinner');
  const scrapeBtnText = document.getElementById('scrapeBtnText');
  const stopBtn = document.getElementById('stopBtn');
  const progressSection = document.getElementById('progressSection');

  if (running) {
    scrapeBtn.disabled = true;
    scrapeSpinner.classList.remove('hidden');
    scrapeBtnText.textContent = 'Running...';
    stopBtn.classList.remove('hidden');
    progressSection.classList.remove('hidden');
  } else {
    scrapeBtn.disabled = false;
    scrapeSpinner.classList.add('hidden');
    scrapeBtnText.textContent = 'Scan Instagram Saved';
    stopBtn.classList.add('hidden');
    progressSection.classList.add('hidden');
    isRunning = false;
  }
}

function handleMessage(message) {
  switch (message.type) {
    case 'IMPORT_LOG':
      addLog(message.message, message.level);
      break;
    case 'IMPORT_PROGRESS':
      updateProgress(message.current, message.total, message.currentItem);
      break;
    case 'DB_STATS_UPDATE':
      if (message.stats) {
        currentDbStats = { ...currentDbStats, ...message.stats };
        updateDbStatsUI(currentDbStats);
      }
      break;
    case 'IMPORT_COMPLETE':
      addLog(`Complete! Saved: ${message.stats.saved}, Failed: ${message.stats.failed}`, 'success');
      isRunning = false;
      updateRunningUI(false);
      loadDbStats();
      break;
  }
}

function updateProgress(current, total, currentItem) {
  const progressFill = document.getElementById('progressFill');
  const progressCount = document.getElementById('progressCount');
  const progressDetail = document.getElementById('progressDetail');
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  progressFill.style.width = `${pct}%`;
  progressCount.textContent = `${current} / ${total}`;
  progressDetail.textContent = currentItem || 'Processing...';
}

async function retryFailed() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url || !tab.url.includes('instagram.com')) {
    addLog('Open Instagram page to retry', 'error');
    return;
  }

  try {
    const injected = await ensureContentScript(tab.id);
    if (!injected) { addLog('Could not inject into page', 'error'); return; }

    const response = await chrome.tabs.sendMessage(tab.id, { action: 'RETRY_FAILED' });
    if (response && response.success) {
      addLog(`Reset ${response.count} failed posts to pending`, 'info');
      await loadDbStats();

      // Now trigger import (not scrape — we already have the data)
      isRunning = true;
      updateRunningUI(true);
      chrome.tabs.sendMessage(tab.id, { action: 'START_IMPORT' });
    }
  } catch (error) {
    addLog('Failed to retry: ' + error.message, 'error');
  }
}

async function clearFailed() {
  const confirmed = confirm('Clear all local data (posts & collections)?');
  if (!confirmed) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab.url && tab.url.includes('instagram.com')) {
    try { await chrome.tabs.sendMessage(tab.id, { action: 'CLEAR_DB' }); } catch (e) {}
  }
  try { await chrome.storage.local.remove(['superbrain_db', 'sb_scrape_state']); } catch (e) {}

  currentDbStats = { totalPosts: 0, processed: 0, pending: 0, failed: 0, collections: 0, failedItems: [] };
  updateDbStatsUI(currentDbStats);
  addLog('Database cleared', 'info');
}

async function clearDatabase(e) {
  e.preventDefault();
  const confirmed = confirm('Clear ALL local data? This cannot be undone.');
  if (!confirmed) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab.url && tab.url.includes('instagram.com')) {
    try { await chrome.tabs.sendMessage(tab.id, { action: 'CLEAR_DB' }); } catch (e) {}
  }
  try { await chrome.storage.local.remove(['superbrain_db', 'sb_scrape_state', 'sb_pending_scrape']); } catch (e) {}

  currentDbStats = { totalPosts: 0, processed: 0, pending: 0, failed: 0, collections: 0, failedItems: [] };
  updateDbStatsUI(currentDbStats);
  addLog('All data cleared', 'info');
}

function addLog(message, level = 'info') {
  const logEntries = document.getElementById('logEntries');
  const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-message ${level}">${escapeHtml(message)}</span>
  `;
  logEntries.insertBefore(entry, logEntries.firstChild);
  while (logEntries.children.length > 50) logEntries.removeChild(logEntries.lastChild);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function openSettings(e) {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
}

async function startYoutubeScrape() {
  const btn = document.getElementById('youtubeScanBtn');
  const spinner = document.getElementById('youtubeSpinner');
  const btnText = document.getElementById('youtubeBtnText');
  
  if (btn.disabled) return;
  
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) return;
    
    const tabId = tabs[0].id;
    const url = tabs[0].url;
    
    if (!url.includes('youtube.com/playlist') && !url.includes('youtube.com/watch')) {
      addLog('Not a YouTube playlist page', 'error');
      return;
    }

    btn.disabled = true;
    spinner.classList.remove('hidden');
    btnText.textContent = 'Scanning...';
    
    addLog('Scanning YouTube playlist...', 'info');

    chrome.tabs.sendMessage(tabId, { action: 'START_YT_SCRAPE' }, async (response) => {
      if (chrome.runtime.lastError || !response) {
        addLog('Failed to connect to YouTube. Refresh page.', 'error');
        resetYoutubeBtn();
        return;
      }
      
      if (response.status === 'done') {
        addLog(`Found ${response.videos.length} videos.`, 'success');
        await sendYoutubeVideosToBackend(response.videos, tabs[0].title);
      } else {
        addLog(`Error: ${response.error}`, 'error');
      }
      resetYoutubeBtn();
    });
  } catch (error) {
    addLog(`Error: ${error.message}`, 'error');
    resetYoutubeBtn();
  }
}

function resetYoutubeBtn() {
  const btn = document.getElementById('youtubeScanBtn');
  const spinner = document.getElementById('youtubeSpinner');
  const btnText = document.getElementById('youtubeBtnText');
  btn.disabled = false;
  spinner.classList.add('hidden');
  btnText.textContent = 'Scan YouTube Playlist';
}

async function sendYoutubeVideosToBackend(videos, playlistTitle) {
  if (videos.length === 0) return;

  const { serverUrl, apiToken } = await chrome.storage.sync.get(['serverUrl', 'apiToken']);
  if (!serverUrl || !apiToken) return;

  const apiUrl = serverUrl.replace(/\/$/, '') + '/analyze';
  
  // Try to determine collection name
  let collectionName = playlistTitle.replace(' - YouTube', '').trim();
  if (collectionName.toLowerCase() === 'watch later') {
    collectionName = 'Watch Later';
  }
  
  addLog(`Importing ${videos.length} videos to ${collectionName}...`, 'info');
  
  // Create collection on server if needed (this would normally use a dedicated endpoint)
  // For now, we process videos one by one.
  
  let successCount = 0;
  for (let i = 0; i < videos.length; i++) {
    const url = videos[i];
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-API-Key': apiToken 
        },
        body: JSON.stringify({ url: url, force: false })
      });
      
      if (response.ok) {
        successCount++;
        // If we want to add to collection, we'd do it here like in saveCurrentPage
      }
    } catch (e) {
      console.error('Failed to save', url, e);
    }
    
    // Update progress log occasionally
    if ((i + 1) % 5 === 0 || i === videos.length - 1) {
      addLog(`Saved ${successCount}/${videos.length} videos.`, 'info');
    }
  }
  
  addLog(`Done! Successfully imported ${successCount} videos.`, 'success');
  loadDbStats();
}

async function importBookmarks() {
  const { serverUrl, apiToken } = await chrome.storage.sync.get(['serverUrl', 'apiToken']);
  if (!serverUrl || !apiToken) {
    addLog('Server not configured', 'error');
    return;
  }

  addLog('Scanning bookmarks...', 'info');

  try {
    chrome.bookmarks.getTree(async (bookmarkTreeNodes) => {
      const urls = [];
      
      function extractUrls(nodes) {
        for (const node of nodes) {
          if (node.url && (node.url.startsWith('http://') || node.url.startsWith('https://'))) {
            urls.push(node.url);
          }
          if (node.children) {
            extractUrls(node.children);
          }
        }
      }
      
      extractUrls(bookmarkTreeNodes);
      
      if (urls.length === 0) {
        addLog('No bookmarks found', 'warning');
        return;
      }
      
      addLog(`Found ${urls.length} bookmarks. Sending to server...`, 'info');
      
      const apiUrl = serverUrl.replace(/\/$/, '') + '/analyze';
      let successCount = 0;
      
      // Batch processing would be better here, but we'll do sequential for simplicity
      // In a real scenario, we'd send these to a background worker queue
      addLog(`Import running in background.`, 'info');
      
      // Send message to background script to handle the massive queue so popup can close
      chrome.runtime.sendMessage({
        action: 'IMPORT_URLS',
        urls: urls
      });
      
    });
  } catch (error) {
    addLog(`Error reading bookmarks: ${error.message}`, 'error');
  }
}

