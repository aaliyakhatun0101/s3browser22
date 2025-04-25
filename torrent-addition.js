/**
 * /js/features/torrent-addition.js
 * Functions for adding torrents via magnet links or files
 */

import apiClient from '../core/api-client.js';
import * as Utils from '../core/utils.js';
import torrentManager from '../core/torrent-manager.js';
import * as Templates from '../ui/templates.js';
import { fetchTorrentByHash, monitorTorrentCompletion } from './torrent-monitoring.js';

// Array of blocked trackers - add any domains or tracker identifiers to block
const blockedTrackers = [
  'plab.site',       // Example blocked tracker domain
  'yama.com',        // Example blocked tracker domain
  'yD9xjK31cz',      // Example blocked tracker identifier
  'tracker.badsite.com',
  'unwanted-tracker.net',
  'malicioustracker.org',
  'popcorn-tracker.org'
];

/**
 * Clean a magnet link by removing any blocked trackers
 * @param {string} magnetLink - Original magnet link
 * @return {string} Cleaned magnet link with blocked trackers removed
 */
export function cleanMagnetLink(magnetLink) {
  if (!magnetLink) return magnetLink;
  
  try {
    console.log('Cleaning magnet link, original length:', magnetLink.length);
    
    // Check if the magnet link contains any trackers
    if (!magnetLink.includes('&tr=')) {
      return magnetLink; // No trackers to filter
    }
    
    // Split the magnet link into parts (hash+name and trackers)
    let mainPart = '';
    let trackerParts = [];
    
    // Extract the main part (everything before the first &tr=)
    const trIndex = magnetLink.indexOf('&tr=');
    if (trIndex !== -1) {
      mainPart = magnetLink.substring(0, trIndex);
      
      // Split the remaining part by &tr= to get individual trackers
      const trackersString = magnetLink.substring(trIndex + 1);
      trackerParts = trackersString.split('&tr=').filter(part => part.length > 0);
    } else {
      // No trackers found, return original
      return magnetLink;
    }
    
    // Filter out blocked trackers
    const filteredTrackers = trackerParts.filter(tracker => {
      // Don't keep trackers that match any blocked pattern
      return !blockedTrackers.some(blocked => 
        decodeURIComponent(tracker).toLowerCase().includes(blocked.toLowerCase())
      );
    });
    
    // Rebuild the magnet link
    let cleanedMagnet = mainPart;
    
    // Add back remaining trackers
    if (filteredTrackers.length > 0) {
      cleanedMagnet += '&tr=' + filteredTrackers.join('&tr=');
    }
    
    console.log('Cleaned magnet link, new length:', cleanedMagnet.length);
    
    // Log a message if trackers were removed
    if (filteredTrackers.length !== trackerParts.length) {
      console.log(`Removed ${trackerParts.length - filteredTrackers.length} blocked trackers from magnet link`);
    }
    
    return cleanedMagnet;
  } catch (error) {
    console.error('Error cleaning magnet link:', error);
    // Return original magnet link if there was an error
    return magnetLink;
  }
}

/**
 * This function triggers when a torrent is added
 */
export async function handleTorrentAddition(torrent) {
    // Add the new torrent but don't reset used space immediately
    console.log(`Torrent ${torrent.name} added. Waiting for completion...`);
    
    // Monitor the completion of the torrent
    await monitorTorrentCompletion(torrent);
    
    // After completion, used space will be updated by the monitoring function
}

/**
 * Show immediate feedback when a torrent is being added
 * @param {string} torrentName - Name of the torrent
 * @param {string} torrentHash - Hash of the torrent (optional)
 * @return {HTMLElement} The created notification element
 */
export function showImmediateTorrentFeedback(torrentName, torrentHash) {
    // Create container if it doesn't exist
    let feedbackContainer = document.getElementById('pending-torrents-container');
    
    if (!feedbackContainer) {
        feedbackContainer = document.createElement('div');
        feedbackContainer.id = 'pending-torrents-container';
        feedbackContainer.className = 'pending-torrents-container';
        
        // Add to DOM - position after the torrent controls or at the top of torrent list
        const torrentList = document.getElementById('torrentList');
        if (torrentList && torrentList.parentNode) {
            torrentList.parentNode.insertBefore(feedbackContainer, torrentList);
        } else {
            // Fallback placement
            document.querySelector('.torrent-controls-container').after(feedbackContainer);
        }
        
        // Add styles if not already present
        if (!document.getElementById('pending-torrents-styles')) {
            const style = document.createElement('style');
            style.id = 'pending-torrents-styles';
            style.textContent = `
                .pending-torrents-container {
                    margin: 10px 0;
                    max-height: 0;
                    overflow: hidden;
                    transition: max-height 0.3s ease-in-out;
                }
                .pending-torrents-container.active {
                    max-height: 500px; /* Adjust as needed */
                    border-top: 1px solid rgba(255,255,255,0.1);
                    border-bottom: 1px solid rgba(255,255,255,0.1);
                    padding: 10px 0;
                    margin: 10px 0;
                }
                .pending-torrent-item {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    background-color: rgba(50, 125, 255, 0.1);
                    padding: 10px 15px;
                    margin-bottom: 8px;
                    border-radius: 4px;
                    border-left: 4px solid #327dff;
                    animation: pulse-blue 2s infinite;
                    position: relative;
                    overflow: hidden;
                    transition: opacity 0.5s ease, transform 0.5s ease, max-height 0.5s ease, margin 0.5s ease, padding 0.5s ease;
                }
                .pending-torrent-item.removing {
                    opacity: 0;
                    transform: translateY(-20px);
                    max-height: 0;
                    margin: 0;
                    padding: 0 15px;
                    overflow: hidden;
                }
                @keyframes pulse-blue {
                    0% { background-color: rgba(50, 125, 255, 0.1); }
                    50% { background-color: rgba(50, 125, 255, 0.2); }
                    100% { background-color: rgba(50, 125, 255, 0.1); }
                }
                .pending-torrent-name {
                    font-weight: bold;
                    flex: 1;
                    margin-right: 10px;
                    word-break: break-word;
                }
                .pending-torrent-status {
                    white-space: nowrap;
                    color: #327dff;
                }
                .pending-torrent-item .remove-notification {
                    background: none;
                    border: none;
                    color: #ffffff;
                    opacity: 0.5;
                    cursor: pointer;
                    margin-left: 10px;
                    font-size: 16px;
                    transition: opacity 0.2s;
                }
                .pending-torrent-item .remove-notification:hover {
                    opacity: 1;
                }
                
                /* Slide-in animation for new notifications */
                @keyframes slide-in {
                    from {
                        opacity: 0;
                        transform: translateY(20px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                
                .pending-torrent-item {
                    animation: slide-in 0.3s ease-out forwards, pulse-blue 2s infinite;
                }
            `;
            document.head.appendChild(style);
        }
    }
    
    // Check if a notification already exists for this torrent hash or name
    let existingItem = null;
    if (torrentHash) {
        existingItem = feedbackContainer.querySelector(`.pending-torrent-item[data-hash="${torrentHash}"]`);
    }
    
    // If no hash match, try matching by name
    if (!existingItem && torrentName) {
        const allItems = feedbackContainer.querySelectorAll('.pending-torrent-item');
        for (const item of allItems) {
            const nameEl = item.querySelector('.pending-torrent-name');
            if (nameEl && nameEl.textContent === torrentName) {
                existingItem = item;
                break;
            }
        }
    }
    
    // If notification already exists, update it rather than creating a new one
    if (existingItem) {
        const statusElement = existingItem.querySelector('.pending-torrent-status');
        if (statusElement) {
            statusElement.textContent = 'Starting download...';
        }
        
        // Update hash if we have it now and it wasn't set before
        if (torrentHash && !existingItem.dataset.hash) {
            existingItem.dataset.hash = torrentHash;
        }
        
        return existingItem;
    }
    
    // Create the pending torrent item
    const pendingItem = document.createElement('div');
    pendingItem.className = 'pending-torrent-item';
    if (torrentHash) {
        pendingItem.dataset.hash = torrentHash;
    }
    
    pendingItem.innerHTML = `
        <div class="pending-torrent-name">${torrentName}</div>
        <div class="pending-torrent-status">Starting download...</div>
        <button class="remove-notification" title="Dismiss notification">×</button>
    `;
    
    // Add click handler for the remove button
    const removeButton = pendingItem.querySelector('.remove-notification');
    if (removeButton) {
        removeButton.addEventListener('click', (e) => {
            e.stopPropagation();
            // Use our animation method instead of direct removal
            pendingItem.classList.add('removing');
            setTimeout(() => {
                pendingItem.remove();
                // Hide container if empty
                if (feedbackContainer.children.length === 0) {
                    feedbackContainer.classList.remove('active');
                }
            }, 500);
        });
    }
    
    // Add to container
    feedbackContainer.appendChild(pendingItem);
    
    // Show the container if it was hidden
    feedbackContainer.classList.add('active');
    
    // Return the item so it can be referenced later
    return pendingItem;
}

