#!/usr/bin/env node

const path = require('path');
const { exec } = require('child_process');
const axios = require('axios');
const fs = require('fs');
// Using fs.rmSync instead of rimraf (available in Node.js 14.14.0+)

// Configuration
const QBITTORRENT_URL = 'http://0.0.0.0:8080/api/v2';
const API_URL = 'http://152.53.253.51:5000/';
const QB_USERNAME = 'admin';
const QB_PASSWORD = 'admin123';

// Feature toggles
const DELETE_AFTER_UPLOAD = true; // Delete any file after upload (zip or regular file)
const STOP_TORRENT_AFTER_UPLOAD = true; // Stop torrent after successful upload
const DELETE_DIRECTORY_AFTER_UPLOAD = true; // Delete the original directory after upload

// Command line arguments from qBittorrent
// %N (torrent name), %I (torrent hash), %D (save path), %R (root path), %L (category)
const torrentName = process.argv[2] || '';
const torrentHash = process.argv[3] || '';
const savePath = process.argv[4] || '';
const rootPath = process.argv[5] || '';
const category = process.argv[6] || '';

// Check for required parameters
if (!torrentHash) {
  console.error("ERROR: Missing required parameter: torrent hash. This script must be called from qBittorrent.");
  process.exit(1);
}

// Logger function
const log = (message) => console.log(`${new Date().toLocaleTimeString()} - ${message}`);

// Display initial torrent info
log("==== TORRENT INFO ====");
log(`Name: ${torrentName}`);
log(`Hash: ${torrentHash}`);
log(`Save Path: ${savePath}`);
log(`Root Path: ${rootPath || '(None)'}`);
log(`Category: ${category || '(None)'}`);
log("=====================");
log(`Config - Delete after upload: ${DELETE_AFTER_UPLOAD}`);
log(`Config - Stop torrent after upload: ${STOP_TORRENT_AFTER_UPLOAD}`);
log(`Config - Delete directory after upload: ${DELETE_DIRECTORY_AFTER_UPLOAD}`);

// Create axios instance for qBittorrent API
const qbt = axios.create({
  baseURL: QBITTORRENT_URL,
  timeout: 30000
});

// Create axios instance for zip server API
const zipServer = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' }
});

/**
 * Login to qBittorrent API
 * @returns {Promise<string>} Authentication cookie or null
 */
async function qbLogin() {
  try {
    const params = new URLSearchParams();
    params.append('username', QB_USERNAME);
    params.append('password', QB_PASSWORD);
    
    const response = await qbt.post('/auth/login', params);
    
    if (response.status === 200 && response.data === 'Ok.') {
      log('Successfully logged into qBittorrent');
      return response.headers['set-cookie'] ? response.headers['set-cookie'][0] : '';
    }
    log(`Failed to login to qBittorrent: ${response.data}`);
    return null;
  } catch (error) {
    log(`Error logging into qBittorrent: ${error.message}`);
    return null;
  }
}

/**
 * Stop a torrent in qBittorrent
 * @param {string} hash Torrent hash to stop
 * @returns {Promise<boolean>} Success status
 */
async function stopTorrent(hash) {
  if (!STOP_TORRENT_AFTER_UPLOAD) {
    log('Skipping torrent stop (STOP_TORRENT_AFTER_UPLOAD is false)');
    return false;
  }

  try {
    const cookie = await qbLogin();
    if (!cookie) return false;
    
    const params = new URLSearchParams();
    params.append('hashes', hash);
    
    const response = await qbt.post('/torrents/stop', params, {
      headers: { Cookie: cookie }
    });
    
    log(`Stopped torrent: ${hash}`);
    return true;
  } catch (error) {
    log(`Error stopping torrent: ${error.message}`);
    return false;
  }
}

/**
 * Set tag for a torrent
 * @param {string} hash Torrent hash
 * @param {string} tag Tag to set
 * @returns {Promise<boolean>} Success status
 */
