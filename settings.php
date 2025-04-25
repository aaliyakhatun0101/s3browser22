<?php
// Start output buffering immediately
ob_start();

// Security check: prevent direct access if not logged in
if (session_status() == PHP_SESSION_NONE) {
    session_start();
}
if (!isset($_SESSION['logged_in']) || $_SESSION['logged_in'] !== true || !defined('SECURE_ACCESS')) {
    // Either die with a message
    //die('Access denied');
    header('Location: ../index.php');
    exit;
}
 
error_reporting(E_ALL);
ini_set('display_errors', 0); // Change to 0 to prevent errors from showing in output
ini_set('log_errors', 1);
ini_set('error_log', __DIR__ . '/settings_error.log');

// Debug log function with improved handling for AJAX requests
function debug_log($message, $data = null, $force_output = false) {
    $timestamp = date('Y-m-d H:i:s');
    $log_message = "[{$timestamp}] SETTINGS DEBUG: " . $message . (($data !== null) ? " - " . print_r($data, true) : "");
    error_log($log_message);
    
    // Don't output HTML/JS during AJAX requests unless forced
    if ((!isset($_POST['action']) || $force_output) && !headers_sent()) {
        echo "<!-- DEBUG: " . htmlspecialchars($message);
        if ($data !== null) {
            echo " - " . htmlspecialchars(print_r($data, true));
        }
        echo " -->\n";
        
        // Also output to browser console for easier debugging
        echo "<script>console.log('[SETTINGS DEBUG] " . addslashes($message) . "'";
        if ($data !== null) {
            echo ", " . json_encode($data);
        }
        echo ");</script>\n";
    }
}