/**
 * Remove a pending torrent notification with animation
 * @param {string} torrentHash - Hash of the torrent
 */
export function removePendingTorrentFeedback(torrentHash) {
    const feedbackContainer = document.getElementById('pending-torrents-container');
    if (!feedbackContainer) return;
    
    const pendingItem = feedbackContainer.querySelector(`.pending-torrent-item[data-hash="${torrentHash}"]`);
    if (pendingItem) {
        // Add upward fade animation
        pendingItem.style.transition = 'all 0.5s ease';
        pendingItem.style.opacity = '0';
        pendingItem.style.transform = 'translateY(-20px)';
        pendingItem.style.maxHeight = '0';
        pendingItem.style.margin = '0';
        pendingItem.style.padding = '0 15px';
        pendingItem.style.overflow = 'hidden';
        
        // Remove after animation completes
        setTimeout(() => {
            if (pendingItem.parentNode) {
                pendingItem.remove();
            }
            
            // Hide container if empty
            if (feedbackContainer.children.length === 0) {
                feedbackContainer.classList.remove('active');
            }
        }, 500); // Match this to the transition duration
    }
}

/**
 * Check if a pending torrent notification exists
 * @param {string} torrentHash - Hash of the torrent
 * @return {boolean} True if notification exists
 */
export function hasPendingTorrentFeedback(torrentHash) {
    const feedbackContainer = document.getElementById('pending-torrents-container');
    if (!feedbackContainer) return false;
    
    return !!feedbackContainer.querySelector(`.pending-torrent-item[data-hash="${torrentHash}"]`);
}

/**
 * Enhanced version of forceUpdateTorrentUI in torrent-addition.js
 */