async function setTag(hash, tag) {
  try {
    const cookie = await qbLogin();
    if (!cookie) return false;
    
    // Remove existing tags first
    const removeParams = new URLSearchParams();
    removeParams.append('hashes', hash);
    await qbt.post('/torrents/removeTags', removeParams, {
      headers: { Cookie: cookie }
    });
    
    // Add the new tag
    const params = new URLSearchParams();
    params.append('hashes', hash);
    params.append('tags', tag);
    await qbt.post('/torrents/addTags', params, {
      headers: { Cookie: cookie }
    });
    
    log(`Set torrent tag: ${tag}`);
    return true;
  } catch (error) {
    log(`Tag error: ${error.message}`);
    return false;
  }
}

/**
 * Get torrent category if not already provided
 * @param {string} hash Torrent hash
 * @returns {Promise<string>} Category name or empty string
 */
async function getTorrentCategory(hash) {
  // If category is already provided via command line, use it
  if (category) return category;
  
  try {
    const cookie = await qbLogin();
    if (!cookie) return '';
    
    const response = await qbt.get('/torrents/info', {
      params: { hashes: hash },
      headers: { Cookie: cookie }
    });
    
    if (response.status === 200 && response.data && response.data.length > 0) {
      const torrentCategory = response.data[0].category || '';
      log(`Retrieved category from qBittorrent: ${torrentCategory}`);
      return torrentCategory;
    }
    return '';
  } catch (error) {
    log(`Error getting torrent category: ${error.message}`);
    return '';
  }
}

/**
 * Delete a file safely
 * @param {string} filePath Path to file to delete
 * @returns {Promise<boolean>} Success status
 */
async function deleteFile(filePath) {
  return new Promise((resolve) => {
    if (!DELETE_AFTER_UPLOAD) {
      log(`File deletion skipped (DELETE_AFTER_UPLOAD is false): ${path.basename(filePath)}`);
      resolve(false);
      return;
    }
    
    log(`Deleting file: ${path.basename(filePath)}`);
    fs.unlink(filePath, (err) => {
      if (err) {
        log(`Error deleting file: ${err.message}`);
        resolve(false);
        return;
      }
      log(`Successfully deleted file: ${path.basename(filePath)}`);
      resolve(true);
    });
  });
}

/**
 * Delete a directory safely
 * @param {string} dirPath Path to directory to delete
 * @returns {Promise<boolean>} Success status
 */
/**
 * Delete a directory safely using native fs methods
 * @param {string} dirPath Path to directory to delete
 * @returns {Promise<boolean>} Success status
 */
async function deleteDirectory(dirPath) {
  return new Promise((resolve) => {
    if (!DELETE_DIRECTORY_AFTER_UPLOAD) {
      log(`Directory deletion skipped (DELETE_DIRECTORY_AFTER_UPLOAD is false): ${path.basename(dirPath)}`);
      resolve(false);
      return;
    }

    log(`Deleting directory: ${path.basename(dirPath)}`);
    
    try {
      // Check if Node.js version supports recursive removal (14.14.0+)
      // This is a safer approach than using rimraf as an external dependency
      if (fs.rmSync || fs.rmdirSync) {
        // Use rmSync if available (Node.js 14.14.0+)
        if (fs.rmSync) {
          fs.rmSync(dirPath, { recursive: true, force: true });
        } 
        // Fallback to older rmdirSync with recursive option (Node.js 12.10.0+)
        else if (fs.rmdirSync) {
          fs.rmdirSync(dirPath, { recursive: true });
        }
        log(`Successfully deleted directory: ${path.basename(dirPath)}`);
        resolve(true);
      } else {
        // Very old Node.js versions - implement recursive deletion manually
        deleteDirectoryRecursive(dirPath);
        log(`Successfully deleted directory: ${path.basename(dirPath)}`);
        resolve(true);
      }
    } catch (err) {
      log(`Error deleting directory: ${err.message}`);
      resolve(false);
    }
  });
}

