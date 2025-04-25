/**
 * /js/features/torrent-monitoring.js
 * Functions for monitoring torrent status, metadata, and progress
 */

import apiClient from '../core/api-client.js';
import * as Utils from '../core/utils.js';
import { checkTorrentSizeLimit, forceUpdateTorrentUI } from './torrent-addition.js';
import torrentManager from '../core/torrent-manager.js';
import * as Templates from '../ui/templates.js';

// This function will listen for torrent completion and update used space
export async function monitorTorrentCompletion(torrent) {
    // Check if torrent is completed
    if (torrent.percentDone >= 0.999) { // Consider completed at 99.9%
        console.log(`Torrent ${torrent.name} is completed. Updating used space...`);

        // Fetch the total space used after the torrent has completed
        try {
            const totalUsedSpace = await calculateTotalUsedSpace();
            // Update the space in the database
            await apiClient.updateUsedSpaceWithTotalSize(totalUsedSpace);
            console.log(`Used space updated to: ${Utils.formatFileSize(totalUsedSpace)}`);
        } catch (error) {
            console.error('Error updating used space:', error);
        }
    }
}

// Function to calculate the total used space dynamically
async function calculateTotalUsedSpace() {
    let totalSize = 0;

    // Calculate the total size of all completed torrents
    torrentManager.userTorrents.forEach(torrent => {
        if (torrent.percentDone >= 0.999) { // Only include completed torrents
            totalSize += torrent.totalSize;
        }
    });

    return totalSize;
}
/**
 * Fetch a single torrent by hash without making individual requests
 * @param {string} hash - Torrent hash
 * @return {Promise<Object|null>} Torrent info or null if not found
 */
export async function fetchTorrentByHash(hash) {
  try {
    console.log(`Getting info for torrent: ${hash}`);
    return await torrentManager.getTorrentInfo(hash);
  } catch (error) {
    console.error(`Error getting torrent with hash ${hash}:`, error);
    return null;
  }
}

/**
 * Fix for torrent completion in fetchTorrentsInBackground
 * 
 * This fixes two issues:
 * 1. Properly handle completed torrents so they transition to the completed state
 * 2. More robust error handling for API requests to avoid cascading failures
 */