export async function forceUpdateTorrentUI(hash) {
  try {
    const lowerHash = hash.toLowerCase();
    console.log(`Force updating UI for torrent: ${lowerHash}`);
    
    // Get current torrent info from cache/userTorrents
    const torrentInfo = await fetchTorrentByHash(lowerHash);
    if (!torrentInfo) {
      console.log(`Torrent ${lowerHash} not found during UI update`);
      
      // ADDED: If torrent not found, check if it's still in the downloadingTorrents array
      if (torrentManager.downloadingTorrents && torrentManager.downloadingTorrents.includes(lowerHash)) {
        console.log(`Removing not found torrent ${lowerHash} from downloadingTorrents array`);
        const index = torrentManager.downloadingTorrents.indexOf(lowerHash);
        if (index !== -1) {
          torrentManager.downloadingTorrents.splice(index, 1);
        }
      }
      
      return false;
    }
    
    // Find the torrent element
    const torrentElement = document.querySelector(`.torrent-item[data-hash="${lowerHash}"]`);
    if (!torrentElement) {
      console.log(`Element for torrent ${lowerHash} not found in DOM`);
      return false;
    }
    
    // CRITICAL FIX: Check if torrent is complete (using threshold of 99.9%)
    const isComplete = (torrentInfo.progress >= 0.999 || torrentInfo.percentDone >= 0.999);
    
    if (isComplete) {
      console.log(`Torrent ${lowerHash} is complete, transforming UI to completed state`);
      
      // ADDED: Make sure it's removed from downloadingTorrents array
      if (torrentManager.downloadingTorrents && torrentManager.downloadingTorrents.includes(lowerHash)) {
        console.log(`Removing completed torrent ${lowerHash} from downloadingTorrents array`);
        const index = torrentManager.downloadingTorrents.indexOf(lowerHash);
        if (index !== -1) {
          torrentManager.downloadingTorrents.splice(index, 1);
        }
      }
      
      // Force setting percentDone to 1 for proper completed display
      if (torrentInfo.percentDone < 1) torrentInfo.percentDone = 1;
      if (torrentInfo.progress < 1) torrentInfo.progress = 1;
      
      // Update the torrent in userTorrents array
      const torrentIndex = torrentManager.userTorrents.findIndex(t => 
        t.hashString && t.hashString.toLowerCase() === lowerHash
      );
      
      if (torrentIndex >= 0) {
        torrentManager.userTorrents[torrentIndex].percentDone = 1;
        console.log(`Updated torrent in userTorrents array to percentDone=1`);
      }
      
      // NEW FIX: Fetch file information before creating completed UI
      if (!torrentInfo.files || torrentInfo.files.length === 0) {
        try {
          console.log(`Fetching files info for completed torrent ${lowerHash}`);
          
          // NEW: Try-catch block for each API call to prevent total failure
          try {
            const fileInfo = await apiClient.qbittorrentRequest('torrents/files', 'GET', { hash: lowerHash });
            
            if (Array.isArray(fileInfo) && fileInfo.length > 0) {
              console.log(`Found ${fileInfo.length} files for torrent ${lowerHash}`);
              torrentInfo.files = fileInfo;
              
              // Also update in userTorrents array
              if (torrentIndex >= 0) {
                torrentManager.userTorrents[torrentIndex].files = fileInfo;
              }
            }
          } catch (fileError) {
            console.log(`Could not fetch file info for ${lowerHash}: ${fileError.message}`);
            // Continue anyway - this shouldn't prevent UI update
          }
        } catch (error) {
          console.error(`Error fetching files for completed torrent ${lowerHash}:`, error);
          // Continue with the update even if file fetching fails
        }
      }
      
      // Check if the element already has the 'downloaded' class
      if (!torrentElement.classList.contains('downloaded')) {
        console.log(`Torrent element doesn't have 'downloaded' class, replacing with new element`);
        
        // Create a completed element using the Templates function
        const newElement = Templates.createTorrentElement(torrentInfo);
        
        // Replace the existing element
        if (torrentElement.parentNode) {
          torrentElement.parentNode.replaceChild(newElement, torrentElement);
          console.log(`Successfully replaced torrent element with completed version`);
          
          // Highlight the new element to draw attention to the change
          newElement.classList.add('highlight-torrent');
          setTimeout(() => {
            newElement.classList.remove('highlight-torrent');
          }, 1500);
          
          return true;
        }
      } else {
        console.log(`Torrent element already has 'downloaded' class`);
        
        // Even if it already has the downloaded class, update the file count if needed
        const fileCountBlob = torrentElement.querySelector('.blob.main:first-child');
        if (fileCountBlob && (torrentInfo.fileCount || torrentInfo.file_count || (torrentInfo.files && torrentInfo.files.length > 0))) {
          const count = torrentInfo.fileCount || torrentInfo.file_count || (torrentInfo.files ? torrentInfo.files.length : 0);
          fileCountBlob.textContent = `${count} Files`;
        }
        
        return true; // Already in completed state
      }
    }
    
    // If we get here, it's a downloading torrent - update its UI
    console.log(`Found torrent element for ${lowerHash}, updating UI...`);
    
    // Get the status block that contains all the blob elements
    const statusBlock = torrentElement.querySelector('.status_block');
    if (!statusBlock) {
      console.log('Status block not found');
      return false;
    }
    
    // 1. Update size display (first yellow blob)
    const sizeBlobs = statusBlock.querySelectorAll('.blob.yellow');
    if (sizeBlobs && sizeBlobs.length > 0) {
      const totalSizeInMB = (torrentInfo.size || torrentInfo.totalSize) / (1024 * 1024);
      const sizeDisplay = totalSizeInMB >= 1024 
          ? `${(totalSizeInMB / 1024).toFixed(1)} GB` 
          : `${totalSizeInMB.toFixed(1)} MB`;
      
      sizeBlobs[0].textContent = sizeDisplay;
    }
    
    // 2. Update file count (find blob with "Files pending")
    const allBlobs = statusBlock.querySelectorAll('.blob');
    for (const blob of allBlobs) {
      if (blob.textContent.includes('Files pending') || blob.textContent.includes('pending') || blob.textContent.includes('0 Files')) {
        // Check if we have files info in the torrent object
        if (torrentInfo.files && Array.isArray(torrentInfo.files) && torrentInfo.files.length > 0) {
          console.log(`Found ${torrentInfo.files.length} files for ${lowerHash}, updating UI`);
          blob.textContent = `${torrentInfo.files.length} Files`;
        } else {
          // If no files info in cached object, check if we can get it from userTorrents
          const existingTorrent = torrentManager.userTorrents.find(t => 
            t.hashString && t.hashString.toLowerCase() === lowerHash
          );
          
          if (existingTorrent && existingTorrent.files && existingTorrent.files.length > 0) {
            blob.textContent = `${existingTorrent.files.length} Files`;
          } else {
            // No files info available, try to fetch it
            try {
              console.log(`No files info available for ${lowerHash}, fetching from API`);
              const filesInfo = await apiClient.qbittorrentRequest('torrents/files', 'GET', { hash: lowerHash });
              
              if (Array.isArray(filesInfo) && filesInfo.length > 0) {
                console.log(`Fetched ${filesInfo.length} files for ${lowerHash}`);
                blob.textContent = `${filesInfo.length} Files`;
                
                // Update the files in userTorrents array
                const torrentIndex = torrentManager.userTorrents.findIndex(t => 
                  t.hashString && t.hashString.toLowerCase() === lowerHash
                );
                
                if (torrentIndex >= 0) {
                  torrentManager.userTorrents[torrentIndex].files = filesInfo;
                }
              } else {
                console.log(`No files found for ${lowerHash}, keeping existing text`);
              }
            } catch (error) {
              console.error(`Error fetching files for ${lowerHash}:`, error);
            }
          }
        }
        break;
      }
    }
    
    // 3. Update peer count (second yellow blob)
    if (sizeBlobs && sizeBlobs.length > 1) {
      const peerCount = torrentInfo.num_leechs || torrentInfo.num_seeds || 0;
      sizeBlobs[1].textContent = `${peerCount} Peers`;
    }
    
    // 4. Update download speed (find blob with "Connecting...")
    for (const blob of allBlobs) {
      if (blob.textContent.includes('Connecting') || blob.textContent === 'N/A') {
        const speedBps = torrentInfo.dlspeed || torrentInfo.rateDownload || 0;
        const formattedSpeed = Utils.formatSpeed(speedBps);
        blob.textContent = formattedSpeed;
        break;
      }
    }
    
    // 5. Update progress
    const progressPercent = ((torrentInfo.progress || torrentInfo.percentDone) * 100).toFixed(1);
    const progressBar = torrentElement.querySelector('.progress-bar');
    if (progressBar) {
      progressBar.style.width = `${progressPercent}%`;
    }
    
    const progressText = torrentElement.querySelector('.progress-text');
    if (progressText) {
      progressText.textContent = `${progressPercent}%`;
    }
    
    // 6. Update ETA if available
    if (torrentInfo.eta && torrentInfo.eta > 0 && torrentInfo.eta < 8640000) {
      let etaBlock = torrentElement.querySelector('.eta-time');
      if (!etaBlock) {
        // Create ETA element if it doesn't exist
        etaBlock = document.createElement('span');
        etaBlock.className = 'blob green eta-time';
        statusBlock.appendChild(etaBlock);
      }
      
      // Update ETA text
      etaBlock.textContent = Utils.formatTimeRemaining(torrentInfo.eta);
    }
    
    console.log(`UI successfully updated for ${lowerHash}`);
    return true;
  } catch (error) {
    console.error(`Error during force UI update: ${error.message}`);
    return false;
  }
}

/**
 * Update a pending torrent's status text
 * @param {string} torrentHash - Hash of the torrent
 * @param {string} statusText - New status text
 */
export function updatePendingTorrentStatus(torrentHash, statusText) {
    const feedbackContainer = document.getElementById('pending-torrents-container');
    if (!feedbackContainer) return;
    
    const pendingItem = feedbackContainer.querySelector(`.pending-torrent-item[data-hash="${torrentHash}"]`);
    if (pendingItem) {
        const statusElement = pendingItem.querySelector('.pending-torrent-status');
        if (statusElement) {
            statusElement.textContent = statusText;
        }
    }
}