/**
 * Fallback recursive directory deletion for very old Node.js versions
 * @param {string} dirPath Directory path to delete
 */
function deleteDirectoryRecursive(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.readdirSync(dirPath).forEach((file) => {
      const curPath = path.join(dirPath, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        // Recursive call for directories
        deleteDirectoryRecursive(curPath);
      } else {
        // Delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(dirPath); // Remove empty directory
  }
}

/**
 * Upload file to S3 with category as subfolder
 * @param {string} filePath Path to file to upload
 * @param {string} sourceDir Optional directory path that was the source of the file (for deletion)
 * @returns {Promise<boolean>} Success status
 */
async function uploadToS3(filePath, sourceDir = null) {
  // Get the category to use as subfolder
  const userCategory = await getTorrentCategory(torrentHash);
  const targetFolder = userCategory || 'qbittorent';
  
  return new Promise((resolve, reject) => {
    const command = `s3cli /file upload "hetznerS3" "${filePath}" slade001/torcomet/${targetFolder}`;
    log(`Uploading file to S3: ${path.basename(filePath)}`);
    log(`Upload path: slade001/${targetFolder}/${path.basename(filePath)}`);
    log(`Full file path: ${filePath}`);
    
    exec(command, async (error, stdout, stderr) => {
      if (error) {
        log(`Upload error: ${error.message}`);
        if (stderr) log(`Error details: ${stderr}`);
        reject(error);
        return;
      }
      log("S3 upload completed successfully");
      if (stdout) log(`Upload output: ${stdout.trim()}`);
      
      // Handle post-upload actions
      try {
        // 1. Delete the file if configured
        if (DELETE_AFTER_UPLOAD) {
          await deleteFile(filePath);
        }
        
        // 2. Delete the source directory if provided and configured
        if (sourceDir && DELETE_DIRECTORY_AFTER_UPLOAD) {
          await deleteDirectory(sourceDir);
        }
        
        // 3. Stop the torrent if configured
        if (STOP_TORRENT_AFTER_UPLOAD) {
          await stopTorrent(torrentHash);
        }
      } catch (postUploadError) {
        log(`Warning: Post-upload operations had errors: ${postUploadError.message}`);
        // Continue despite post-upload errors
      }
      
      resolve(true);
    });
  });
}

/**
 * Determine content details (file/directory structure) for a torrent
 * @returns {Promise<Object>} Content details object
 */
async function detectContentStructure() {
  try {
    // Get authentication cookie
    const cookie = await qbLogin();
    if (!cookie) {
      throw new Error('Failed to login to qBittorrent');
    }
    
    // Step 1: Get basic torrent info
    const torrentResponse = await qbt.get('/torrents/info', {
      params: { hashes: torrentHash },
      headers: { Cookie: cookie }
    });
    
    if (!torrentResponse.data || !torrentResponse.data.length) {
      throw new Error('Torrent not found');
    }
    
    const torrentInfo = torrentResponse.data[0];
    log(`Found torrent: ${torrentInfo.name} (${torrentInfo.size} bytes)`);
    
    // Step 2: Try to get content_path from properties API
    let contentPath = null;
    try {
      const propsResponse = await qbt.get('/torrents/properties', {
        params: { hash: torrentHash },
        headers: { Cookie: cookie }
      });
      
      if (propsResponse.data && propsResponse.data.content_path) {
        contentPath = propsResponse.data.content_path;
        log(`Content path from API: ${contentPath}`);
      }
    } catch (error) {
      log(`Warning: Could not get torrent properties: ${error.message}`);
    }
    
    // Step 3: Get file list
    const filesResponse = await qbt.get('/torrents/files', {
      params: { hash: torrentHash },
      headers: { Cookie: cookie }
    });
    
    if (!filesResponse.data || !Array.isArray(filesResponse.data)) {
      throw new Error('Failed to get files for torrent');
    }
    
    const files = filesResponse.data;
    log(`Torrent has ${files.length} file(s)`);
    
    /* Log some file details for debugging
    for (let i = 0; i < Math.min(files.length, 3); i++) {
      log(`File ${i+1}: ${files[i].name} (${files[i].size} bytes)`);
    }
    */
    
    // Analyze file paths to detect common directory
    let commonDir = null;
    if (files.length > 0 && files[0].name.includes('/')) {
      const firstPath = files[0].name.split('/');
      if (firstPath.length > 1) {
        commonDir = firstPath[0];
        log(`Detected common directory from file path: ${commonDir}`);
      }
    }
    
    // Step 4: Determine content type and path
    let result = {
      isSingleFile: false,
      isDirectory: false,
      isSingleFileInDirectory: false,
      contentPath: null,
      filePath: null
    };
    
    // Priority 1: Use content_path from API if available
    if (contentPath && fs.existsSync(contentPath)) {
      const stats = fs.statSync(contentPath);
      
      if (stats.isFile()) {
        log(`Content is a single file: ${contentPath}`);
        result.isSingleFile = true;
        result.contentPath = contentPath;
        result.filePath = contentPath;
      } else if (stats.isDirectory()) {
        log(`Content is a directory: ${contentPath}`);
        result.isDirectory = true;
        result.contentPath = contentPath;
        
        // Check if it's a directory with a single file
        if (files.length === 1) {
          const filePath = path.join(contentPath, files[0].name.split('/').pop());
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            log(`Directory contains a single file: ${filePath}`);
            result.isSingleFileInDirectory = true;
            result.filePath = filePath;
          }
        }
      }
    } 
    // Priority 2: Use rootPath from qBittorrent if available
    else if (rootPath && fs.existsSync(rootPath)) {
      log(`Using root path from qBittorrent: ${rootPath}`);
      const stats = fs.statSync(rootPath);
      
      if (stats.isFile()) {
        result.isSingleFile = true;
        result.contentPath = rootPath;
        result.filePath = rootPath;
      } else if (stats.isDirectory()) {
        result.isDirectory = true;
        result.contentPath = rootPath;
        
        // Check if it's a directory with a single file
        if (files.length === 1) {
          // Try to find the file in this directory
          const fileName = files[0].name.split('/').pop();
          const filePath = path.join(rootPath, fileName);
          
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            log(`Root path directory contains a single file: ${filePath}`);
            result.isSingleFileInDirectory = true;
            result.filePath = filePath;
          }
        }
      }
    }
    // Priority 3: Use information from file list
    else {
      if (files.length === 1) {
        // Single file torrent possibilities
        const fileName = files[0].name.split('/').pop();
        
        // Try direct path in save directory
        const directPath = path.join(savePath, fileName);
        if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
          log(`Found single file at: ${directPath}`);
          result.isSingleFile = true;
          result.contentPath = directPath;
          result.filePath = directPath;
        } 
        // Try in torrent name directory
        else {
          const dirPath = path.join(savePath, torrentInfo.name);
          const filePath = path.join(dirPath, fileName);
          
          if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
            log(`Found directory at: ${dirPath}`);
            result.isDirectory = true;
            result.contentPath = dirPath;
            
            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
              log(`Found single file in directory: ${filePath}`);
              result.isSingleFileInDirectory = true;
              result.filePath = filePath;
            }
          }
          // Try with common directory if detected
          else if (commonDir) {
            const commonDirPath = path.join(savePath, commonDir);
            
            if (fs.existsSync(commonDirPath) && fs.statSync(commonDirPath).isDirectory()) {
              log(`Found common directory: ${commonDirPath}`);
              result.isDirectory = true;
              result.contentPath = commonDirPath;
            }
          }
        }
      } else if (files.length > 1) {
        // Multi-file torrent - try different possibilities
        
        // Option 1: Standard directory with torrent name
        const standardDir = path.join(savePath, torrentInfo.name);
        if (fs.existsSync(standardDir) && fs.statSync(standardDir).isDirectory()) {
          log(`Found standard multi-file directory: ${standardDir}`);
          result.isDirectory = true;
          result.contentPath = standardDir;
        }
        // Option 2: Common directory from file paths
        else if (commonDir) {
          const commonDirPath = path.join(savePath, commonDir);
          
          if (fs.existsSync(commonDirPath) && fs.statSync(commonDirPath).isDirectory()) {
            log(`Found common directory from file paths: ${commonDirPath}`);
            result.isDirectory = true;
            result.contentPath = commonDirPath;
          }
        }
        // Option 3: Files directly in save path
        else {
          log(`Assuming files are directly in save path: ${savePath}`);
          result.isDirectory = true;
          result.contentPath = savePath;
        }
      }
    }
    
    // Final summary
    log(`Content type: ${
      result.isSingleFile ? 'Single File' : 
      (result.isSingleFileInDirectory ? 'Single File in Directory' : 
      (result.isDirectory ? 'Directory' : 'Unknown'))
    }`);
    
    if (result.contentPath) log(`Content path: ${result.contentPath}`);
    if (result.filePath) log(`File path: ${result.filePath}`);
    
    return result;
    
  } catch (error) {
    log(`Error detecting content structure: ${error.message}`);
    throw error;
  }
}

