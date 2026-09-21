/**
 * SuperBrain Extension - YouTube Content Script
 */

(function () {
  'use strict';

  if (window.__superbrainYtLoaded) return;
  window.__superbrainYtLoaded = true;

  console.log('[SuperBrain] YouTube content script active');

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'PING') {
      sendResponse({ status: 'ok', type: 'youtube' });
      return true;
    }
    
    if (message.action === 'START_YT_SCRAPE') {
      console.log('[SuperBrain] Starting YouTube playlist scan...');
      scanPlaylist().then(videos => {
        sendResponse({ status: 'done', videos });
      }).catch(err => {
        sendResponse({ status: 'error', error: err.toString() });
      });
      return true; // Keep channel open for async
    }
  });

  async function scanPlaylist() {
    return new Promise((resolve) => {
      let videos = new Set();
      let lastCount = 0;
      let noChangeCount = 0;
      
      const scrollInterval = setInterval(() => {
        // Collect videos
        const items = document.querySelectorAll('a#video-title');
        items.forEach(a => {
          const url = new URL(a.href);
          // Standardize YouTube URL
          const videoId = url.searchParams.get('v');
          if (videoId) {
            videos.add('https://www.youtube.com/watch?v=' + videoId);
          }
        });
        
        if (videos.size > lastCount) {
          lastCount = videos.size;
          noChangeCount = 0;
          
          // Send progress
          chrome.runtime.sendMessage({
            action: 'YT_PROGRESS',
            count: videos.size
          });
        } else {
          noChangeCount++;
        }
        
        // Scroll down
        window.scrollBy(0, 1000);
        
        // Stop if no new videos after 5 scrolls
        if (noChangeCount >= 5) {
          clearInterval(scrollInterval);
          resolve(Array.from(videos));
        }
      }, 800);
    });
  }
})();
