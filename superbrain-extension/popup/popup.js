/**
 * SuperBrain Extension - Popup Script
 * UI for triggering scan, import, and retry
 */

let isRunning = false;
let isConnected = false;
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

async function updatePlatformButtons() {
  const scrapeBtn = document.getElementById('scrapeBtn');
  const youtubeBtn = document.getElementById('youtubeScanBtn');
  const bookmarksBtn = document.getElementById('importBookmarksBtn');

  let url = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    url = tab && tab.url ? tab.url : '';
  } catch (e) {
    console.error(e);
  }

  const onInstagramSaved = /instagram\.com.*\/saved/i.test(url);
  const onYouTubePlaylist = /youtube\.com\/(playlist|feed\/playlists)/i.test(url) || /youtube\.com\/watch\?[^#]*list=WL/i.test(url);

  if (scrapeBtn) scrapeBtn.disabled = !(isConnected && onInstagramSaved && !isRunning);
  if (youtubeBtn) youtubeBtn.disabled = !(isConnected && onYouTubePlaylist && !isRunning);
  if (bookmarksBtn) {
    const { serverUrl, apiToken } = await chrome.storage.sync.get(['serverUrl', 'apiToken']);
    bookmarksBtn.disabled = !(serverUrl && apiToken);
  }
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

    // Update value - grab just the text part, not the icon
    const textSpan = option.querySelector('.option-text');
    if (textSpan) {
      valueDisplay.textContent = textSpan.textContent.trim();
    } else {
      valueDisplay.textContent = option.textContent.trim();
    }
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
      const defaultIcon = typeof SVG_ICONS !== 'undefined' && SVG_ICONS['folder'] ? SVG_ICONS['folder'] : '';
      const defaultOption = `<div class="select-option selected" data-value=""><span class="option-icon">${defaultIcon}</span> <span class="option-text">Unsorted</span></div>`;
      optionsContainer.innerHTML = defaultOption;
      
      data.data.forEach(col => {
        const div = document.createElement('div');
        div.className = 'select-option';
        div.dataset.value = col.id;
        
        let iconContent = typeof SVG_ICONS !== 'undefined' && SVG_ICONS['folder'] ? SVG_ICONS['folder'] : '';
        if (typeof SVG_ICONS !== 'undefined' && SVG_ICONS[col.icon]) {
          iconContent = SVG_ICONS[col.icon];
        }
        
        div.innerHTML = `<span class="option-icon">${iconContent}</span> <span class="option-text">${escapeHtml(col.name)}</span>`;
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

  if (!result.serverUrl || !result.apiToken) {
    isConnected = false;
    if (statusDot) statusDot.classList.remove("connected");
    if (serverInfo) {
      serverInfo.textContent = "Configure in settings";
      serverInfo.classList.add("error");
    }
    updatePlatformButtons();
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
      isConnected = true;
      if (statusDot) statusDot.classList.add("connected");
      addLog("Connected to SuperBrain", "success");
      updatePlatformButtons();
      return true;
    } else {
      throw new Error("Server error");
    }
  } catch (error) {
    isConnected = false;
    if (statusDot) statusDot.classList.remove("connected");
    if (serverInfo) {
      serverInfo.textContent = "Connection failed";
      serverInfo.classList.add("error");
    }
    updatePlatformButtons();
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
  const dbCollections = document.getElementById('dbCollections');
  if (dbCollections) dbCollections.textContent = stats.collections || 0;
  const failedCount = document.getElementById('failedCount');
  if (failedCount) failedCount.textContent = stats.failed || 0;

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
  const stopBtn = document.getElementById('stopBtn');
  const progressSection = document.getElementById('progressSection');

  if (running) {
    scrapeBtn.disabled = true;
    scrapeSpinner.classList.remove('hidden');
    stopBtn.classList.remove('hidden');
    progressSection.classList.remove('hidden');
  } else {
    scrapeSpinner.classList.add('hidden');
    stopBtn.classList.add('hidden');
    progressSection.classList.add('hidden');
    isRunning = false;
    updatePlatformButtons();
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
  
  if (btn.disabled) return;
  
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) return;
    
    const tabId = tabs[0].id;
    const url = tabs[0].url;
    
    if (!/youtube\.com\/(playlist|feed\/playlists)/i.test(url || '') && !/youtube\.com\/watch\?[^#]*list=WL/i.test(url || '')) {
      addLog('Not a YouTube playlist or Watch Later page', 'error');
      return;
    }

    btn.disabled = true;
    spinner.classList.remove('hidden');
    
    addLog('Scanning YouTube playlist...', 'info');

    chrome.tabs.sendMessage(tabId, { action: 'START_YT_SCRAPE' }, async (response) => {
      if (chrome.runtime.lastError || !response) {
        addLog('Failed to connect to YouTube. Refresh page.', 'error');
        resetYoutubeBtn();
        return;
      }
      
      if (response.status === 'done') {
        addLog(`Found ${response.videos.length} items.`, 'success');
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
  spinner.classList.add('hidden');
  updatePlatformButtons();
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

let flatBookmarks = [];

async function importBookmarks() {
  const picker = document.getElementById('bookmarkPicker');
  if (!picker) return;

  const { serverUrl, apiToken } = await chrome.storage.sync.get(['serverUrl', 'apiToken']);
  const errorSpan = document.getElementById('bookmarkError');
  const importBtn = document.getElementById('importSelectedBookmarksBtn');
  
  if (!serverUrl || !apiToken) {
    errorSpan.textContent = 'Server not configured. Please set URL and Token in options.';
    errorSpan.classList.remove('hidden');
    importBtn.disabled = true;
  } else {
    errorSpan.classList.add('hidden');
    importBtn.disabled = false;
  }

  picker.classList.remove('hidden');
  document.getElementById('bookmarkPickerList').innerHTML = '<div class="picker-empty">Loading bookmarks...</div>';

  chrome.bookmarks.getTree((bookmarkTreeNodes) => {
    flatBookmarks = [];
    
    function extractUrls(nodes, path = '') {
      for (const node of nodes) {
        if (node.url && (node.url.startsWith('http://') || node.url.startsWith('https://'))) {
          flatBookmarks.push({
            id: node.id,
            title: node.title || node.url,
            url: node.url,
            folder: path || 'Other Bookmarks'
          });
        }
        if (node.children) {
          const newPath = node.title ? (path ? `${path} › ${node.title}` : node.title) : path;
          extractUrls(node.children, newPath);
        }
      }
    }
    
    extractUrls(bookmarkTreeNodes);
    renderBookmarkPicker(flatBookmarks);
  });
}

function renderBookmarkPicker(bookmarks) {
  const listEl = document.getElementById('bookmarkPickerList');
  const searchInput = document.getElementById('bookmarkSearchInput');
  const query = (searchInput.value || '').toLowerCase();
  
  const filtered = bookmarks.filter(b => 
    b.title.toLowerCase().includes(query) || 
    b.url.toLowerCase().includes(query) ||
    b.folder.toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="picker-empty">No bookmarks found.</div>';
    updateBookmarkCounts();
    return;
  }

  const grouped = {};
  filtered.forEach(b => {
    if (!grouped[b.folder]) grouped[b.folder] = [];
    grouped[b.folder].push(b);
  });

  listEl.innerHTML = '';
  
  Object.keys(grouped).sort().forEach(folder => {
    const folderGroup = document.createElement('div');
    folderGroup.className = 'picker-folder';
    folderGroup.dataset.folder = folder;

    const folderHeader = document.createElement('div');
    folderHeader.className = 'picker-folder-header';
    
    const folderCheckbox = document.createElement('input');
    folderCheckbox.type = 'checkbox';
    folderCheckbox.className = 'picker-checkbox folder-checkbox';
    folderCheckbox.checked = true; // default all checked
    
    folderHeader.appendChild(folderCheckbox);
    folderHeader.insertAdjacentHTML('beforeend', `
      <svg class="picker-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
      <span>${escapeHtml(folder)}</span>
    `);
    
    folderGroup.appendChild(folderHeader);

    grouped[folder].forEach(b => {
      const itemEl = document.createElement('label');
      itemEl.className = 'picker-item';
      
      const host = new URL(b.url).hostname;
      const faviconUrl = \`https://www.google.com/s2/favicons?domain=\${host}&sz=16\`;
      
      itemEl.innerHTML = \`
        <input type="checkbox" class="picker-checkbox item-checkbox" value="\${escapeHtml(b.url)}" checked>
        <img src="\${faviconUrl}" class="picker-item-favicon" onerror="this.style.display='none'">
        <div class="picker-item-info">
          <div class="picker-item-title">\${escapeHtml(b.title)}</div>
          <div class="picker-item-url">\${escapeHtml(b.url)}</div>
        </div>
      \`;
      folderGroup.appendChild(itemEl);
    });

    listEl.appendChild(folderGroup);
  });
  
  setupBookmarkPickerEvents();
  updateBookmarkCounts();
}

function setupBookmarkPickerEvents() {
  const listEl = document.getElementById('bookmarkPickerList');
  
  listEl.querySelectorAll('.folder-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const folderGroup = e.target.closest('.picker-folder');
      const itemCheckboxes = folderGroup.querySelectorAll('.item-checkbox');
      itemCheckboxes.forEach(item => item.checked = e.target.checked);
      updateBookmarkCounts();
    });
  });

  listEl.querySelectorAll('.item-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const folderGroup = e.target.closest('.picker-folder');
      const itemCheckboxes = Array.from(folderGroup.querySelectorAll('.item-checkbox'));
      const folderCheckbox = folderGroup.querySelector('.folder-checkbox');
      
      const checkedCount = itemCheckboxes.filter(i => i.checked).length;
      if (checkedCount === 0) {
        folderCheckbox.checked = false;
        folderCheckbox.indeterminate = false;
      } else if (checkedCount === itemCheckboxes.length) {
        folderCheckbox.checked = true;
        folderCheckbox.indeterminate = false;
      } else {
        folderCheckbox.checked = false;
        folderCheckbox.indeterminate = true;
      }
      updateBookmarkCounts();
    });
  });
}

function updateBookmarkCounts() {
  const listEl = document.getElementById('bookmarkPickerList');
  const allBoxes = Array.from(listEl.querySelectorAll('.item-checkbox'));
  const selectedCount = allBoxes.filter(cb => cb.checked).length;
  const totalCount = allBoxes.length;

  document.getElementById('pickerSelectedCount').textContent = \`\${selectedCount} selected\`;
  document.getElementById('pickerTotalCount').textContent = \`\${totalCount} available\`;
  document.getElementById('importSelectedCount').textContent = selectedCount;

  const importBtn = document.getElementById('importSelectedBookmarksBtn');
  if (importBtn && !document.getElementById('bookmarkError').textContent) {
    importBtn.disabled = selectedCount === 0;
  }
}

// Bind Picker Buttons
document.getElementById('pickerBackBtn')?.addEventListener('click', () => {
  document.getElementById('bookmarkPicker').classList.add('hidden');
});

document.getElementById('bookmarkSearchInput')?.addEventListener('input', () => {
  renderBookmarkPicker(flatBookmarks);
});

document.getElementById('selectAllBookmarksBtn')?.addEventListener('click', () => {
  document.querySelectorAll('#bookmarkPickerList .item-checkbox').forEach(cb => cb.checked = true);
  document.querySelectorAll('#bookmarkPickerList .folder-checkbox').forEach(cb => {
    cb.checked = true;
    cb.indeterminate = false;
  });
  updateBookmarkCounts();
});

document.getElementById('selectNoneBookmarksBtn')?.addEventListener('click', () => {
  document.querySelectorAll('#bookmarkPickerList .item-checkbox').forEach(cb => cb.checked = false);
  document.querySelectorAll('#bookmarkPickerList .folder-checkbox').forEach(cb => {
    cb.checked = false;
    cb.indeterminate = false;
  });
  updateBookmarkCounts();
});

document.getElementById('importSelectedBookmarksBtn')?.addEventListener('click', () => {
  const checkedBoxes = Array.from(document.querySelectorAll('#bookmarkPickerList .item-checkbox:checked'));
  const urls = checkedBoxes.map(cb => cb.value);
  
  if (urls.length === 0) return;

  document.getElementById('bookmarkPicker').classList.add('hidden');
  addLog(\`Starting import of \${urls.length} selected bookmarks...\`, 'info');

  chrome.runtime.sendMessage({ action: 'IMPORT_URLS', urls: urls }, (response) => {
    if (chrome.runtime.lastError || !response || response.status !== 'started') {
      addLog('Failed to start bookmarks import', 'error');
      return;
    }
    addLog(\`Queued \${response.total || urls.length} bookmarks.\`, 'success');
  });
});

  }
}