/**
 * Enhanced poll zip progress function for handling large files
 * Combines server API checks with file existence and size monitoring
 * 
 * @param {string} hash Torrent hash
 * @param {string} zipPath Expected zip file path
 * @returns {Promise<boolean>} Success status
 */
async function pollZipProgress(hash, zipPath) {
  log('Starting to monitor zip progress...');
  
  // Tracking variables
  let lastProgress = 0;
  let lastFileSize = 0;
  let sameProgressCount = 0;
  let sameFileSizeCount = 0;
  let fileExistsCount = 0;
  let errorCount = 0;
  const pollInterval = 3000; // 3 seconds between checks
  const maxErrors = 10;
  const maxSameFileSizeChecks = 10; // Consider complete after 10 checks with same file size
  const maxAttempts = 600; // Maximum polling attempts (30 minutes)
  let attempts = 0;
  
  // Initial file check
  let fileExists = fs.existsSync(zipPath);
  if (fileExists) {
    const stats = fs.statSync(zipPath);
    lastFileSize = stats.size;
    log(`Initial check: Zip file exists with size ${formatSize(lastFileSize)}`);
    fileExistsCount++;
  } else {
    log('Initial check: Zip file does not exist yet');
  }
  
  // Helper function to format file size
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' bytes';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }
  
  // Main polling loop
  while (attempts < maxAttempts && errorCount < maxErrors) {
    attempts++;
    log(`Poll attempt #${attempts}/${maxAttempts}`);
    
    // STEP 1: Check if file exists and check its size
    const currentFileExists = fs.existsSync(zipPath);
    
    if (currentFileExists) {
      try {
        const stats = fs.statSync(zipPath);
        const currentSize = stats.size;
        
        // Log file existence and size
        if (!fileExists) {
          log(`Zip file appeared: ${zipPath} with size ${formatSize(currentSize)}`);
          fileExists = true;
          fileExistsCount = 1;
        } else {
          fileExistsCount++;
        }
        
        // Check if the file size has changed
        if (currentSize > 0 && currentSize === lastFileSize) {
          sameFileSizeCount++;
          log(`File size unchanged for ${sameFileSizeCount} checks: ${formatSize(currentSize)}`);
          
          // If file size hasn't changed for several consecutive checks, consider it complete
          if (sameFileSizeCount >= maxSameFileSizeChecks) {
            log(`File size remained stable at ${formatSize(currentSize)} for ${sameFileSizeCount} checks`);
            log('Considering zip complete based on stable file size');
            return true;
          }
        } else if (currentSize !== lastFileSize) {
          // Reset counter if size changed
          sameFileSizeCount = 0;
          if (lastFileSize > 0) {
            log(`File size changed: ${formatSize(lastFileSize)} -> ${formatSize(currentSize)}`);
          }
          lastFileSize = currentSize;
        }
      } catch (statError) {
        log(`Error checking file stats: ${statError.message}`);
        // Continue to API check even if stat check fails
      }
    } else if (fileExists) {
      log('Warning: Zip file no longer exists!');
      fileExists = false;
      fileExistsCount = 0;
      lastFileSize = 0;
    }
    
    // STEP 2: Check with the server API
    try {
      const response = await zipServer.post('/check-zip-progress', { hash });
      
      const data = response.data;
      const currentProgress = data.progress || 0;
      
      // Log progress changes
      if (currentProgress !== lastProgress) {
        log(`Zip progress from server: ${currentProgress}%`);
        sameProgressCount = 0;
        lastProgress = currentProgress;
      } else {
        sameProgressCount++;
        log(`Progress unchanged for ${sameProgressCount} checks: ${currentProgress}%`);
      }
      
      // If server reports complete, we're done
      if (data.status === 'complete') {
        log('Server reported zip creation is complete');
        return true;
      } else if (data.status === 'error') {
        log(`Server reported error in zip creation: ${data.message}`);
        return false;
      }
      
      // If progress is high and hasn't changed, check if file exists with substantial size
      if (sameProgressCount >= 5 && currentProgress > 80 && currentFileExists) {
        const currentSize = fs.statSync(zipPath).size;
        if (currentSize > 1024 * 1024) { // Greater than 1MB
          log(`Progress stalled at ${currentProgress}% but file exists with size ${formatSize(currentSize)}`);
          
          // If file size is also stable, consider it complete
          if (sameFileSizeCount >= 3) {
            log('Considering zip complete based on high progress + stable file size');
            return true;
          }
        }
      }
      
    } catch (error) {
      errorCount++;
      log(`API error (${errorCount}/${maxErrors}): ${error.message}`);
      
      // If we have API errors but file exists and has stable size, consider complete
      if (currentFileExists && lastFileSize > 0 && sameFileSizeCount >= maxSameFileSizeChecks/2) {
        log(`API errors but file exists with stable size ${formatSize(lastFileSize)}`);
        log('Considering zip complete despite API errors');
        return true;
      }
    }
    
    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  // If we have a file with size after all attempts, consider it success
  if (fileExists && lastFileSize > 0) {
    log(`Polling ended but file exists with size ${formatSize(lastFileSize)}`);
    return true;
  }
  
  // Handle timeouts and errors
  if (attempts >= maxAttempts) {
    log(`Maximum polling attempts (${maxAttempts}) reached`);
  }
  
  if (errorCount >= maxErrors) {
    log(`Too many errors (${errorCount}) while polling zip progress`);
  }
  
  return false;
}