/**
 * Check if user can add a torrent based on plan restrictions
 * @return {Promise<Object>} Result with allowed status and message
 */
export async function checkCanAddTorrent() {
    try {
        console.log('Checking if user can add a torrent based on their plan');
        
        const formData = new FormData();
        formData.append('checkCanAddTorrent', true);
        
        const response = await fetch('authentication.php', {
            method: 'POST',
            body: formData,
            credentials: 'same-origin' // Ensure cookies are sent for session authentication
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('Can add torrent check result:', result);
        
        // For Free plan users, we need to ensure the restriction is properly applied
        if (result.plan === 'Free') {
            console.log('Free plan detected, checking torrent count restriction');
            
            // Check if user has any existing torrents
            const existingTorrents = torrentManager.userTorrents || [];
            const hasExistingTorrents = existingTorrents.length > 0;
            
            if (hasExistingTorrents) {
                return {
                    allowed: false,
                    message: 'Free users can only have one active torrent at a time. Please delete an existing torrent before adding a new one.',
                    plan: 'Free',
                    count: existingTorrents.length
                };
            }
            
            // If no existing torrents found in the UI, default to allowing
            return {
                allowed: true,
                message: 'Free plan with no active torrents detected',
                plan: 'Free',
                count: 0
            };
        }
        
        // For other plans, just return the result
        return {
            allowed: result.allowed === true,
            message: result.message || 'Plan check completed',
            plan: result.plan || 'Unknown',
            count: result.count || 0
        };
    } catch (error) {
        console.error('Error checking if user can add torrent:', error);
        
        // Check if user is on Free plan by looking at their torrents
        if (torrentManager.userTorrents && torrentManager.userTorrents.length > 0) {
            return { 
                allowed: false, 
                message: 'Free users can only have one active torrent at a time. Please delete an existing torrent before adding a new one.',
                plan: 'Free',
                count: torrentManager.userTorrents.length
            };
        }
        
        // If there's an error but no torrents, allow the operation
        return { 
            allowed: true, 
            message: 'Error checking plan restrictions, proceeding cautiously.',
            plan: 'Unknown',
            count: 0
        };
    }
}

export async function checkTorrentSizeLimit(torrentSize) {
  try {
    console.log(`Checking if torrent size (${Utils.formatFileSize(torrentSize)}) is within plan limits`);
    
    // Call the PHP function directly
    const formData = new FormData();
    formData.append('checkTorrentSizeLimit', true);
    formData.append('torrentSize', torrentSize);
    
    const response = await fetch('authentication.php', {
      method: 'POST',
      body: formData,
      credentials: 'same-origin'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    
    const result = await response.json();
    
    return {
      allowed: result.allowed === true,
      message: result.message || 'Size check completed'
    };
  } catch (error) {
    console.error('Error checking torrent size limits:', error);
    // Default to false (disallow) to be safe in case of errors
    return { 
      allowed: false, 
      message: 'Error checking size limits: ' + error.message
    };
  }
}

/**
 * Add a torrent from a magnet link
 * @param {string} magnetLink - Magnet link
 * @param {string} dlPath - Download path
 * @return {Promise<boolean>} Success status
 */
export async function addMagnetTorrent(magnetLink, dlPath) {
    try {
        // Ensure valid input
        if (!magnetLink) {
            console.error('No magnet link provided');
            return false;
        }
        
        // Clean the magnet link to remove blocked trackers
        const originalLength = magnetLink.length;
        const cleanedMagnet = cleanMagnetLink(magnetLink);
        
        // Log if trackers were removed
        if (cleanedMagnet.length !== originalLength) {
            console.log(`Cleaned magnet link: removed ${originalLength - cleanedMagnet.length} characters (blocked trackers)`);
        }
        
        // Use the cleaned magnet link from now on
        magnetLink = cleanedMagnet;
        
        // Extract info from magnet link
        const nameMatch = magnetLink.match(/dn=([^&]+)/i);
        const hashMatch = magnetLink.match(/btih:([^&]+)/i);
        
        let torrentName = 'Unknown Torrent';
        let torrentHash = '';
        
        if (nameMatch) {
            torrentName = decodeURIComponent(nameMatch[1]);
        }
        
        if (hashMatch) {
            torrentHash = hashMatch[1].toLowerCase();
        }
        
        // Check if torrent exists using optimized single-torrent fetch
        const existingTorrent = await fetchTorrentByHash(torrentHash);
        
        // If torrent exists, get its size for space check
        let estimatedSize = 0;
        if (existingTorrent) {
            estimatedSize = existingTorrent.size || 0;
            console.log(`Torrent already exists in qBittorrent, size: ${Utils.formatFileSize(estimatedSize)}`);
        } else {
            // Use a conservative estimate for new torrents
            estimatedSize = 1 * 1024 * 1024 * 1024; // 1GB as estimate
            console.log(`New torrent, using estimated size: ${Utils.formatFileSize(estimatedSize)}`);
        }
        
        // Check if we have enough space
        const spaceCheck = await apiClient.checkSpaceForTorrent(estimatedSize);
        
        if (!spaceCheck.success) {
            alert(`Cannot add torrent: ${spaceCheck.message}\nNeeded: ${Utils.formatFileSize(spaceCheck.needed)}\nAvailable: ${Utils.formatFileSize(spaceCheck.available)}`);
            return false;
        }
        
        let addSuccess = false;
        
        if (existingTorrent) {
            console.log(`Torrent with hash ${torrentHash} already exists, skipping qBittorrent add`);
            addSuccess = true; // Consider it a success since we'll use the existing one
        } else {
            // Extract user email from the download path
            const userEmail = Utils.extractUserEmailFromPath(dlPath);
            
            // Torrent doesn't exist, add it to qBittorrent
            const params = new FormData();
            params.append('urls', magnetLink);
            params.append('savepath', dlPath);
            // Set the category to the user's email
            params.append('category', userEmail);
            
            const result = await apiClient.qbittorrentRequest('torrents/add', 'POST', params);
            
            // qBittorrent returns "Ok." as plain text on success
            if (result === 'Ok.' || result === '') {
                addSuccess = true;
            } else {
                throw new Error('Failed to add torrent: ' + result);
            }
        }
        
        return addSuccess;
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to add torrent: ' + error.message);
        return false;
    }
}

/**
 * Add a torrent from a torrent file
 * @param {File} file - Torrent file
 * @param {string} dlPath - Download path
 * @return {Promise<Object>} Result with success status, hash, name and magnet link
 */
export async function addTorrentFile(file, dlPath) {
    if (!file) {
        return {
            success: false,
            message: 'No file provided'
        };
    }

    try {
        // Parse the torrent and generate magnet link
        const torrentInfo = await Utils.parseTorrentFile(file);
        if (!torrentInfo) {
            throw new Error('Failed to parse torrent file');
        }
        
        let torrentName = torrentInfo.name;
        const torrentHash = torrentInfo.infoHash;
        
        // Clean the magnet link to remove blocked trackers
        const originalMagnet = torrentInfo.magnetLink;
        const cleanedMagnet = cleanMagnetLink(originalMagnet);
        
        // Log if trackers were removed
        if (cleanedMagnet.length !== originalMagnet.length) {
            console.log(`Cleaned magnet link from torrent file: removed ${originalMagnet.length - cleanedMagnet.length} characters (blocked trackers)`);
        }
        
        // Use the cleaned magnet link
        const magnetLink = cleanedMagnet;
        
        // Check if torrent exists using optimized single-torrent fetch
        const existingTorrent = await fetchTorrentByHash(torrentHash);
        
        // If torrent exists, get its size for space check
        let estimatedSize = 0;
        if (existingTorrent) {
            estimatedSize = existingTorrent.size || 0;
            console.log(`Torrent already exists in qBittorrent, size: ${Utils.formatFileSize(estimatedSize)}`);
        } else {
            // Use a conservative estimate for new torrents
            estimatedSize = 1 * 1024 * 1024 * 1024; // 1GB as estimate
            console.log(`New torrent, using estimated size: ${Utils.formatFileSize(estimatedSize)}`);
        }
        
        // Check if we have enough space
        const spaceCheck = await apiClient.checkSpaceForTorrent(estimatedSize);
        
        if (!spaceCheck.success) {
            return {
                success: false,
                message: `Cannot add torrent: ${spaceCheck.message}. Needed: ${Utils.formatFileSize(spaceCheck.needed)}, Available: ${Utils.formatFileSize(spaceCheck.available)}`
            };
        }
        
        let addSuccess = false;
        
        if (existingTorrent) {
            console.log(`Torrent with hash ${torrentHash} already exists, skipping qBittorrent add`);
            addSuccess = true; // Consider it a success since we'll use the existing one
        } else {
            // Extract user email from the download path
            const userEmail = Utils.extractUserEmailFromPath(dlPath);
            
            // Upload to qBittorrent
            const formData = new FormData();
            formData.append('torrents', file);
            formData.append('savepath', dlPath);
            // Set the category to the user's email
            formData.append('category', userEmail);
            
            const result = await apiClient.qbittorrentRequest('torrents/add', 'POST', formData);

            // qBittorrent returns "Ok." as plain text on success
            if (result === 'Ok.' || result === '') {
                addSuccess = true;
            } else {
                throw new Error('Failed to add torrent: ' + result);
            }
        }
        
        if (addSuccess) {
            return {
                success: true,
                torrentName,
                torrentHash,
                magnetLink
            };
        } else {
            return {
                success: false,
                message: 'Failed to add torrent file'
            };
        }
    } catch (error) {
        console.error('Error:', error);
        return {
            success: false,
            message: 'Failed to add torrent file: ' + error.message
        };
    }
}

/**
 * Download .torrent file from a URL, then parse and start the download
 * @param {string} torrentUrl - URL to the .torrent file
 * @return {Promise<boolean>} Success status
 */
export async function downloadTorrentFromUrl(torrentUrl) {
  try {
    console.log(`Downloading .torrent file from URL: ${torrentUrl}`);
    
    // Show immediate feedback notification
    const torrentName = 'Downloading torrent file...';
    const pendingItem = showImmediateTorrentFeedback(torrentName, '');
    
    // Download the torrent file using fetch
    const response = await fetch(torrentUrl, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-cache',
    });
    
    if (!response.ok) {
      throw new Error(`Failed to download torrent file: ${response.status} ${response.statusText}`);
    }
    
    // Get the torrent file as a blob
    const torrentBlob = await response.blob();
    
    // Create a File object from the blob
    const fileName = getFileNameFromUrl(torrentUrl) || 'downloaded.torrent';
    const torrentFile = new File([torrentBlob], fileName, { type: 'application/x-bittorrent' });
    
    // Check plan restrictions before proceeding
    updatePendingTorrentStatus('', 'Checking plan restrictions...');
    
    const canAddResponse = await checkCanAddTorrent();
    
    if (!canAddResponse.allowed) {
      console.log('Plan check failed:', canAddResponse);
      removePendingTorrentFeedback('');
      alert(canAddResponse.message);
      return false;
    }
    
    // Process the downloaded torrent file
    updatePendingTorrentStatus('', 'Adding torrent...');
    
    // Add the torrent using the existing addTorrentFile function
    const addResult = await addTorrentFile(torrentFile, torrentManager.dlPath);
    
    if (!addResult.success) {
      console.log('Failed to add torrent:', addResult.message);
      removePendingTorrentFeedback('');
      alert(addResult.message);
      return false;
    }
    
    // Update pending notification with hash if we have it now
    if (addResult.torrentHash && pendingItem) {
      pendingItem.dataset.hash = addResult.torrentHash;
    }
    
    // Check for existing torrent in UI after getting hash from API
    if (addResult.torrentHash) {
      const existingTorrentInUI = document.querySelector(`.torrent-item[data-hash="${addResult.torrentHash.toLowerCase()}"]`);
      
      if (existingTorrentInUI) {
        console.log(`Torrent with hash ${addResult.torrentHash} found in UI after file addition, highlighting it`);
        
        // Remove pending notification
        removePendingTorrentFeedback(addResult.torrentHash);
        
        // Scroll to and highlight the existing torrent
        existingTorrentInUI.scrollIntoView({ behavior: 'smooth', block: 'center' });
        existingTorrentInUI.classList.add('highlight-torrent');
        
        // Remove highlight after animation completes
        setTimeout(() => {
          existingTorrentInUI.classList.remove('highlight-torrent');
        }, 3000);
        
        return true;
      }
    }
    
    // Update database with torrent info
    updatePendingTorrentStatus(addResult.torrentHash, 'Adding to database...');
    
    const formData = new FormData();
    formData.append('torrentName', addResult.torrentName);
    formData.append('torrentHash', addResult.torrentHash);
    formData.append('torrentMagnet', addResult.magnetLink);
    formData.append('torrentSize', addResult.torrentSize || 0);
    formData.append('insertTorrent', true);

    const response2 = await fetch("dbInfoFeeder.php", {
      method: "POST",
      body: formData
    });
    
    const jsonResponse = await response2.json();
    
    if (jsonResponse.success) {
      console.log("Torrent added to database successfully");
      
      // CRITICAL: Check if torrent already exists in UI one last time before adding placeholder
      const existingTorrent = document.querySelector(`.torrent-item[data-hash="${addResult.torrentHash.toLowerCase()}"]`);
      if (existingTorrent) {
        console.log(`Torrent already exists in UI, not adding placeholder`);
        removePendingTorrentFeedback(addResult.torrentHash);
        
        // Highlight the existing torrent
        existingTorrent.scrollIntoView({ behavior: 'smooth', block: 'center' });
        existingTorrent.classList.add('highlight-torrent');
        
        // Remove highlight after animation completes
        setTimeout(() => {
          existingTorrent.classList.remove('highlight-torrent');
        }, 3000);
        
        return true;
      }
      
      // Create a placeholder entry in the UI
      updatePendingTorrentStatus(addResult.torrentHash, 'Adding to interface...');
      
      // Create a placeholder with initial info
      const initialInfo = {
        percentDone: 0,
        status: 4, // Downloading
        totalSize: 0, // Start with 0, will be updated when metadata arrives
        peersConnected: 0,
        rateDownload: 0,
        eta: 0,
        files: []
      };
      
      // Add it to the UI
      const torrentList = document.getElementById('torrentList');
      if (torrentList) {
        // Get placeholder element
        const placeholderElement = Templates.createPlaceholderTorrentElement(
          addResult.torrentHash, 
          addResult.torrentName, 
          initialInfo
        );
        
        // If the only element is "No active torrents", remove it
        if (torrentList.children.length === 1 && 
            torrentList.children[0].textContent === 'No active torrents') {
          torrentList.innerHTML = '';
        }
        
        // Add to the beginning of the list
        if (torrentList.firstChild) {
          torrentList.insertBefore(placeholderElement, torrentList.firstChild);
        } else {
          torrentList.appendChild(placeholderElement);
        }
        
        // Add to userTorrents array
        const torrentData = {
          id: addResult.torrentHash,
          hashString: addResult.torrentHash,
          name: addResult.torrentName,
          addedDate: Date.now(),
          percentDone: 0,
          status: 4, // Downloading
          totalSize: 0, // Start with 0, metadata monitoring will update this
          peersConnected: 0,
          rateDownload: 0,
          eta: 0,
          files: []
        };
        
        // Add to beginning of array
        torrentManager.userTorrents.unshift(torrentData);
        
        // Update torrent stats
        if (typeof torrentManager.updateTorrentStats === 'function') {
          torrentManager.updateTorrentStats(torrentManager.userTorrents);
        }
      }
      
      // Remove the pending notification
      removePendingTorrentFeedback(addResult.torrentHash);
      
      // Add to downloading torrents tracking
      if (addResult.torrentHash && !torrentManager.downloadingTorrents.includes(addResult.torrentHash.toLowerCase())) {
        torrentManager.downloadingTorrents.push(addResult.torrentHash.toLowerCase());
      }
      
      // Start enhanced monitoring for new torrent
      if (typeof torrentManager.startNewTorrentMonitoring === 'function') {
        torrentManager.startNewTorrentMonitoring(addResult.torrentHash.toLowerCase(), addResult.torrentName);
      }
            
      return true;
    } else {
      // Handle database error responses
      if (jsonResponse.message && jsonResponse.message.includes("Not enough disk space")) {
        console.log('Not enough disk space, cleaning up');
        if (typeof torrentManager.deleteTorrent === 'function') {
          await torrentManager.deleteTorrent(addResult.torrentHash);
        }
        removePendingTorrentFeedback(addResult.torrentHash);
        alert("Not enough disk space to add this torrent. Please free up some space.");
        return false;
      }
      
      if (jsonResponse.message && jsonResponse.message.includes("duplicate")) {
        console.log("Duplicate detected in database - torrent already exists");
        removePendingTorrentFeedback(addResult.torrentHash);
        
        // Check if we can find the existing torrent in the UI
        const existingTorrent = document.querySelector(`.torrent-item[data-hash="${addResult.torrentHash.toLowerCase()}"]`);
        
        if (existingTorrent) {
          console.log(`Found existing torrent in UI, highlighting it`);
          
          // Highlight the existing torrent
          existingTorrent.scrollIntoView({ behavior: 'smooth', block: 'center' });
          existingTorrent.classList.add('highlight-torrent');
          
          // Remove highlight after animation completes
          setTimeout(() => {
            existingTorrent.classList.remove('highlight-torrent');
          }, 3000);
          
          return true;
        }
        
        // If not found in UI, do a targeted refresh to get just this torrent
        console.log('Targeted refresh to show duplicate torrent');
        if (addResult.torrentHash && typeof torrentManager.fetchTorrentByHash === 'function') {
          const torrentInfo = await torrentManager.fetchTorrentByHash(addResult.torrentHash);
          
          if (torrentInfo) {
            // Check if it's now in UI after the targeted fetch
            const refreshedTorrent = document.querySelector(`.torrent-item[data-hash="${addResult.torrentHash.toLowerCase()}"]`);
            
            if (refreshedTorrent) {
              refreshedTorrent.scrollIntoView({ behavior: 'smooth', block: 'center' });
              refreshedTorrent.classList.add('highlight-torrent');
              
              setTimeout(() => {
                refreshedTorrent.classList.remove('highlight-torrent');
              }, 3000);
              
              return true;
            }
          }
        }
        
        // Last resort: minimal targeted refresh
        if (typeof torrentManager.fetchTorrents === 'function') {
          await torrentManager.fetchTorrentsInBackground();
        }
        
        return true;
      } else {
        console.error("Database update error:", jsonResponse.message || "Unknown error");
        
        // Clean up - delete from qBittorrent if it was added there
        if (typeof torrentManager.deleteTorrent === 'function') {
          await torrentManager.deleteTorrent(addResult.torrentHash);
        }
        
        removePendingTorrentFeedback(addResult.torrentHash);
        alert("Failed to add torrent to your account: " + 
             (jsonResponse.message || "Unknown error"));
        return false;
      }
    }
  } catch (error) {
    console.error('Error downloading torrent from URL:', error);
    removePendingTorrentFeedback('');
    alert('Failed to download torrent file: ' + error.message);
    return false;
  }
}

/**
 * Extract filename from URL
 * @param {string} url - URL of the .torrent file
 * @return {string|null} Filename or null if not found
 */
function getFileNameFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const segments = pathname.split('/');
    const lastSegment = segments[segments.length - 1];
    
    // If last segment contains a filename with .torrent extension
    if (lastSegment && lastSegment.toLowerCase().endsWith('.torrent')) {
      return lastSegment;
    }
    
    // Generate a random filename if no valid name found
    return 'torrent_' + Math.floor(Math.random() * 100000) + '.torrent';
  } catch (error) {
    console.error('Error extracting filename from URL:', error);
    return null;
  }
}

/**
 * Check if a string is a valid URL
 * @param {string} text - Text to check
 * @return {boolean} True if it's a valid URL
 */
export function isValidUrl(text) {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

/**
 * Check if a URL is a torrent file URL
 * @param {string} url - URL to check
 * @return {boolean} True if it seems to be a torrent file URL
 */
export function isTorrentFileUrl(url) {
  // Check if the URL ends with .torrent
  if (url.toLowerCase().endsWith('.torrent')) {
    return true;
  }
  
  // Check if the URL contains a torrent file name pattern
  if (url.toLowerCase().includes('.torrent?') || 
      url.toLowerCase().includes('/download/') ||
      url.match(/\/torrents?\/download\/[a-zA-Z0-9]+/i)) {
    return true;
  }
  
  return false;
}

/**
 * Modified startDownload function to support torrent file URLs and tracker filtering
 * @return {Promise<boolean>} Success status
 */
export async function startDownload() {
  const magnetInput = document.getElementById('magnetLink');
  const fileInput = document.getElementById('torrentFile');

  // Store input values before doing anything else
  const magnetLinkValue = magnetInput.value.trim();
  const fileValue = fileInput.files ? fileInput.files[0] : null;
  
  // Check if inputs are provided - BEFORE clearing them
  if (!magnetLinkValue && (!fileInput.files || fileInput.files.length === 0)) {
    alert('Please enter a magnet link, torrent URL, or select a torrent file');
    return false;
  }

  // Check if the input is a torrent file URL
  if (magnetLinkValue && isValidUrl(magnetLinkValue) && isTorrentFileUrl(magnetLinkValue)) {
    console.log('Identified torrent file URL:', magnetLinkValue);
    
    // Clear the input field immediately
    magnetInput.value = '';
    
    // Process the torrent file URL
    return await downloadTorrentFromUrl(magnetLinkValue);
  }

  // Store values for later use
  let torrentName = 'fetching name..';
  let torrentHash = '';
  let magnetLink = '';

  // Store magnetLink value and clean it if it's a magnet link
  if (magnetLinkValue) {
    // Check if it's a magnet link and clean it
    if (magnetLinkValue.startsWith('magnet:')) {
      // Apply tracker filtering to the magnet link
      const originalLength = magnetLinkValue.length;
      const cleanedMagnet = cleanMagnetLink(magnetLinkValue);
      
      // Log if trackers were removed
      if (cleanedMagnet.length !== originalLength) {
        console.log(`Cleaned magnet link: removed ${originalLength - cleanedMagnet.length} characters (blocked trackers)`);
      }
      
      magnetLink = cleanedMagnet;
    } else {
      // Not a magnet link, use as is
      magnetLink = magnetLinkValue;
    }
    
    // Extract info from magnet link
    const nameMatch = magnetLink.match(/dn=([^&]+)/i);
    const hashMatch = magnetLink.match(/btih:([^&]+)/i);
    
    if (nameMatch) {
      torrentName = decodeURIComponent(nameMatch[1]);
    }
    
    if (hashMatch) {
      torrentHash = hashMatch[1].toLowerCase();
    }
  } else if (fileValue) {
    // For torrent files, parse the file to extract hash before proceeding
    try {
      const torrentInfo = await Utils.parseTorrentFile(fileValue);
      if (torrentInfo) {
        torrentName = torrentInfo.name;
        torrentHash = torrentInfo.infoHash.toLowerCase();
        
        // Clean the magnet link from the parsed torrent file
        const originalMagnet = torrentInfo.magnetLink;
        const cleanedMagnet = cleanMagnetLink(originalMagnet);
        
        // Log if trackers were removed
        if (cleanedMagnet.length !== originalMagnet.length) {
          console.log(`Cleaned magnet link from torrent file: removed ${originalMagnet.length - cleanedMagnet.length} characters (blocked trackers)`);
        }
        
        magnetLink = cleanedMagnet;
        console.log(`Parsed torrent file: ${torrentName}, hash: ${torrentHash}`);
      }
    } catch (error) {
      console.error('Error parsing torrent file:', error);
      // Continue with the process, we'll get hash later
    }
  }

  // Clear input fields only AFTER storing the values
  magnetInput.value = '';
  if (fileInput) {
    fileInput.value = '';
  }
  if (document.getElementById('magnetLink')) {
    document.getElementById('magnetLink').placeholder = 'Paste magnet link here';
  }

  // Check for existing torrent in UI for both magnet links and torrent files
  if (torrentHash) {
    const existingTorrentInUI = document.querySelector(`.torrent-item[data-hash="${torrentHash.toLowerCase()}"]`);

    if (existingTorrentInUI) {
      console.log(`Torrent with hash ${torrentHash} already exists in UI, highlighting it`);
      
      // Scroll to and highlight the existing torrent
      existingTorrentInUI.scrollIntoView({ behavior: 'smooth', block: 'center' });
      existingTorrentInUI.classList.add('highlight-torrent');
      
      // Remove highlight after animation completes
      setTimeout(() => {
        existingTorrentInUI.classList.remove('highlight-torrent');
      }, 3000);
      
      return true; // Exit early - no need to show notification or proceed further
    }
  }

  // Now check if any "Adding torrent..." notification with the same name exists and remove it
  const existingNotifications = document.querySelectorAll('.pending-torrent-item');
  for (const notification of existingNotifications) {
    const notificationName = notification.querySelector('.pending-torrent-name')?.textContent;
    if (notificationName === torrentName) {
      // Remove the duplicate notification
      notification.remove();
      console.log(`Removed duplicate notification for ${torrentName}`);
    }
  }

  // Only now show the immediate feedback notification
  const pendingItem = showImmediateTorrentFeedback(torrentName, torrentHash);
  
  // Continue with rest of method (plan restrictions, etc.)
  try {
    console.log('Checking plan restrictions');
    updatePendingTorrentStatus(torrentHash, 'Checking plan restrictions...');
    
    const canAddResponse = await checkCanAddTorrent();
    
    if (!canAddResponse.allowed) {
      console.log('Plan check failed:', canAddResponse);
      removePendingTorrentFeedback(torrentHash);
      alert(canAddResponse.message);
      return false;
    }
    
    console.log('Plan check passed, proceeding with download');
  } catch (error) {
    console.error('Error checking plan restrictions:', error);
    removePendingTorrentFeedback(torrentHash);
    alert('Error verifying your plan restrictions. Please try again.');
    return false;
  }

  // Add the torrent based on input type
  try {
    updatePendingTorrentStatus(torrentHash, 'Adding torrent...');
    
    let success = false;
    let addResult = {};
    
    if (magnetLinkValue) {
      success = await addMagnetTorrent(magnetLink, torrentManager.dlPath);
    } else if (fileValue) {
      addResult = await addTorrentFile(fileValue, torrentManager.dlPath);
      success = addResult.success;
      
      // Update torrent info if it was successful
      if (success) {
        torrentName = addResult.torrentName || torrentName;
        torrentHash = addResult.torrentHash || torrentHash;
        magnetLink = addResult.magnetLink || magnetLink;
        
        // Update pending notification with hash if we have it now
        if (torrentHash && pendingItem) {
          pendingItem.dataset.hash = torrentHash;
        }
        
        // Check for existing torrent in UI again after getting hash from API
        if (torrentHash) {
          const existingTorrentInUI = document.querySelector(`.torrent-item[data-hash="${torrentHash.toLowerCase()}"]`);
          
          if (existingTorrentInUI) {
            console.log(`Torrent with hash ${torrentHash} found in UI after file addition, highlighting it`);
            
            // Remove pending notification
            removePendingTorrentFeedback(torrentHash);
            
            // Scroll to and highlight the existing torrent
            existingTorrentInUI.scrollIntoView({ behavior: 'smooth', block: 'center' });
            existingTorrentInUI.classList.add('highlight-torrent');
            
            // Remove highlight after animation completes
            setTimeout(() => {
              existingTorrentInUI.classList.remove('highlight-torrent');
            }, 3000);
            
            return true; // Exit early - no need to proceed further
          }
        }
      }
    }
    
    if (!success) {
      console.log('Failed to add torrent to qBittorrent');
      removePendingTorrentFeedback(torrentHash);
      return false;
    }
    
    // Update database with torrent info
    updatePendingTorrentStatus(torrentHash, 'Adding to database...');
    
    const formData = new FormData();
    formData.append('torrentName', torrentName);
    formData.append('torrentHash', torrentHash);
    formData.append('torrentMagnet', magnetLink); // Using the cleaned magnet link
    formData.append('torrentSize', addResult.torrentSize || 0);
    formData.append('insertTorrent', true);

    const response = await fetch("dbInfoFeeder.php", {
      method: "POST",
      body: formData
    });
    
    const jsonResponse = await response.json();
    
    // Handle database response
    if (jsonResponse.success) {
      console.log("Torrent added to database successfully");
      
      // CRITICAL: Check if torrent already exists in UI one last time before adding placeholder
      const existingTorrent = document.querySelector(`.torrent-item[data-hash="${torrentHash.toLowerCase()}"]`);
      if (existingTorrent) {
        console.log(`Torrent already exists in UI, not adding placeholder`);
        removePendingTorrentFeedback(torrentHash);
        
        // Highlight the existing torrent
        existingTorrent.scrollIntoView({ behavior: 'smooth', block: 'center' });
        existingTorrent.classList.add('highlight-torrent');
        
        // Remove highlight after animation completes
        setTimeout(() => {
          existingTorrent.classList.remove('highlight-torrent');
        }, 3000);
        
        return true;
      }
      
      // Create a placeholder entry in the UI
      updatePendingTorrentStatus(torrentHash, 'Adding to interface...');
      
      // Create a placeholder with initial info
      const initialInfo = {
        percentDone: 0,
        status: 4, // Downloading
        totalSize: 0, // Start with 0, will be updated when metadata arrives
        peersConnected: 0,
        rateDownload: 0,
        eta: 0,
        files: []
      };
      
      // Add it to the UI
      const torrentList = document.getElementById('torrentList');
      if (torrentList) {
        // Get placeholder element
        const placeholderElement = Templates.createPlaceholderTorrentElement(torrentHash, torrentName, initialInfo);
        
        // If the only element is "No active torrents", remove it
        if (torrentList.children.length === 1 && 
            torrentList.children[0].textContent === 'No active torrents') {
          torrentList.innerHTML = '';
        }
        
        // Add to the beginning of the list
        if (torrentList.firstChild) {
          torrentList.insertBefore(placeholderElement, torrentList.firstChild);
        } else {
          torrentList.appendChild(placeholderElement);
        }
        
        // Add to userTorrents array
        const torrentData = {
          id: torrentHash,
          hashString: torrentHash,
          name: torrentName,
          addedDate: Date.now(),
          percentDone: 0,
          status: 4, // Downloading
          totalSize: 0, // Start with 0, metadata monitoring will update this
          peersConnected: 0,
          rateDownload: 0,
          eta: 0,
          files: []
        };
        
        // Add to beginning of array
        torrentManager.userTorrents.unshift(torrentData);
        
        // Update torrent stats
        if (typeof torrentManager.updateTorrentStats === 'function') {
          torrentManager.updateTorrentStats(torrentManager.userTorrents);
        }
      }
      
      // Remove the pending notification since we now have a placeholder in the UI
      removePendingTorrentFeedback(torrentHash);
      
      // Add to downloading torrents tracking
      if (torrentHash && !torrentManager.downloadingTorrents.includes(torrentHash.toLowerCase())) {
        torrentManager.downloadingTorrents.push(torrentHash.toLowerCase());
      }
      
      // Start enhanced monitoring for new torrent
      if (typeof torrentManager.startNewTorrentMonitoring === 'function') {
        torrentManager.startNewTorrentMonitoring(torrentHash.toLowerCase(), torrentName);
      }
          
      return true;
    } else {
      // Handle database error responses
      if (jsonResponse.message && jsonResponse.message.includes("Not enough disk space")) {
        console.log('Not enough disk space, cleaning up');
        if (typeof torrentManager.deleteTorrent === 'function') {
          await torrentManager.deleteTorrent(torrentHash);
        }
        removePendingTorrentFeedback(torrentHash);
        alert("Not enough disk space to add this torrent. Please free up some space.");
        return false;
      }
      
      if (jsonResponse.message && jsonResponse.message.includes("duplicate")) {
        console.log("Duplicate detected in database - torrent already exists");
        removePendingTorrentFeedback(torrentHash);
        
        // Check if we can find the existing torrent in the UI
        const existingTorrent = document.querySelector(`.torrent-item[data-hash="${torrentHash.toLowerCase()}"]`);
        
        if (existingTorrent) {
          console.log(`Found existing torrent in UI, highlighting it`);
          
          // Highlight the existing torrent
          existingTorrent.scrollIntoView({ behavior: 'smooth', block: 'center' });
          existingTorrent.classList.add('highlight-torrent');
          
          // Remove highlight after animation completes
          setTimeout(() => {
            existingTorrent.classList.remove('highlight-torrent');
          }, 3000);
          
          return true;
        }
        
        // If not found in UI, do a targeted refresh to get just this torrent
        console.log('Targeted refresh to show duplicate torrent');
        if (torrentHash && typeof torrentManager.fetchTorrentByHash === 'function') {
          const torrentInfo = await torrentManager.fetchTorrentByHash(torrentHash);
          
          if (torrentInfo) {
            // Check if it's now in UI after the targeted fetch
            const refreshedTorrent = document.querySelector(`.torrent-item[data-hash="${torrentHash.toLowerCase()}"]`);
            
            if (refreshedTorrent) {
              refreshedTorrent.scrollIntoView({ behavior: 'smooth', block: 'center' });
              refreshedTorrent.classList.add('highlight-torrent');
              
              setTimeout(() => {
                refreshedTorrent.classList.remove('highlight-torrent');
              }, 3000);
              
              return true;
            }
          }
        }
        
        // Last resort: minimal targeted refresh
        if (typeof torrentManager.fetchTorrents === 'function') {
          // Call with false to avoid showing skeleton loader
          await torrentManager.fetchTorrentsInBackground();
        }
        
        return true;
      } else {
        console.error("Database update error:", jsonResponse.message || "Unknown error");
        
        // Clean up - delete from qBittorrent if it was added there
        if (typeof torrentManager.deleteTorrent === 'function') {
          await torrentManager.deleteTorrent(torrentHash);
        }
        
        removePendingTorrentFeedback(torrentHash);
        alert("Failed to add torrent to your account: " + 
             (jsonResponse.message || "Unknown error"));
        return false;
      }
    }
  } catch (error) {
    console.error("Error in startDownload:", error);
    
    // Clean up if an error occurred
    if (torrentHash && typeof torrentManager.deleteTorrent === 'function') {
      await torrentManager.deleteTorrent(torrentHash);
    }
    
    removePendingTorrentFeedback(torrentHash);
    alert("Failed to add torrent: " + error.message);
    return false;
  }
}