export async function fetchTorrentsInBackground() {
  try {
    console.log('Fetching torrents in background without showing skeleton UI');
    
    // Step 1: Get user-specific torrent hashes from database
    const userTorrentHashes = await apiClient.getUserTorrentHashes();
    console.log('User torrent hashes:', userTorrentHashes);
    
    // If no torrents, update UI quietly without skeleton
    if (userTorrentHashes.length === 0) {
      torrentManager.userTorrents = [];
      // Only update if we don't already have a "No active torrents" message
      const torrentList = document.getElementById('torrentList');
      if (torrentList && (torrentList.children.length === 0 || 
          torrentList.children[0].textContent !== 'No active torrents')) {
        torrentList.innerHTML = '<div class="torrent-item">No active torrents</div>';
      }
      
      // Update used space to 0 since there are no torrents
      await apiClient.updateUsedSpaceWithTotalSize(0);
       
      return [];
    }
    
    // OPTIMIZATION: Process in larger chunks to reduce number of requests
    const CHUNK_SIZE = 100; // Increased from smaller chunks for better performance
    let userTorrents = [];
    
    // IMPROVED: Error handling for chunk processing
    // Process in chunks to avoid URL length issues and improve performance
    for (let i = 0; i < userTorrentHashes.length; i += CHUNK_SIZE) {
      // Get a chunk of up to CHUNK_SIZE hashes
      const hashChunk = userTorrentHashes.slice(i, i + CHUNK_SIZE);
      const hashParam = hashChunk.join('|'); // qBittorrent uses pipe delimiter
      
      // Make a single request for the entire chunk
      console.log(`Fetching chunk of ${hashChunk.length} torrents (${i+1}-${Math.min(i+CHUNK_SIZE, userTorrentHashes.length)} of ${userTorrentHashes.length})`);
      
      // Use hashes parameter to filter torrents
      try {
        const chunkTorrents = await apiClient.qbittorrentRequest('torrents/info', 'GET', {
          hashes: hashParam
        });
        
        if (Array.isArray(chunkTorrents)) {
          userTorrents = userTorrents.concat(chunkTorrents);
        }
      } catch (error) {
        console.error(`Error fetching chunk of torrents: ${error.message}`);
        // Continue with the next chunk rather than failing entirely
      }
      
      // Add a small delay between chunks to prevent overwhelming the server
      if (i + CHUNK_SIZE < userTorrentHashes.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // CRITICAL: First clean up downloadingTorrents array - remove any torrents that no longer exist
    // This prevents continuous errors from trying to fetch deleted torrents
    if (torrentManager.downloadingTorrents && torrentManager.downloadingTorrents.length > 0) {
      // Get all valid hashes from this API response
      const validHashes = userTorrents.map(t => t.hash.toLowerCase());
      
      // Filter downloadingTorrents to keep only valid ones
      const initialLength = torrentManager.downloadingTorrents.length;
      torrentManager.downloadingTorrents = torrentManager.downloadingTorrents.filter(hash => 
        validHashes.includes(hash)
      );
      
      // Log if any torrents were removed
      if (initialLength !== torrentManager.downloadingTorrents.length) {
        console.log(`Removed ${initialLength - torrentManager.downloadingTorrents.length} stale torrents from downloadingTorrents array`);
      }
    }
    
    // Step 4: Update the downloading torrents list - start fresh
    torrentManager.downloadingTorrents = [];
    
    // Map torrents to our format and identify downloading ones
    const mappedTorrents = await Promise.all(userTorrents.map(async torrent => {
      // Log original torrent data to debug
      console.log(`Original torrent API data for ${torrent.name}:`, {
        fileCount: torrent.fileCount,
        file_count: torrent.file_count,
        nestedFileCount: torrent.files?.[0]?.fileCount,
        progress: torrent.progress
      });
      
      // Convert qBittorrent format to our expected format
      const mapped = {
        id: torrent.hash,
        name: torrent.name,
        addedDate: torrent.added_on * 1000,
        percentDone: torrent.progress,
        downloadDir: torrent.save_path,
        status: Utils.mapQbittorrentStatus(torrent.state),
        totalSize: torrent.size,
        peersConnected: torrent.num_leechs || 0,
        rateDownload: torrent.dlspeed || 0,
        hashString: torrent.hash,
        eta: torrent.eta,
        
        // Preserve all file count info - don't change this part
        fileCount: torrent.fileCount || torrent.file_count || 
                  (torrent.files && torrent.files[0] && torrent.files[0].fileCount) || 
                  (torrent.files && torrent.files[0] && torrent.files[0].file_count) || 0,
                  
        file_count: torrent.fileCount || torrent.file_count || 
                   (torrent.files && torrent.files[0] && torrent.files[0].fileCount) || 
                   (torrent.files && torrent.files[0] && torrent.files[0].file_count) || 0
      };
      
      // Log the mapped data for debugging
      console.log(`Mapped torrent ${mapped.name}, fileCount: ${mapped.fileCount}, file_count: ${mapped.file_count}, progress: ${mapped.percentDone}`);
      
      // CRITICAL FIX: More reliably detect completion
      // If progress is >= 99.9%, consider it complete
      if (mapped.percentDone >= 0.999) {
        // Set it to exactly 1 to ensure UI recognizes it as completed
        mapped.percentDone = 1;
        
        // Log the completion for debugging
        console.log(`Marking torrent as complete: ${mapped.name} (${(torrent.progress*100).toFixed(1)}%)`);
        
        // IMPORTANT: Do NOT add completed torrents to downloadingTorrents array
        // This is implicit since we're not adding it below
      }
      // Only track actively downloading torrents (NOT completed ones)
      else if (mapped.percentDone < 0.999 && 
          torrent.state !== 'pausedDL' &&
          torrent.state !== 'pausedUP' &&
          torrent.state !== 'error' &&
          torrent.state !== 'missingFiles') {
        
        console.log(`Adding ${mapped.name} to downloadingTorrents array`);
        torrentManager.downloadingTorrents.push(torrent.hash.toLowerCase());
      }
      
      // FIX: Only fetch files for completed torrents IF we don't already have the file info
      const existingTorrent = torrentManager.userTorrents.find(t => 
        t.hashString && t.hashString.toLowerCase() === mapped.hashString.toLowerCase());
      
      if (mapped.percentDone >= 1) {
        // Check if we already have files info for this completed torrent
        if (existingTorrent && Array.isArray(existingTorrent.files) && existingTorrent.files.length > 0) {
          // Reuse existing file info to avoid unnecessary API calls
          mapped.files = existingTorrent.files;
          console.log(`Reusing existing file info for completed torrent: ${mapped.name}`);
        } else {
          // Only fetch files if we don't already have them
          try {
            console.log(`Fetching files for completed torrent (first time): ${mapped.name}`);
            const torrentFiles = await apiClient.qbittorrentRequest('torrents/files', 'GET', { hash: mapped.hashString });
            if (Array.isArray(torrentFiles)) {
              mapped.files = torrentFiles;
            } else {
              mapped.files = [];
            }
          } catch (error) {
            console.error(`Error fetching files for torrent ${mapped.name}:`, error);
            mapped.files = [];
          }
        }
      } else {
        // For downloading torrents, preserve existing file info
        mapped.files = existingTorrent && Array.isArray(existingTorrent.files) ? 
          existingTorrent.files : [];
      }
      
      return mapped;
    }));
    
    // Calculate total size of all torrents
    // In fetchTorrentsInBackground, replace the database update section:

// Calculate total size of all torrents
 const totalSize = mappedTorrents.reduce((sum, torrent) => sum + torrent.totalSize, 0);
    console.log(`Total size of all torrents: ${Utils.formatFileSize(totalSize)}`);

// Update database with calculated total size
// FIXED: Be more careful about timing to prevent conflicts with metadata updates
 const now = Date.now();
    const lastUpdate = torrentManager.lastDatabaseSizeUpdate || 0;
    const timeSinceLastUpdate = now - lastUpdate;

// Only update if:
// 1. This is a force update (user initiated), OR
// 2. We've never updated before, OR
// 3. It's been at least 60 seconds since last update AND
//    it's been at least 15 seconds (to avoid race conditions with metadata updates)
if (lastUpdate === undefined || 
        (timeSinceLastUpdate > 60000 && timeSinceLastUpdate > 15000)) {
      
      try {
        console.log(`Updating database size after background fetch (${timeSinceLastUpdate/1000}s since last update)`);
        const spaceInfo = await apiClient.updateUsedSpaceWithTotalSize(totalSize);
        torrentManager.lastDatabaseSizeUpdate = now;
        // Update disk space display without showing skeleton
        torrentManager.updateDiskSpaceDisplay(spaceInfo);
      } catch (error) {
        console.error('Failed to update database with total size:', error);
        // Continue even if this fails
      }
    } else {
      console.log(`Skipping database size update (only ${timeSinceLastUpdate/1000}s since last update)`);
    }
  
    
    // Cache the torrents
    torrentManager.userTorrents = mappedTorrents;
    
    // Update torrent stats (counts and sizes)
    if (typeof torrentManager.updateTorrentStats === 'function') {
      torrentManager.updateTorrentStats(mappedTorrents);
    }
    
    // Update interval setup based on current state
    if (typeof torrentManager.setupUpdateInterval === 'function') {
      torrentManager.setupUpdateInterval();
    }
    
    // ENHANCED: Force a full redraw of completed torrents to ensure proper UI
    // This will replace any torrents showing 100% with the completed UI
    const completedTorrentsUpdated = [];
    
    for (const torrent of mappedTorrents) {
      if (torrent.percentDone >= 1) {
        const torrentElement = document.querySelector(`.torrent-item[data-hash="${torrent.hashString.toLowerCase()}"]`);
        
        // Only update if the element exists and doesn't already have the 'downloaded' class
        if (torrentElement && !torrentElement.classList.contains('downloaded')) {
          console.log(`Forcing redraw of completed torrent: ${torrent.name}`);
          
          try {
            // Replace this element with a new one
            const newElement = Templates.createTorrentElement(torrent);
            if (torrentElement.parentNode) {
              torrentElement.parentNode.replaceChild(newElement, torrentElement);
              completedTorrentsUpdated.push(torrent.name);
            }
          } catch (error) {
            console.error(`Error updating UI for completed torrent ${torrent.name}:`, error);
            // Continue with other torrents even if this one fails
          }
        }
      }
    }
    
    if (completedTorrentsUpdated.length > 0) {
      console.log(`Updated UI for ${completedTorrentsUpdated.length} completed torrents: ${completedTorrentsUpdated.join(', ')}`);
    }
    
    // Sort torrents based on current settings
    const sortedTorrents = (typeof torrentManager.sortTorrents === 'function') ? 
      torrentManager.sortTorrents(mappedTorrents) : mappedTorrents;
    
    // Update the UI without showing skeleton
    if (typeof torrentManager.smartUpdateTorrentTable === 'function') {
      torrentManager.smartUpdateTorrentTable(sortedTorrents, torrentManager.userTorrents);
    } else if (typeof torrentManager.updateTorrentTable === 'function') {
      torrentManager.updateTorrentTable(sortedTorrents);
    }
    
    return mappedTorrents;
  } catch (error) {
    console.error('Error in fetchTorrentsInBackground:', error);
    // Don't change the UI on error in background update
    return torrentManager.userTorrents;
  }
}

export async function getTorrentMetadata(hash, forceDirectRequest = true) {
  try {
    let torrentInfo;
    
    // First check if this is a completed torrent in our cache
    const existingTorrent = torrentManager.userTorrents.find(t => 
      t.hashString && t.hashString.toLowerCase() === hash.toLowerCase()
    );
    
    // If it's a completed torrent and we're not forcing a refresh, just return cached data
    if (existingTorrent && existingTorrent.percentDone >= 0.999 && !forceDirectRequest) {
      console.log(`Using cached data for completed torrent ${hash}`);
      return {
        found: true,
        tagStatus: existingTorrent.tags || "",
        category: existingTorrent.category || "",
        name: existingTorrent.name || "",
        size: existingTorrent.totalSize || 0,
        progress: existingTorrent.percentDone || 0,
        savePath: existingTorrent.downloadDir || "",
        contentPath: existingTorrent.contentPath || "",
        state: existingTorrent.state || "",
        peersConnected: existingTorrent.peersConnected || 0,
        rateDownload: existingTorrent.rateDownload || 0,
        eta: existingTorrent.eta || 0
      };
    }
    
    // For new torrents or when forced, make a direct API call to get fresh data
    if (forceDirectRequest) {
      console.log(`Forcing direct API request for torrent ${hash}`);
      try {
        // Make a direct API call to get fresh data
        const directInfo = await apiClient.qbittorrentRequest('torrents/info', 'GET', {
          hashes: hash
        });
        
        if (Array.isArray(directInfo) && directInfo.length > 0) {
          torrentInfo = directInfo[0];
          console.log(`Direct API call for ${hash} successful:`, torrentInfo);
          
          // Update our cached data
          const existingTorrentIndex = torrentManager.userTorrents.findIndex(t => 
            t.hashString && t.hashString.toLowerCase() === hash.toLowerCase()
          );
          
          if (existingTorrentIndex >= 0) {
            // Preserve existing files info to avoid unnecessary API calls
            const existingFiles = torrentManager.userTorrents[existingTorrentIndex].files || [];
            
            // Update existing torrent in cache with new data
            const mappedTorrent = {
              id: torrentInfo.hash,
              name: torrentInfo.name,
              addedDate: torrentInfo.added_on * 1000,
              percentDone: torrentInfo.progress,
              downloadDir: torrentInfo.save_path,
              status: Utils.mapQbittorrentStatus(torrentInfo.state),
              totalSize: torrentInfo.size,
              peersConnected: torrentInfo.num_leechs || 0,
              rateDownload: torrentInfo.dlspeed || 0,
              hashString: torrentInfo.hash,
              eta: torrentInfo.eta,
              files: existingFiles // Preserve existing files
            };
            
            // Update the cache
            torrentManager.userTorrents[existingTorrentIndex] = mappedTorrent;
          }
        }
      } catch (directError) {
        console.error(`Direct API request for ${hash} failed:`, directError);
        // Fall back to cached data below
      }
    }
    
    // If direct request failed or wasn't requested, use cached data
    if (!torrentInfo) {
      torrentInfo = await fetchTorrentByHash(hash);
    }
    
    if (!torrentInfo) {
      console.warn(`No torrent found with hash ${hash}`);
      return {
        found: false,
        tagStatus: "",
        category: "",
        name: "",
        size: 0,
        progress: 0
      };
    }
    
    // Return comprehensive metadata about the torrent
    return {
      found: true,
      tagStatus: torrentInfo.tags ? torrentInfo.tags.trim() : "",
      category: torrentInfo.category ? torrentInfo.category.trim() : "",
      name: torrentInfo.name || "",
      size: torrentInfo.size || torrentInfo.totalSize || 0,
      progress: torrentInfo.progress || torrentInfo.percentDone || 0,
      savePath: torrentInfo.save_path || torrentInfo.downloadDir || "",
      contentPath: torrentInfo.content_path || "",
      state: torrentInfo.state || "",
      peersConnected: torrentInfo.num_leechs || torrentInfo.peersConnected || 0,
      rateDownload: torrentInfo.dlspeed || torrentInfo.rateDownload || 0,
      eta: torrentInfo.eta || 0
    };
  } catch (error) {
    console.error(`Error getting torrent metadata for ${hash}:`, error);
    return {
      found: false,
      tagStatus: "",
      category: "",
      name: "",
      size: 0,
      progress: 0,
      error: error.message
    };
  }
}



/**
 * Check if a torrent with the given hash exists in qBittorrent
 * @param {string} hash - Torrent hash
 * @return {Promise<boolean>} True if torrent exists
 */
export async function torrentExists(hash) {
  const torrent = await fetchTorrentByHash(hash);
  return torrent !== null;
}

/**
 * Monitor torrent tag changes (useful for S3 storage option)
 * @param {string} hash - Torrent hash
 * @param {Function} callback - Callback function
 * @param {number} interval - Check interval in ms
 * @param {number} maxAttempts - Maximum number of attempts
 * @return {number} Interval ID
 */
export async function monitorTorrentTags(hash, callback, interval = 5000, maxAttempts = 60) {
  // Initialize tracking variables
  let attempts = 0;
  let lastTagStatus = "";
  let intervalId = null;
  
  console.log(`Starting tag monitoring for torrent ${hash}`);
  
  // Function to check tag status
  const checkTags = async () => {
    attempts++;
    console.log(`Tag check attempt #${attempts} for hash ${hash}`);
    
    try {
      // Get current metadata
      const metadata = await getTorrentMetadata(hash);
      
      if (!metadata.found) {
        console.warn(`Torrent ${hash} not found during tag monitoring`);
        if (attempts >= maxAttempts) {
          console.log(`Maximum attempts reached for torrent ${hash}, stopping tag monitoring`);
          clearInterval(intervalId);
          callback({
            success: false, 
            message: "Torrent not found after multiple attempts",
            hash: hash
          });
        }
        return;
      }
      
      // Check if tag status changed
      if (metadata.tagStatus !== lastTagStatus) {
        console.log(`Tag status changed from "${lastTagStatus}" to "${metadata.tagStatus}" for torrent ${hash}`);
        lastTagStatus = metadata.tagStatus;
        
        // If tag is now 'Ready', we found what we're looking for
        if (metadata.tagStatus && metadata.tagStatus.toLowerCase() === 'ready') {
          console.log(`Torrent ${hash} is now marked as 'Ready'`);
          clearInterval(intervalId);
          callback({
            success: true,
            message: "Torrent is marked as Ready",
            hash: hash,
            metadata: metadata
          });
        }
      }
      
      // Check if we've reached max attempts
      if (attempts >= maxAttempts) {
        console.log(`Maximum attempts reached for torrent ${hash}, stopping tag monitoring`);
        clearInterval(intervalId);
        callback({
          success: false,
          message: `Tag status still "${metadata.tagStatus}" after ${maxAttempts} checks`,
          hash: hash,
          metadata: metadata
        });
      }
    } catch (error) {
      console.error(`Error during tag monitoring for ${hash}:`, error);
      if (attempts >= maxAttempts) {
        clearInterval(intervalId);
        callback({
          success: false,
          message: `Error during tag monitoring: ${error.message}`,
          hash: hash
        });
      }
    }
  };
  
  // Check immediately first
  await checkTags();
  
  // Then set up interval
  intervalId = setInterval(checkTags, interval);
  
  // Return the interval ID so it can be cleared externally if needed
  return intervalId;
}

/**
 * Start monitoring a torrent's metadata and progress with reduced API calls
 * @param {string} hash - Torrent hash
 * @param {boolean} hasPendingNotification - Whether there's a pending notification
 * @param {boolean} isNewTorrent - Whether this is a newly added torrent
 * @return {number} Interval ID
 */
export function startMetadataMonitoring(hash, hasPendingNotification = false, isNewTorrent = false) {
  console.log(`Starting optimized torrent progress monitoring for ${hash}${isNewTorrent ? ' (NEW TORRENT)' : ''}`);
  
  // Store monitoring state to avoid duplicate interval timers
  torrentManager.metadataMonitoringHashes = torrentManager.metadataMonitoringHashes || {};
  
  // If already monitoring this hash, clear the existing timer
  if (torrentManager.metadataMonitoringHashes[hash]) {
    clearInterval(torrentManager.metadataMonitoringHashes[hash].intervalId);
  }
  
  // Dynamic interval based on torrent state and age
  // Start with more frequent checks for new torrents, then gradually reduce frequency
  const INITIAL_NEW_INTERVAL = 3000;   // 3 seconds for very new torrents
  const STANDARD_INTERVAL = 7000;      // 7 seconds for regular monitoring 
  const SLOW_INTERVAL = 15000;         // 15 seconds for stalled torrents
  
  let checkCount = 0;
  const MAX_CHECKS = 60; // Maximum number of checks before giving up
  
  // Create monitoring object
  torrentManager.metadataMonitoringHashes[hash] = {
    startTime: Date.now(),
    checkCount: 0,
    intervalId: null,
    hasPendingNotification: hasPendingNotification,
    isNewTorrent: isNewTorrent,
    currentInterval: isNewTorrent ? INITIAL_NEW_INTERVAL : STANDARD_INTERVAL,
    lastProgressValue: 0,
    progressStaleCount: 0,
    directApiCallCount: 0, // Track number of direct API calls to limit them
    lastDirectApiCall: 0,   // Track time of last direct API call
    sizeLimitChecked: false, // Track if we've already checked size limits
    sizeUpdatedInDatabase: false // NEW: Track if size has been updated in database
  };
  
  // Function to check progress and update UI
  const checkProgress = async () => {
    try {
      checkCount++;
      
      // First, check if this torrent already exists in userTorrents and is completed
      const existingTorrent = torrentManager.userTorrents.find(t => 
        t.hashString && t.hashString.toLowerCase() === hash.toLowerCase()
      );
      
      // If torrent is already complete in our cache, stop monitoring immediately
      if (existingTorrent && existingTorrent.percentDone >= 0.999) {
        console.log(`Torrent ${hash} is already complete (${(existingTorrent.percentDone*100).toFixed(1)}%), stopping monitoring`);
        
        // Remove pending notification if it exists
        if (torrentManager.metadataMonitoringHashes[hash].hasPendingNotification) {
          if (typeof torrentManager.removePendingTorrentFeedback === 'function') {
            torrentManager.removePendingTorrentFeedback(hash);
          }
        }
        
        // Force one final UI update to ensure the torrent shows as completed
        if (typeof torrentManager.forceUpdateTorrentUI === 'function') {
          await torrentManager.forceUpdateTorrentUI(hash);
        }
        
        clearInterval(torrentManager.metadataMonitoringHashes[hash].intervalId);
        delete torrentManager.metadataMonitoringHashes[hash];
        return;
      }
      
      // Update pending notification status if one exists
      if (torrentManager.metadataMonitoringHashes[hash] && 
          torrentManager.metadataMonitoringHashes[hash].hasPendingNotification) {
        if (typeof torrentManager.updatePendingTorrentStatus === 'function') {
          torrentManager.updatePendingTorrentStatus(hash, `Downloading... (check ${checkCount})`);
        }
      }
      
      // Determine if we should make a direct API call
      // Limit direct API calls based on monitoring age
      const monitoringAge = Date.now() - torrentManager.metadataMonitoringHashes[hash].startTime;
      const timeSinceLastDirectCall = Date.now() - torrentManager.metadataMonitoringHashes[hash].lastDirectApiCall;
      
      // Logic to limit API calls:
      // 1. For new torrents, make direct calls more frequently but limit to 5 in first minute
      // 2. For older monitoring, only make direct calls every minute or more
      let forceDirectRequest = false;
      
      // For new torrents in first few minutes, allow more direct calls 
      if (isNewTorrent && monitoringAge < 3 * 60 * 1000) { // First 3 minutes
        // Allow direct API call if:
        // - It's been at least 15 seconds since last direct call
        // - Or it's one of the first 5 checks and been at least 3 seconds
        if ((timeSinceLastDirectCall > 15000) || 
            (checkCount <= 5 && timeSinceLastDirectCall > 3000)) {
          forceDirectRequest = true;
        }
      } else if (timeSinceLastDirectCall > 60000) { // For older monitoring, once per minute
        forceDirectRequest = true;
      }
      
      // Log appropriately based on whether doing direct call
      if (forceDirectRequest) {
        console.log(`Progress check #${checkCount} for hash ${hash} (WITH DIRECT API CALL)`);
        torrentManager.metadataMonitoringHashes[hash].lastDirectApiCall = Date.now();
        torrentManager.metadataMonitoringHashes[hash].directApiCallCount++;
      } else {
        console.log(`Progress check #${checkCount} for hash ${hash} (using cached data)`);
      }
      
      // Get torrent info with possible direct API request 
      const torrentInfo = await getTorrentMetadata(hash, forceDirectRequest);
      
      if (!torrentInfo || !torrentInfo.found) {
        console.log(`Torrent ${hash} not found, stopping monitoring`);
        
        // Remove pending notification if it exists
        if (torrentManager.metadataMonitoringHashes[hash] && 
            torrentManager.metadataMonitoringHashes[hash].hasPendingNotification) {
          if (typeof torrentManager.removePendingTorrentFeedback === 'function') {
            torrentManager.removePendingTorrentFeedback(hash);
          }
        }
        
        clearInterval(torrentManager.metadataMonitoringHashes[hash].intervalId);
        delete torrentManager.metadataMonitoringHashes[hash];
        return;
      }
      
      // NEW: Recalculate total size and update database when metadata is retrieved
      // Only do this once per torrent and when size information is available
      if (
        isNewTorrent && 
        forceDirectRequest && 
        torrentInfo && 
        torrentInfo.found && 
        torrentInfo.size && 
        !torrentManager.metadataMonitoringHashes[hash].sizeUpdatedInDatabase
      ) {
        console.log(`Recalculating total size for all torrents after metadata update for ${hash}`);
        
        // FIXED: Always allow metadata size update for new torrents
        // This is the first time we're getting size info for this torrent, so we should always update
        
        // Set the flag to prevent duplicate updates for this torrent
        torrentManager.metadataMonitoringHashes[hash].sizeUpdatedInDatabase = true;
        
        // Set last update time before making the request
        const now = Date.now();
        torrentManager.lastDatabaseSizeUpdate = now;
        
        // Calculate total size of all torrents including this one
        let totalSize = 0;
        
        // Get existing torrent data
        const existingTorrents = [...torrentManager.userTorrents];
        
        // Add or update the current torrent in our array
        const existingIndex = existingTorrents.findIndex(t => 
          t.hashString && t.hashString.toLowerCase() === hash.toLowerCase()
        );
        
        if (existingIndex >= 0) {
          // Update with new size
          existingTorrents[existingIndex].totalSize = torrentInfo.size;
        } else {
          // Add new torrent to calculation
          existingTorrents.push({
            hashString: hash,
            totalSize: torrentInfo.size
          });
        }
        
        // Calculate total size
        totalSize = existingTorrents.reduce((sum, torrent) => sum + (torrent.totalSize || 0), 0);
        
        console.log(`Total size of all torrents after metadata update: ${Utils.formatFileSize(totalSize)}`);
        
        // Update database with new total size
        try {
          const spaceInfo = await apiClient.updateUsedSpaceWithTotalSize(totalSize);
          console.log(`Database updated with new total size: ${Utils.formatFileSize(totalSize)}`);
          
          // Update UI if possible
          if (torrentManager.updateDiskSpaceDisplay) {
            torrentManager.updateDiskSpaceDisplay(spaceInfo);
          }
        } catch (sizeUpdateError) {
          console.error(`Error updating database with new total size:`, sizeUpdateError);
        }
      }
      
      // NEW: Check plan size limits when we have enough metadata
      // For new torrents, or whenever size information becomes available
      if ((isNewTorrent || forceDirectRequest) && 
          torrentInfo && torrentInfo.found && torrentInfo.size && 
          !torrentManager.metadataMonitoringHashes[hash].sizeLimitChecked) {
        console.log(`Checking plan size limits for torrent ${hash}`);
        
        // Mark as checked to reduce redundant checks
        torrentManager.metadataMonitoringHashes[hash].sizeLimitChecked = true;
        
        // Use the new function to enforce size limits for free users
        const isWithinLimits = await checkSizeLimitsAndEnforce(hash, torrentInfo);
        
        // If torrent exceeds limits and was deleted, stop monitoring
        if (!isWithinLimits) {
          console.log(`Torrent ${hash} exceeded plan limits and was deleted, stopping monitoring`);
          clearInterval(torrentManager.metadataMonitoringHashes[hash].intervalId);
          delete torrentManager.metadataMonitoringHashes[hash];
          return;
        }
      }
      
      // Check if torrent is complete or almost complete (≥99.9%)
      if (torrentInfo.progress >= 0.999 || torrentInfo.percentDone >= 0.999) {
        console.log(`Torrent ${hash} is complete (${((torrentInfo.progress || torrentInfo.percentDone)*100).toFixed(1)}%), stopping monitoring`);
        
        // Remove pending notification if it exists
        if (torrentManager.metadataMonitoringHashes[hash] && 
            torrentManager.metadataMonitoringHashes[hash].hasPendingNotification) {
          if (typeof torrentManager.removePendingTorrentFeedback === 'function') {
            torrentManager.removePendingTorrentFeedback(hash);
          }
        }
        
        // Force an immediate UI update to ensure the torrent shows as completed
        if (typeof torrentManager.forceUpdateTorrentUI === 'function') {
          console.log(`Forcing final UI update for completed torrent ${hash}`);
          await torrentManager.forceUpdateTorrentUI(hash);
        }
        
        // Clear the interval and remove from monitoring
        clearInterval(torrentManager.metadataMonitoringHashes[hash].intervalId);
        delete torrentManager.metadataMonitoringHashes[hash];
        return;
      }
      
      // Update progress stats 
      if (torrentManager.metadataMonitoringHashes[hash]) {
        const currentProgress = torrentInfo.progress || 0;
        const lastProgress = torrentManager.metadataMonitoringHashes[hash].lastProgressValue || 0;
        
        // Check if progress is stalled or changed
        if (Math.abs(currentProgress - lastProgress) < 0.0001) {
          torrentManager.metadataMonitoringHashes[hash].progressStaleCount++;
          
          // If progress appears stalled for a while, adjust the interval to reduce API calls
          if (torrentManager.metadataMonitoringHashes[hash].progressStaleCount >= 3) {
            // If we've been using a faster interval and progress is stalled, slow down
            if (torrentManager.metadataMonitoringHashes[hash].currentInterval < SLOW_INTERVAL) {
              console.log(`Progress appears stalled for ${hash}, reducing check frequency`);
              clearInterval(torrentManager.metadataMonitoringHashes[hash].intervalId);
              
              // Set slower interval
              torrentManager.metadataMonitoringHashes[hash].currentInterval = SLOW_INTERVAL;
              
              // Create new interval
              const newIntervalId = setInterval(checkProgress, SLOW_INTERVAL);
              torrentManager.metadataMonitoringHashes[hash].intervalId = newIntervalId;
            }
          }
        } else {
          // Progress changed, reset stale counter
          torrentManager.metadataMonitoringHashes[hash].progressStaleCount = 0;
          torrentManager.metadataMonitoringHashes[hash].lastProgressValue = currentProgress;
          
          // If significant progress is being made but we're on slow interval, speed up again
          if (Math.abs(currentProgress - lastProgress) > 0.01 && 
              torrentManager.metadataMonitoringHashes[hash].currentInterval === SLOW_INTERVAL) {
            console.log(`Progress resuming for ${hash}, increasing check frequency`);
            clearInterval(torrentManager.metadataMonitoringHashes[hash].intervalId);
            
            // Set standard interval
            torrentManager.metadataMonitoringHashes[hash].currentInterval = STANDARD_INTERVAL;
            
            // Create new interval
            const newIntervalId = setInterval(checkProgress, STANDARD_INTERVAL);
            torrentManager.metadataMonitoringHashes[hash].intervalId = newIntervalId;
          }
        }
      }
      
      // Try to update torrent element if it exists in the DOM
      const torrentElement = document.querySelector(`.torrent-item[data-hash="${hash.toLowerCase()}"]`);
      if (torrentElement) {
        // Only force a full UI update if:
        // 1. We just did a direct API call, OR
        // 2. Progress has changed significantly, OR
        // 3. It's one of the first 5 checks
        const progressChanged = torrentManager.metadataMonitoringHashes[hash] &&
                                Math.abs(torrentInfo.progress - 
                                        (torrentManager.metadataMonitoringHashes[hash].lastProgressValue || 0)) > 0.005;
        
        if (forceDirectRequest || progressChanged || checkCount <= 5) {
          await torrentManager.forceUpdateTorrentUI(hash);
        }
      }
      
      // Check if we've reached max attempts
      if (checkCount >= MAX_CHECKS) {
        console.log(`Reached maximum checks (${MAX_CHECKS}) for torrent ${hash}, stopping monitoring`);
        clearInterval(torrentManager.metadataMonitoringHashes[hash].intervalId);
        delete torrentManager.metadataMonitoringHashes[hash];
      }
    } catch (error) {
      console.error(`Error monitoring torrent ${hash}:`, error);
      
      // Still stop monitoring after max attempts even if errors occur
      if (checkCount >= MAX_CHECKS) {
        console.log(`Reached maximum checks for torrent ${hash} (with errors), stopping monitoring`);
        clearInterval(torrentManager.metadataMonitoringHashes[hash].intervalId);
        delete torrentManager.metadataMonitoringHashes[hash];
      }
    }
  };
  
  // Run the first check immediately
  checkProgress();
  
  // Start interval to check periodically
  const initialInterval = isNewTorrent ? INITIAL_NEW_INTERVAL : STANDARD_INTERVAL;
  const intervalId = setInterval(checkProgress, initialInterval);
  
  if (torrentManager.metadataMonitoringHashes[hash]) {
    torrentManager.metadataMonitoringHashes[hash].intervalId = intervalId;
  }
  
  return intervalId;
}

/**
 * Start enhanced monitoring for a newly added torrent
 * @param {string} hash - Torrent hash
 * @param {string} name - Torrent name
 * @return {number} Interval ID
 */
export function startNewTorrentMonitoring(hash, name) {
  console.log(`Starting enhanced monitoring for newly added torrent: ${name} (${hash})`);
  
  // Make sure hash is in lowercase for consistency
  const lowerHash = hash.toLowerCase();
  
  // 1. Ensure torrent is in the downloadingTorrents array
  if (!torrentManager.downloadingTorrents.includes(lowerHash)) {
    torrentManager.downloadingTorrents.push(lowerHash);
    console.log(`Added ${lowerHash} to downloadingTorrents array`);
  }
  
  // Set up more frequent UI update attempts specifically for new torrents
  // The first few updates are critical for showing initial progress and speed
  // Modified with more frequent updates in the beginning
  const updateIntervals = [1000, 2000, 3000, 4000, 6000, 8000, 10000, 15000, 20000, 30000]; // More frequent updates
  let completionDetected = false; // Track if completion is detected
  
  const scheduleNextUpdate = (index) => {
    if (index >= updateIntervals.length || completionDetected) return;
    
    setTimeout(async () => {
      console.log(`UI update attempt #${index + 1} for new torrent ${lowerHash}`);
      
      try {
        // Check if torrent already exists and is completed
        const existingTorrent = torrentManager.userTorrents.find(t => 
          t.hashString && t.hashString.toLowerCase() === lowerHash
        );
        
        if (existingTorrent && existingTorrent.percentDone >= 0.999) {
          console.log(`Torrent ${lowerHash} is already complete, stopping UI updates`);
          completionDetected = true;
          return;
        }
        
        // Directly request metadata with force flag to ensure fresh data
        const metadata = await getTorrentMetadata(lowerHash, true);
        
        if (metadata && metadata.found) {
          console.log(`Got metadata for new torrent ${lowerHash}:`, metadata);
          
          // Update the torrent in userTorrents cache with fresh data
          const torrentIndex = torrentManager.userTorrents.findIndex(t => 
            t.hashString && t.hashString.toLowerCase() === lowerHash
          );
          
          if (torrentIndex >= 0) {
            // Update with fresh data
            torrentManager.userTorrents[torrentIndex].totalSize = metadata.size || torrentManager.userTorrents[torrentIndex].totalSize;
            torrentManager.userTorrents[torrentIndex].percentDone = metadata.progress || torrentManager.userTorrents[torrentIndex].percentDone;
            torrentManager.userTorrents[torrentIndex].peersConnected = metadata.peersConnected || torrentManager.userTorrents[torrentIndex].peersConnected;
            torrentManager.userTorrents[torrentIndex].rateDownload = metadata.rateDownload || torrentManager.userTorrents[torrentIndex].rateDownload;
            torrentManager.userTorrents[torrentIndex].eta = metadata.eta || torrentManager.userTorrents[torrentIndex].eta;
            
            // Make sure the UI reflects these updates
            const success = await forceUpdateTorrentUI(lowerHash);
            
            // If the update wasn't successful or if we don't have download speed info yet,
            // try a direct UI update using the metadata
            if (!success || metadata.rateDownload > 0) {
              // Create a torrent object in the format expected by updateTorrentProgressUI
              const torrentForUI = {
                hash: lowerHash,
                progress: metadata.progress || 0,
                size: metadata.size || 0,
                num_leechs: metadata.peersConnected || 0,
                dlspeed: metadata.rateDownload || 0,
                eta: metadata.eta || 0
              };
              
              if (typeof torrentManager.updateTorrentProgressUI === 'function') {
                torrentManager.updateTorrentProgressUI(torrentForUI);
              }
            }
            
            console.log(`Forced UI update for new torrent ${lowerHash}: ${success ? 'success' : 'failed'}, speed: ${Utils.formatSpeed(metadata.rateDownload || 0)}`);
          }
        }
      } catch (error) {
        console.error(`Error during new torrent update #${index + 1} for ${lowerHash}:`, error);
      }
      
      // If not completed and not last attempt, schedule next update
      if (!completionDetected && index < updateIntervals.length - 1) {
        scheduleNextUpdate(index + 1);
      }
    }, updateIntervals[index]);
  };
  
  // Start the UI update sequence immediately
  scheduleNextUpdate(0);
  
  // Start standard metadata monitoring with isNewTorrent flag set to true
  // This will use more aggressive polling for new torrents
  return startMetadataMonitoring(lowerHash, true, true);
}


export async function enforcePlanSizeLimits(hash, metadata) {
  try {
    // Skip enforcement if no metadata or no size info
    if (!metadata || !metadata.size) {
      console.log(`No size information available for ${hash}, skipping plan limit check`);
      return true;
    }

    // Use server-side check instead of window.session
    console.log(`Checking server for plan limits on torrent ${hash} (${Utils.formatFileSize(metadata.size)})`);
    
    // Call the PHP function directly via fetch
    const formData = new FormData();
    formData.append('checkTorrentSizeLimit', true);
    formData.append('torrentSize', metadata.size);
    
    const response = await fetch('authentication.php', {
      method: 'POST',
      body: formData,
      credentials: 'same-origin'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    
    const sizeCheck = await response.json();
    
    // If allowed by server, return true (within limits for user's plan)
    if (sizeCheck.allowed) {
      console.log(`Server confirmed torrent size ${Utils.formatFileSize(metadata.size)} is allowed for user's plan`);
      return true;
    }
    
    // If not allowed, notify user and delete torrent
    console.log(`Server confirmed torrent ${hash} exceeds plan limits: ${sizeCheck.message}`);
    
    // Alert the user about the deletion
    const removingMessage = `This torrent is ${Utils.formatFileSize(metadata.size)} which exceeds the 2GB Free plan limit. It will be deleted automatically.`;
    const confirmDelete = confirm(removingMessage);
    
    if (confirmDelete || !confirmDelete) {
      
	  
	  
	  
	  
	  
	  console.log('Checking if torrent can be deleted:', hash);
        
        // First check how many users have this torrent
        let userCount = 0;
        let userCountResult = null;
        
        try {
            const formData = new FormData();
            formData.append('checkUserCount', true);
            formData.append('torrentHash', hash);
            
            console.log(`Checking how many users have torrent ${hash}...`);
            const userCountResponse = await fetch("dbInfoFeeder.php", {
                method: "POST",
                body: formData
            });
            
            if (!userCountResponse.ok) {
                throw new Error(`Server returned ${userCountResponse.status}: ${userCountResponse.statusText}`);
            }
            
            userCountResult = await userCountResponse.json();
            console.log('User count result:', userCountResult);
            
            if (!userCountResult.success) {
                throw new Error(userCountResult.message || 'Failed to get user count');
            }
            
            userCount = userCountResult.userCount || 0;
        } catch (error) {
            console.error('Error checking user count for torrent:', error);
            // Default to assuming only one user has this torrent
            userCount = 1;
        }
        
        // Display appropriate message based on user count
        let deletionMessage = '';
        let shouldDeleteFromQBittorrent = userCount <= 1;
        
         
        console.log('Deleting torrent with hash:', hash);
        console.log(`Will delete from qBittorrent: ${shouldDeleteFromQBittorrent}`);
	  
		        // Array to hold our deletion promises
        const deletePromises = [];
        
        // Only delete from qBittorrent if no other users have this torrent
        if (shouldDeleteFromQBittorrent) {
            console.log(`Deleting torrent ${hash} from qBittorrent as it's not used by other users`);
            deletePromises.push(
                apiClient.qbittorrentRequest('torrents/delete', 'POST', {
                    hashes: hash,
                    deleteFiles: false
                }).then(result => {
                    console.log('qBittorrent deletion result:', result);
                    return { type: 'qbittorrent', result };
                }).catch(error => {
                    console.error('qBittorrent deletion error:', error);
                    throw error;
                })
            );
        } else {
            console.log(`Skipping qBittorrent deletion for ${hash} as other users are using it`);
        }
        
        try{
		// Also delete from database	
        const dbFormData = new FormData();
        dbFormData.append('torrentHash', hash);
        dbFormData.append('validate', true);
        
        await fetch("dbInfoFeeder.php", {
          method: "POST",
          body: dbFormData
        });
	  
	  // Clean up UI references
        if (Array.isArray(torrentManager.downloadingTorrents)) {
          const index = torrentManager.downloadingTorrents.indexOf(hash.toLowerCase());
          if (index !== -1) {
            torrentManager.downloadingTorrents.splice(index, 1);
          }
        }
        
        if (Array.isArray(torrentManager.userTorrents)) {
          torrentManager.userTorrents = torrentManager.userTorrents.filter(t => 
            !t.hashString || t.hashString.toLowerCase() !== hash.toLowerCase()
          );
        }
        
        // Refresh UI
        setTimeout(() => {
          if (typeof torrentManager.fetchTorrentsInBackground === 'function') {
            torrentManager.fetchTorrentsInBackground();
          }
        }, 500);
        
        console.log(`Successfully deleted oversized torrent ${hash}`);
      } catch (deleteError) {
        console.error(`Error during deletion process for ${hash}:`, deleteError);
      }
	  
	  
	  
	  
	  
	  
	  
    }
    
    return false; // Torrent exceeded limits
  } catch (error) {
    console.error(`Error checking plan size limits for ${hash}:`, error);
    return true; // Default to allowing in case of error
  }
}


export async function checkSizeLimitsAndEnforce(hash, metadata) {
  // If we don't have size info yet but have enough metadata
  if (metadata && metadata.found && !metadata.size && metadata.name) {
    // Make a direct API call to get fresh data with size information
    try {
      const freshMetadata = await getTorrentMetadata(hash, true);
      if (freshMetadata && freshMetadata.found && freshMetadata.size) {
        return await enforcePlanSizeLimits(hash, freshMetadata);
      }
    } catch (error) {
      console.error(`Error getting fresh metadata for ${hash}:`, error);
    }
  } else if (metadata && metadata.found && metadata.size) {
    // We have size information, enforce limits directly
    return await enforcePlanSizeLimits(hash, metadata);
  }
  
  return true; // Default to allowing if we can't determine size
}
 