/**
 * Process a directory by creating a zip and uploading to S3
 * @param {string} hash Torrent hash
 * @param {string} directoryPath Path to directory
 * @returns {Promise<boolean>} Success status
 */
async function processDirectory(hash, directoryPath) {
  try {
    const zipPath = `${directoryPath}.zip`;
    log(`Expected zip path: ${zipPath}`);
    
    await setTag(hash, 'Zipping');
    
    // Check if zip already exists locally
    if (fs.existsSync(zipPath)) {
      log(`Zip file already exists locally: ${zipPath}`);
      await setTag(hash, 'Preparing link');
      
      try {
        // Pass the directory path as the source directory
        await uploadToS3(zipPath, directoryPath);
        await setTag(hash, 'Ready');
        return true;
      } catch (error) {
        log(`Upload of existing zip failed: ${error.message}`);
        await setTag(hash, 'Upload Failed');
        return false;
      }
    }
    
    // Request zip creation from server
    log('Sending zip request to API');
    const userCategory = await getTorrentCategory(hash);
    
    const response = await zipServer.post('/download', {
      hash: hash,
      currentUser: userCategory || 'qbittorent',
      qbtZipRequest: true
    });
    
    if (response.data.status === 'exists') {
      log('Server reports zip file already exists');
      
      if (fs.existsSync(zipPath)) {
        log(`Confirmed zip file exists: ${zipPath}`);
        await setTag(hash, 'Preparing link');
        
        try {
          await uploadToS3(zipPath, directoryPath);
          await setTag(hash, 'Ready');
          return true;
        } catch (error) {
          log(`Upload failed: ${error.message}`);
          await setTag(hash, 'Upload Failed');
          return false;
        }
      } else {
        log(`WARNING: Server reports zip exists but file not found: ${zipPath}`);
        await setTag(hash, 'Error');
        return false;
      }
    } else if (response.data.status === 'zipping') {
      log(`Initial zip progress: ${response.data.progress || 0}%`);
      
      const zipSuccess = await pollZipProgress(hash, zipPath);
      
      if (zipSuccess) {
        log('Zip file created successfully. Uploading to S3...');
        await setTag(hash, 'Preparing link');
        
        try {
          await uploadToS3(zipPath, directoryPath);
          await setTag(hash, 'Ready');
          log('Zip file uploaded to S3 successfully');
          return true;
        } catch (error) {
          log(`Upload failed: ${error.message}`);
          await setTag(hash, 'Upload Failed');
          return false;
        }
      } else {
        await setTag(hash, 'Error');
        return false;
      }
    } else {
      log(`Unexpected server response: ${JSON.stringify(response.data)}`);
      await setTag(hash, 'Error');
      return false;
    }
  } catch (error) {
    log(`Error processing directory: ${error.message}`);
    await setTag(hash, 'Error');
    return false;
  }
}