// Handle AJAX requests for settings operations - MUST BE BEFORE ANY OUTPUT
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action'])) {
    // Log the start of AJAX processing with request details
    debug_log("Processing AJAX request - Start", $_POST, true);
    
    // Clear any existing output
    while (ob_get_level()) {
        ob_end_clean();
    }
    // Start fresh buffer
    ob_start();
    
    // Set headers to prevent caching and specify JSON content
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Cache-Control: post-check=0, pre-check=0', false);
    header('Pragma: no-cache');
    header('Content-Type: application/json; charset=utf-8');
    
    $response = ['success' => false, 'message' => 'Unknown error', 'debug_info' => []];
    
    try {
        // Try to get database connection
        if (!isset($db) && isset($auth) && method_exists($auth, 'getPdo')) {
            $db = $auth->getPdo();
            debug_log("Got database connection from Authentication class");
            $response['debug_info']['db_connection'] = 'Authentication class PDO';
        }
        
        if (!isset($db)) {
            debug_log("Database connection not available");
            $response = ['success' => false, 'message' => 'Database connection not available'];
        } else if (!isset($_SESSION['userEmail'])) {
            debug_log("No user session available");
            $response = ['success' => false, 'message' => 'User session not available'];
        } else {
            $userEmail = $_SESSION['userEmail'];
            $response['debug_info']['user_email'] = $userEmail;
            
            if ($_POST['action'] === 'changePassword') {
                debug_log("Processing password change", $_POST);
                $newPassword = $_POST['newPassword'] ?? '';
                $confirmPassword = $_POST['confirmPassword'] ?? '';
                
                if (empty($newPassword)) {
                    $response = ['success' => false, 'message' => 'New password cannot be empty'];
                } else if ($newPassword !== $confirmPassword) {
                    $response = ['success' => false, 'message' => 'Passwords do not match'];
                } else {
                    // Hash the new password
                    $hashedPassword = password_hash($newPassword, PASSWORD_BCRYPT);
                    $response['debug_info']['password_hashed'] = true;
                    
                    try {
                        // Update the password in the database
                        $stmt = $db->prepare("UPDATE users SET UserPass = :password WHERE userEmail = :email");
                        $stmt->bindParam(':password', $hashedPassword);
                        $stmt->bindParam(':email', $userEmail);
                        
                        // Log SQL query for debugging
                        debug_log("Executing SQL", ["query" => "UPDATE users SET UserPass = [HASHED] WHERE userEmail = '{$userEmail}'"]);
                        
                        $stmt->execute();
                        $response['debug_info']['query_executed'] = true;
                        $response['debug_info']['affected_rows'] = $stmt->rowCount();
                        
                        if ($stmt->rowCount() > 0) {
                            $response = ['success' => true, 'message' => 'Password updated successfully'];
                        } else {
                            // Check if the user exists
                            $checkStmt = $db->prepare("SELECT COUNT(*) FROM users WHERE userEmail = :email");
                            $checkStmt->bindParam(':email', $userEmail);
                            $checkStmt->execute();
                            $userExists = (int)$checkStmt->fetchColumn();
                            
                            if ($userExists) {
                                $response = [
                                    'success' => true, 
                                    'message' => 'No changes were made - new password might be the same as the old one'
                                ];
                            } else {
                                $response = ['success' => false, 'message' => 'Failed to update password - user not found'];
                            }
                        }
                    } catch (PDOException $e) {
                        $response = [
                            'success' => false, 
                            'message' => 'Database error: ' . $e->getMessage(),
                            'debug_info' => ['pdo_error' => $e->getMessage()]
                        ];
                    } catch (Exception $e) {
                        $response = [
                            'success' => false, 
                            'message' => 'Error: ' . $e->getMessage(),
                            'debug_info' => ['exception' => $e->getMessage()]
                        ];
                    }
                }
            } else if ($_POST['action'] === 'changeEmail') {
                debug_log("Processing email change", $_POST);
                $newEmail = $_POST['newEmail'] ?? '';
                
                if (empty($newEmail)) {
                    $response = ['success' => false, 'message' => 'New email cannot be empty'];
                } else if (!filter_var($newEmail, FILTER_VALIDATE_EMAIL)) {
                    $response = ['success' => false, 'message' => 'Invalid email format'];
                } else {
                    try {
                        // Check if email already exists
                        $checkStmt = $db->prepare("SELECT COUNT(*) FROM users WHERE userEmail = :email AND userEmail != :currentEmail");
                        $checkStmt->bindParam(':email', $newEmail);
                        $checkStmt->bindParam(':currentEmail', $userEmail);
                        $checkStmt->execute();
                        
                        if ($checkStmt->fetchColumn() > 0) {
                            $response = ['success' => false, 'message' => 'Email already in use by another account'];
                        } else {
                            // Update the email in the database
                            $stmt = $db->prepare("UPDATE users SET userEmail = :newEmail WHERE userEmail = :currentEmail");
                            $stmt->bindParam(':newEmail', $newEmail);
                            $stmt->bindParam(':currentEmail', $userEmail);
                            $stmt->execute();
                            
                            if ($stmt->rowCount() > 0) {
                                // Update session with new email
                                $_SESSION['userEmail'] = $newEmail;
                                $response = ['success' => true, 'message' => 'Email updated successfully'];
                            } else {
                                $response = ['success' => false, 'message' => 'Failed to update email'];
                            }
                        }
                    } catch (PDOException $e) {
                        $response = [
                            'success' => false, 
                            'message' => 'Database error: ' . $e->getMessage(),
                            'debug_info' => ['pdo_error' => $e->getMessage()]
                        ];
                    } catch (Exception $e) {
                        $response = [
                            'success' => false, 
                            'message' => 'Error: ' . $e->getMessage(),
                            'debug_info' => ['exception' => $e->getMessage()]
                        ];
                    }
                }
            } else if ($_POST['action'] === 'deleteAccount') {
                debug_log("Processing account deletion");
                try {
                    // Delete the user account
                    $stmt = $db->prepare("DELETE FROM users WHERE userEmail = :email");
                    $stmt->bindParam(':email', $userEmail);
                    $stmt->execute();
                    
                    if ($stmt->rowCount() > 0) {
                        // Destroy the session
                        session_destroy();
                        $response = ['success' => true, 'message' => 'Account deleted successfully'];
                    } else {
                        $response = ['success' => false, 'message' => 'Failed to delete account'];
                    }
                } catch (PDOException $e) {
                    $response = [
                        'success' => false, 
                        'message' => 'Database error: ' . $e->getMessage(),
                        'debug_info' => ['pdo_error' => $e->getMessage()]
                    ];
                } catch (Exception $e) {
                    $response = [
                        'success' => false, 
                        'message' => 'Error: ' . $e->getMessage(),
                        'debug_info' => ['exception' => $e->getMessage()]
                    ];
                }
            } else {
                debug_log("Invalid action", $_POST['action']);
                $response = ['success' => false, 'message' => 'Invalid action'];
            }
        }
    } catch (Exception $e) {
        $errorMessage = "Unexpected error: " . $e->getMessage();
        debug_log($errorMessage, ['trace' => $e->getTraceAsString()]);
        $response = [
            'success' => false, 
            'message' => 'An unexpected error occurred',
            'debug_info' => [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]
        ];
    }
    
    // In development, include debug info; in production, remove it
    if (!isset($_SERVER['ENVIRONMENT']) || $_SERVER['ENVIRONMENT'] !== 'production') {
        // Keep debug_info for development
    } else {
        // Remove debug_info in production
        unset($response['debug_info']);
    }
    
    debug_log("Sending AJAX response", $response);
    
    // Clear any output that might have been generated in the process
    while (ob_get_level()) {
        ob_end_clean();
    }
    
    // Encode with options to help diagnose issues
    echo json_encode($response, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// Clear any buffered output before HTML output
ob_end_clean();
// Start buffer for main content
ob_start();

// Start of HTML output
?>
<head>
 <link rel="stylesheet" href="./styles.css">
 <link rel="stylesheet" href="./ui/settings.css">
 <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css">
</head>

<?php
// Get username from session
$username = $_SESSION['userEmail'] ?? 'Guest';
debug_log("Username from session", $username);

// Get used space
$usedSpace = 0;
$maxSpace = 0;
$planType = $_SESSION['plan'];
$downloadSpeed = "50-150Kb/s";
$filesStoragePeriod = 7;
   

// Format the space values
$usedSpaceMB = round($usedSpace / (1024 * 1024), 2);
$maxSpaceMB = round($maxSpace / (1024 * 1024), 2);
?>
<!-- Torrent list template just to make sure whenever user add torrent from anywhere on the sidebar menu, it can be added -->
                <div id="torrentList" class="torrent-list" style="display:none;">
                    <!-- Torrents will be inserted here by JavaScript -->
                </div>
<div class="torrent-manager innerpage">
    <div class="settings-header">
        <h2><i class="fas fa-cog"></i> Settings</h2>
    </div>
    
    <div class="settings-container">
        <div class="settings-box">
            <h3>Profile info</h3>
            <div class="profile-info">
                <div class="avatar-section">
                    <i class="fa-solid fa-user-secret"></i>
                   
                </div>
                <div class="user-email"><?php echo htmlspecialchars($username); ?></div>
                 
            </div>
            
            <div class="profile-stats">
                <div class="stat-row">
                    <div class="stat-label">Storage in use:</div>
                    <div class="stat-value"><?php echo $_SESSION['currentUsedSpaceFormatted'] ?></div>
                </div>
                <div class="stat-row">
                    <div class="stat-label">Maximum download speed:</div>
                    <div class="stat-value"><?php echo $downloadSpeed; ?></div>
                </div>
                <div class="stat-row">
                    <div class="stat-label">Files storage period:</div>
                    <div class="stat-value"><?php echo $filesStoragePeriod; ?></div>
                </div>
                <div class="stat-row">
                    <div class="stat-label">Premium is: <?php echo ($planType !== 'Free' ? 'on' : 'off'); ?></div>
                    <div class="stat-value">
					
						 <?php if ($userPlan != 'Free'): ?>
							<span class="plan-badge <?php echo htmlspecialchars(strtolower($userPlan)); ?>">
                                <?php echo htmlspecialchars($planDisplayName); ?>
                            </span>
                                <div class="plan-validity <?php echo (isset($hasExpired) && $hasExpired) ? 'expired' : ''; ?>">
                                    Validity: <?php echo htmlspecialchars($validityDate); ?>
                                </div>
                            <?php else: ?>
							<a href="?page=pricing" class="premium-button">Get Premium</a>
							<?php endif; ?>
					 
                    </div>
                </div>
                <div class="stat-row delete-account-row">
                    <button class="delete-account-btn">
                        <i class="fa fa-trash-alt"></i> Delete account
                    </button>
                </div>
            </div>
        </div>
        
        <div class="settings-tabs">
            <div class="tab-headers">
                <div class="tab-header active" data-tab="password">Change password</div>
                <div class="tab-header" data-tab="email">Change email</div>
            </div>
            <div class="tab-content active" id="password-tab">
                <div class="form-group">
                    <div class="input-icon">
                        <i class="fa fa-lock"></i>
                    </div>
                    <input type="password" id="new-password" placeholder="New password" class="settings-input">
                </div>
                <div class="form-group">
                    <div class="input-icon">
                        <i class="fa fa-lock"></i>
                    </div>
                    <input type="password" id="confirm-password" placeholder="Repeat new password" class="settings-input">
                </div>
                <div class="form-action">
                    <button id="save-password" class="save-btn">Save</button>
                </div>
                <div id="password-message" class="message-container"></div>
            </div>
            <div class="tab-content" id="email-tab">
                <div class="form-group">
                    <div class="input-icon">
                        <i class="fa fa-envelope"></i>
                    </div>
                    <input type="email" readonly id="new-email" placeholder="New email address" class="settings-input">
                </div>
                <div class="form-action">
                    <button id="save-email_disabled"  disabled class="save-btn">Save</button>
                </div>
                <div id="email-message" class="message-container"></div>
            </div>
        </div>
    </div>
</div>

<!-- Add an extra debugging div that can be toggled with JavaScript -->
<div id="debug-panel" style="display: none; position: fixed; bottom: 0; right: 0; max-width: 500px; max-height: 300px; overflow: auto; background: #f9f9f9; border: 1px solid #ccc; padding: 10px; z-index: 10000;">
    <h4>Debug Information</h4>
    <div id="debug-content"></div>
</div>

<!-- Add debug toggle functionality to settings.js -->
<script>
// Debug helpers - press Ctrl+Shift+D to toggle debug panel
document.addEventListener('keydown', function(event) {
    if (event.ctrlKey && event.shiftKey && event.key === 'D') {
        const debugPanel = document.getElementById('debug-panel');
        debugPanel.style.display = debugPanel.style.display === 'none' ? 'block' : 'none';
    }
});

// Function to add debug message to panel
window.addDebugMessage = function(message, data) {
    const debugContent = document.getElementById('debug-content');
    const msgElement = document.createElement('div');
    msgElement.style.borderBottom = '1px solid #eee';
    msgElement.style.padding = '5px 0';
    
    const timestamp = new Date().toLocaleTimeString();
    msgElement.innerHTML = `<strong>[${timestamp}]</strong> ${message}`;
    
    if (data) {
        const dataStr = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
        const pre = document.createElement('pre');
        pre.style.margin = '5px 0';
        pre.style.padding = '5px';
        pre.style.background = '#f0f0f0';
        pre.style.fontSize = '12px';
        pre.textContent = dataStr;
        msgElement.appendChild(pre);
    }
    
    debugContent.prepend(msgElement);
    
    // Keep only the latest 50 messages
    const messages = debugContent.querySelectorAll('div');
    if (messages.length > 50) {
        for (let i = 50; i < messages.length; i++) {
            messages[i].remove();
        }
    }
};

// Monkey patch XMLHttpRequest to log all AJAX activity
(function() {
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(data) {
        const xhr = this;
        this.addEventListener('load', function() {
            window.addDebugMessage('XHR Response', {
                status: xhr.status,
                responseText: xhr.responseText.substring(0, 500) + (xhr.responseText.length > 500 ? '...' : '')
            });
        });
        this.addEventListener('error', function() {
            window.addDebugMessage('XHR Error', { status: xhr.status });
        });
        window.addDebugMessage('XHR Request', data);
        return originalSend.apply(this, arguments);
    };
})();
</script>

<script src="./ui/settings.js"></script>

<!-- Enhanced client-side AJAX error handling -->
<script>
document.addEventListener('DOMContentLoaded', function() {
    // Enhance the sendAjaxRequest function to provide better error handling
    if (typeof window.sendAjaxRequest !== 'function') {
        console.warn('Original sendAjaxRequest function not found. Adding enhanced version.');
        
        window.sendAjaxRequest = function(action, data = {}) {
            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                const formData = new FormData();
                
                // Add action to form data
                formData.append('action', action);
                
                // Add other data to form data
                for (const key in data) {
                    formData.append(key, data[key]);
                }
                
                // Log what we're sending
                if (window.addDebugMessage) {
                    window.addDebugMessage('Sending AJAX Request', {
                        action: action,
                        data: data
                    });
                }
                
                xhr.open('POST', window.location.href, true);
                
                xhr.onload = function() {
                    if (xhr.status === 200) {
                        try {
                            const responseText = xhr.responseText.trim();
                            if (!responseText) {
                                const errorMsg = 'Empty response received from server';
                                console.error(errorMsg);
                                if (window.addDebugMessage) {
                                    window.addDebugMessage('AJAX Error', errorMsg);
                                }
                                reject(new Error(errorMsg));
                                return;
                            }
                            
                            const response = JSON.parse(responseText);
                            if (window.addDebugMessage) {
                                window.addDebugMessage('AJAX Success Response', response);
                            }
                            resolve(response);
                        } catch (e) {
                            const errorMsg = 'Failed to parse response as JSON: ' + e.message;
                            console.error(errorMsg, xhr.responseText);
                            if (window.addDebugMessage) {
                                window.addDebugMessage('AJAX Parse Error', {
                                    error: e.message,
                                    responseText: xhr.responseText
                                });
                            }
                            reject(new Error('Invalid response format'));
                        }
                    } else {
                        const errorMsg = 'Request failed. Status: ' + xhr.status;
                        console.error(errorMsg);
                        if (window.addDebugMessage) {
                            window.addDebugMessage('AJAX HTTP Error', {
                                status: xhr.status,
                                statusText: xhr.statusText
                            });
                        }
                        reject(new Error(errorMsg));
                    }
                };
                
                xhr.onerror = function() {
                    const errorMsg = 'Network error occurred';
                    console.error(errorMsg);
                    if (window.addDebugMessage) {
                        window.addDebugMessage('AJAX Network Error');
                    }
                    reject(new Error('Network error'));
                };
                
                xhr.send(formData);
            });
        };
    }
});
</script>

<?php
// End of file - ensure all buffered content is sent
ob_end_flush();
?>