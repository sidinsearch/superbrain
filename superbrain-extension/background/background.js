/**
 * SuperBrain Extension - Background Service Worker
 * Relays messages between content scripts and popup
 */

// Relay messages from content script to popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // These message types come from the content script and need to reach the popup
  if (message.type === 'IMPORT_LOG' || 
      message.type === 'IMPORT_PROGRESS' ||
      message.type === 'DB_STATS_UPDATE' ||
      message.type === 'IMPORT_COMPLETE' ||
      message.type === 'IMPORT_ERROR') {
    return;
  }
  
  if (message.action === 'IMPORT_URLS') {
    processUrlsQueue(message.urls);
    sendResponse({ status: 'started' });
    return true;
  }
});

async function processUrlsQueue(urls) {
  const { serverUrl, apiToken } = await chrome.storage.sync.get(['serverUrl', 'apiToken']);
  if (!serverUrl || !apiToken) return;

  const apiUrl = serverUrl.replace(/\/$/, '') + '/analyze';
  
  console.log(`[SuperBrain] Starting background import of ${urls.length} URLs`);
  
  // Process sequentially to not overwhelm server
  for (let i = 0; i < urls.length; i++) {
    try {
      await fetch(apiUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-API-Key': apiToken 
        },
        body: JSON.stringify({ url: urls[i], force: false })
      });
      // Sleep slightly to prevent DOS
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.error('[SuperBrain] Failed to import', urls[i], e);
    }
  }
  
  console.log(`[SuperBrain] Background import complete`);
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('SuperBrain Extension installed');
});