/**
 * Main execution function
 */
async function main() {
  try {
    log('Starting content detection and processing...');
    
    // Detect content structure
    const contentDetails = await detectContentStructure();
    
    if (!contentDetails.contentPath && !contentDetails.filePath) {
      log('ERROR: Unable to determine any valid content path');
      await setTag(torrentHash, 'Error');
      return;
    }
    
    // Process based on detected content type
    if (contentDetails.isSingleFile) {
      log(`Processing as single file: ${contentDetails.contentPath}`);
      await setTag(torrentHash, 'Preparing link');
      
      try {
        await uploadToS3(contentDetails.contentPath);
        await setTag(torrentHash, 'Ready');
        log('File uploaded successfully');
      } catch (error) {
        log(`Upload failed: ${error.message}`);
        await setTag(torrentHash, 'Upload Failed');
      }
    } else if (contentDetails.isSingleFileInDirectory) {
      log(`Processing as single file in directory: ${contentDetails.filePath}`);
      await setTag(torrentHash, 'Preparing link');
      
      try {
        // Pass contentPath as the directory to potentially delete after upload
        await uploadToS3(contentDetails.filePath, contentDetails.contentPath);
        await setTag(torrentHash, 'Ready');
        log('File uploaded successfully');
      } catch (error) {
        log(`Upload failed: ${error.message}`);
        await setTag(torrentHash, 'Upload Failed');
      }
    } else if (contentDetails.isDirectory) {
      log(`Processing as directory: ${contentDetails.contentPath}`);
      await processDirectory(torrentHash, contentDetails.contentPath);
    } else {
      log(`ERROR: Could not determine how to process torrent ${torrentHash}`);
      await setTag(torrentHash, 'Error');
    }
    
    log('Process completed');
  } catch (error) {
    log(`Critical error: ${error.message}`);
    await setTag(torrentHash, 'Error');
  } finally {
    // Auto-close window after 10 seconds
    log('Window will close in 10 seconds...');
    setTimeout(() => process.exit(0), 10000);
  }
}

// Execute main function
main();
