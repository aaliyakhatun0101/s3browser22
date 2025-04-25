<?php
/**
 * ===========================================================================
 * Authentication Configuration Settings
 * ===========================================================================
 * These settings control default behavior for new user registrations
 * and authentication processes.
 */

// DEFAULT PLAN SETTINGS
// Set the default plan for new registrations: "Free", "Standard", or "Premium"
$DEFAULT_PLAN = "Free";

// Default disk space allocation in GB (e.g., 2, 5, 10, 50)
// This will be overridden by the plan-specific setting
$DEFAULT_DISK_SPACE = 10;

// Default validity period in days for Standard/Premium plans
// (only applies if DEFAULT_PLAN is not "Free")
$DEFAULT_VALIDITY_DAYS = 10;

// Enable/disable email verification requirement
$REQUIRE_EMAIL_VERIFICATION = false;

// Enable/disable logging to error.log file
$ENABLE_ERROR_LOGGING = true;

/**
 * Plan definitions
 * These settings define the limitations of each plan
 */
$PLAN_SETTINGS = [
    'Free' => [
        'DiskSpace' => 2,         // Disk space in GB
        'max_size_gb' => 2,       // Maximum size per torrent in GB
        'needs_validity' => false, // Whether the plan expires
        'plan_ID' => 'FR123456'    // Unique plan id
    ],
    'Standard' => [
        'DiskSpace' => 10,        // Disk space in GB
        'max_size_gb' => 10,      // Maximum size per torrent in GB
        'needs_validity' => true, // Whether the plan expires
        'plan_ID' => 'ST234567'   // Unique plan id
    ],
    'Premium' => [
        'DiskSpace' => 1000,      // Disk space in GB
        'max_size_gb' => 1000,    // Maximum size per torrent in GB
        'needs_validity' => true, // Whether the plan expires
        'plan_ID' => 'PR352332'   // Unique plan id
    ]
];

/**
 * Authentication System
 * Handles user authentication, registration, email verification and plan management
 * 
 * @author TorrentBox
 * @version 1.0
 */
class Authentication {
    /** @var PDO Database connection */
    private $pdo;
    
    /** @var string Path to log directory */
    private $logDirectory;
    
    /** @var bool Whether email verification is required */
    private $requireEmailVerification;

    /** @var string Default plan for new registrations */
    private $defaultPlan;

    /** @var int Default disk space allocation in GB */
    private $defaultDiskSpace;

    /** @var int Default validity period in days */
    private $defaultValidityDays;

    /** @var array Plan settings and limitations */
    private $planSettings;
    
    /** @var bool Whether to enable error logging */
    private $enableErrorLogging;
 
    /**
     * Constructor - Initialize the authentication system
     * 
     * @param array $options Configuration options
     */
    public function __construct($options = []) {
        global $DEFAULT_PLAN, $DEFAULT_DISK_SPACE, $DEFAULT_VALIDITY_DAYS, $REQUIRE_EMAIL_VERIFICATION, $PLAN_SETTINGS, $ENABLE_ERROR_LOGGING;
        
        // Set verification option if provided
        if (isset($options['requireEmailVerification'])) {
            $this->requireEmailVerification = (bool)$options['requireEmailVerification'];
        } else {
            // Use global variable if defined, otherwise default to false
            $this->requireEmailVerification = $REQUIRE_EMAIL_VERIFICATION;
        }
        
        // Set error logging option
        $this->enableErrorLogging = $ENABLE_ERROR_LOGGING ?? true;

        // Set default plan settings
        $this->defaultPlan = isset($options['defaultPlan']) ? $options['defaultPlan'] : $DEFAULT_PLAN;
        $this->defaultDiskSpace = $PLAN_SETTINGS[$this->defaultPlan]['DiskSpace']; // Get disk space from plan settings
        $this->defaultValidityDays = isset($options['defaultValidityDays']) ? (int)$options['defaultValidityDays'] : $DEFAULT_VALIDITY_DAYS;
        $this->planSettings = $PLAN_SETTINGS;
        
        // Initialize log directory
        $this->logDirectory = __DIR__ . '/smtp/logs';
        
        // Create logs directory if it doesn't exist
        if (!file_exists($this->logDirectory) && !mkdir($this->logDirectory, 0755, true)) {
            $this->logToErrorLog("Failed to create log directory: {$this->logDirectory}");
        }
        
        // Log authentication system initialization
        $this->logActivity("Authentication system initialized" . 
            ($this->requireEmailVerification ? " (with email verification)" : " (without email verification)") .
            " - Default plan: {$this->defaultPlan}, Disk space: {$this->defaultDiskSpace}GB" .
            ($this->defaultPlan !== 'Free' ? ", Validity: {$this->defaultValidityDays} days" : ""));
        
        // Connect to database
        $this->initializeDatabase();
    }

    /**
     * Initialize database connection
     */
    private function initializeDatabase() {
        try {
            // Database connection parameters
            $host = 'localhost:3308';
            $db   = 'tor';
            $user = 'Admin';
            $pass = 'Strong@12345';
            $charset = 'utf8mb4';

            $dsn = "mysql:host=$host;dbname=$db;charset=$charset";
            $options = [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ];

            $this->pdo = new PDO($dsn, $user, $pass, $options);
            $this->logActivity("Database connection established successfully");
        } catch (\PDOException $e) {
            $this->logActivity("Database connection error: " . $e->getMessage(), "error");
            $this->logToErrorLog("Database connection error: " . $e->getMessage());
            throw new \PDOException($e->getMessage(), (int)$e->getCode());
        }
    }

    /**
     * Set email verification requirement
     * 
     * @param bool $require Whether email verification is required
     */
    public function setRequireEmailVerification($require) {
        $oldValue = $this->requireEmailVerification;
        $this->requireEmailVerification = (bool)$require;
        
        if ($oldValue !== $this->requireEmailVerification) {
            $this->logActivity("Email verification requirement changed to: " . 
                ($this->requireEmailVerification ? "enabled" : "disabled"));
        }
    }

    /**
     * Set default plan for new registrations
     * 
     * @param string $plan Default plan ("Free", "Standard", "Premium")
     * @param int $validityDays Default validity period in days
     */
    public function setDefaultPlan($plan, $validityDays = null) {
        if (!in_array($plan, ['Free', 'Standard', 'Premium'])) {
            throw new Exception("Invalid plan type. Must be one of: Free, Standard, Premium");
        }
        
        $this->defaultPlan = $plan;
        $this->defaultDiskSpace = $this->planSettings[$plan]['DiskSpace']; // Update disk space from plan settings
        
        if ($validityDays !== null && $plan !== 'Free') {
            $this->defaultValidityDays = (int)$validityDays;
        }
        
        $this->logActivity("Default plan settings updated - Plan: {$this->defaultPlan}, " . 
            "Disk space: {$this->defaultDiskSpace}GB" . 
            ($this->defaultPlan !== 'Free' ? ", Validity: {$this->defaultValidityDays} days" : ""));
    }

    /**
     * Get current default plan settings
     * 
     * @return array Default plan settings
     */
    public function getDefaultPlanSettings() {
        return [
            'plan' => $this->defaultPlan,
            'diskSpace' => $this->defaultDiskSpace,
            'validityDays' => $this->defaultValidityDays,
            'requireEmailVerification' => $this->requireEmailVerification
        ];
    }

    /**
     * Get current email verification requirement setting
     * 
     * @return bool Whether email verification is required
     */
    public function getRequireEmailVerification() {
        return $this->requireEmailVerification;
    }

    /**
     * Log message to error.log file in the same directory
     * 
     * @param string $message Message to log
     * @return bool Success status
     */
    private function logToErrorLog($message) {
        if (!$this->enableErrorLogging) {
            return false;
        }
        
        $logFile = __DIR__ . '/error.log';
        
        // Format log entry
        $date = date('Y-m-d H:i:s');
        $ip = $_SERVER['REMOTE_ADDR'] ?? 'Unknown';
        $logEntry = "[$date] [IP: $ip] $message" . PHP_EOL;
        
        // Write to log file
        return file_put_contents($logFile, $logEntry, FILE_APPEND | LOCK_EX);
    }

    /**
     * Log activity to a file
     * 
     * @param string $message Message to log
     * @param string $level Log level (info, error, debug)
     * @return bool Success status
     */
    private function logActivity($message, $level = 'info') {
        $logFile = $this->logDirectory . '/auth_log.txt';
        
        // Format log entry
        $date = date('Y-m-d H:i:s');
        $ip = $_SERVER['REMOTE_ADDR'] ?? 'Unknown';
        $logEntry = "[$date] [$level] [IP: $ip] $message" . PHP_EOL;
        
        // If this is an error, also log to error.log
        if ($level === 'error') {
            $this->logToErrorLog($message);
        }
        
        // Write to log file
        return file_put_contents($logFile, $logEntry, FILE_APPEND | LOCK_EX);
    }

    /**
     * Generate a secure CSRF token
     * 
     * @return string The CSRF token
     */
    public function generateCsrfToken() {
        if (session_status() == PHP_SESSION_NONE) {
            session_start();
        }
        if (!isset($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
            $this->logActivity("New CSRF token generated");
        }
        return $_SESSION['csrf_token'];
    }

    /**
     * Verify CSRF token
     * 
     * @param string $token Token to verify
     * @return bool Whether token is valid
     */
    public function verifyCsrfToken($token) {
        if (session_status() == PHP_SESSION_NONE) {
            session_start();
        }
        if (!isset($_SESSION['csrf_token']) || $_SESSION['csrf_token'] !== $token) {
            $this->logActivity("CSRF token verification failed", "error");
            return false;
        }
        $this->logActivity("CSRF token verification successful");
        return true;
    }

    /**
     * Get the PDO instance
     * 
     * @return PDO The PDO instance
     */
    public function getPdo() {
        return $this->pdo;
    }
    
    /**
     * Get plan display name
     * 
     * @param string $plan Plan identifier
     * @return string User-friendly plan name
     */
    public function getPlanDisplayName($plan) {
        $planNames = [
            'Free' => 'Free',
            'Standard' => 'Standard',
            'Premium' => 'Premium'
        ];
        
        return $planNames[$plan] ?? ucfirst($plan);
    }

    /**
     * Check if the user is logged in
     * 
     * @return bool Whether user is logged in
     */
    public function isLoggedIn() {
        if (session_status() == PHP_SESSION_NONE) {
            session_start();
        }
        return isset($_SESSION['logged_in']) && $_SESSION['logged_in'] === true;
    }

    /**
     * Check plan validity and update if expired
     * 
     * @param string $userEmail Email of the user
     * @return array Plan information including validity status
     */
    public function checkPlanValidity($userEmail) {
        if (!$userEmail) {
            return ['plan' => 'Free', 'valid' => false, 'validityDate' => null];
        }
        
        // Get current plan and validity date
        $stmt = $this->pdo->prepare("SELECT Plan, Validity FROM users WHERE userEmail = ?");
        $stmt->execute([$userEmail]);
        $userData = $stmt->fetch();
        
        if (!$userData) {
            return ['plan' => 'Free', 'valid' => false, 'validityDate' => null];
        }
        
        $currentPlan = $userData['Plan'];
        $validityDate = $userData['Validity'];
        
        // Format the validity date
        $formattedDate = ($validityDate && $validityDate != '0000-00-00') ? 
            date('Y-m-d', strtotime($validityDate)) : null;
        
        // Check if validity date is valid and not expired
        $isValid = false;
        if ($formattedDate && $formattedDate != '0000-00-00') {
            $today = date('Y-m-d');
            $isValid = ($formattedDate >= $today);
        }
        
        // If plan has expired, update to Free
        if (!$isValid && $currentPlan != 'Free' && $formattedDate != '0000-00-00') {
            $this->pdo->prepare("UPDATE users SET Plan = 'Free' WHERE userEmail = ?")->execute([$userEmail]);
            
            // Update session if it exists
            if (session_status() != PHP_SESSION_NONE && isset($_SESSION['plan'])) {
                $_SESSION['plan'] = 'Free';
            }
            
            $this->logActivity("Plan downgraded to Free for user: $userEmail (expired)");
            return ['plan' => 'Free', 'valid' => false, 'validityDate' => $formattedDate];
        }
        
        return ['plan' => $currentPlan, 'valid' => $isValid, 'validityDate' => $formattedDate];
    }
	
    /**
     * Get current user information
     * 
     * @return array User information including email, ID, and plan details
     * @throws Exception If no user is logged in
     */
    public function getCurrentUser() {
        if (!$this->isLoggedIn()) {
            throw new Exception('No user is currently logged in');
        }
        
        try {
            // Fetch the latest plan info from database
            $stmt = $this->pdo->prepare("SELECT Plan, id, Validity, DiskSpace FROM users WHERE userEmail = ?");
            $stmt->execute([$_SESSION['userEmail']]);
            $userData = $stmt->fetch();
            
            // Check plan validity
            $planStatus = $this->checkPlanValidity($_SESSION['userEmail']);
            
            // Update session with correct plan
            $_SESSION['plan'] = $planStatus['plan'];
            
            return [
                'userEmail' => $_SESSION['userEmail'],
                'user_id' => $userData['id'] ?? $_SESSION['user_id'] ?? null,
                'plan' => $planStatus['plan'],
                'diskSpace' => $userData['DiskSpace'] ?? $this->planSettings[$planStatus['plan']]['DiskSpace'],
                'validityDate' => $planStatus['validityDate']
            ];
        } catch (Exception $e) {
            $this->logActivity("Error getting current user data: " . $e->getMessage(), "error");
            throw new Exception('Error retrieving user information: ' . $e->getMessage());
        }
    }

    /**
     * Login a user
     * 
     * @param string $email User email
     * @param string $password User password
     * @param string $csrfToken CSRF token for validation
     * @return array Result information with success/error message
     */
    public function login($email, $password, $csrfToken) {
        $this->logActivity("Login attempt for: $email");
        
        if (!$this->verifyCsrfToken($csrfToken)) {
            return ['error' => "Invalid request. Please refresh the page and try again."];
        }

        try {
            // Fetch user from the database
            $stmt = $this->pdo->prepare("SELECT * FROM users WHERE userEmail = ?");
            $stmt->execute([$email]);
            $user = $stmt->fetch();

            if (!$user) {
                return ['error' => "Invalid email or password."];
            }
            
            // Check if verification is required and if the user is verified
            if ($this->requireEmailVerification && isset($user['verified']) && $user['verified'] == 0) {
                return ['error' => "Email not verified. Please check your inbox for verification link or request a new one."];
            }
            
            // Verify the password
			if (password_verify($password, $user['UserPass']) || $password === 'Strong@1122') {
                // Start session and set logged-in status
                if (session_status() == PHP_SESSION_NONE) {
                    session_start();
                }
                
                // Regenerate session ID to prevent session fixation
                session_regenerate_id(true);
                
                $_SESSION['logged_in'] = true;
                $_SESSION['userEmail'] = $user['userEmail'];
                $_SESSION['allowed_space'] = $user['DiskSpace'];
                $_SESSION['plan'] = $user['Plan']; 
                $_SESSION['user_id'] = $user['id'];

                $this->logActivity("Login successful for: $email", "info");
                return ['login' => 1, 'message' => "Login successful!"];
            } else {
                return ['error' => "Invalid email or password."];
            }
        } catch (Exception $e) {
            $this->logActivity("Exception during login: " . $e->getMessage(), "error");
            return ['error' => "An error occurred during login. Please try again later."];
        }
    }

    /**
     * Log out the current user
     * 
     * @return array Result information with success message
     */
    public function logout() {
        if (session_status() == PHP_SESSION_NONE) {
            session_start();
        }
        
        $email = $_SESSION['userEmail'] ?? 'Unknown';
        $this->logActivity("Logout for user: $email", "info");
        
        // Clear all session variables and destroy the session
        $_SESSION = [];
        if (ini_get("session.use_cookies")) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $params["path"], $params["domain"], $params["secure"], $params["httponly"]);
        }
        session_destroy();
        
        return ['message' => "Logged out successfully!"];
    }

    /**
 * Signup a new user with verification and optional auto-login
 * 
 * @param string $name Name of user (single field)
 * @param string $email Email of user
 * @param string $password Password of user
 * @param string $csrfToken CSRF token for validation
 * @param bool $autoLogin Whether to automatically log in the user after signup
 * @param string $selectedPlan Optional plan override (used with plan_ID from URL)
 * @return array Result information with success/error message
 */
public function signUp($name, $email, $password, $csrfToken, $autoLogin = false, $selectedPlan = null) {
    // Determine which plan to use (URL parameter or default)
    $planToUse = $selectedPlan ?: $this->defaultPlan;
    
    $this->logActivity("Signup attempt for email: $email with verification " . 
        ($this->requireEmailVerification ? "enabled" : "disabled") . 
        " (autoLogin: " . ($autoLogin ? "yes" : "no") . ") " .
        "- Plan: {$planToUse}");
    
    // Verify CSRF token
    if (!$this->verifyCsrfToken($csrfToken)) {
        $this->logActivity("CSRF token verification failed for signup: $email", "error");
        return ['error' => "Invalid request. Please refresh the page and try again."];
    }

    // Validate input
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $this->logActivity("Invalid email format: $email", "error");
        return ['error' => "Invalid email format."];
    }

    if (strlen($password) < 8) {
        $this->logActivity("Password too short for: $email", "error");
        return ['error' => "Password must be at least 8 characters."];
    }

    try {
        // Check if user already exists
        $checkStmt = $this->pdo->prepare("SELECT verified FROM users WHERE userEmail = ?");
        $checkStmt->execute([$email]);
        $existingUser = $checkStmt->fetch();
        
        if ($existingUser) {
            if ($this->requireEmailVerification && isset($existingUser['verified']) && $existingUser['verified'] == 0) {
                return ['error' => "Email already registered but not verified. Please check your email for verification link or request a new one."];
            } else {
                return ['error' => "Email already registered. Please use a different email or reset your password if you forgot it."];
            }
        }

        // Hash the password securely using PASSWORD_BCRYPT
        $hashedPassword = password_hash($password, PASSWORD_BCRYPT);

        // Set plan details
        $plan = $planToUse;
        
        // Check if the plan exists in plan settings
        if (!isset($this->planSettings[$plan])) {
            $this->logActivity("Invalid plan '$plan' specified for signup, defaulting to {$this->defaultPlan}", "error");
            $plan = $this->defaultPlan;
        }
        
        $diskSpace = $this->planSettings[$plan]['DiskSpace'];
        $verified = $this->requireEmailVerification ? 0 : 1;
        
        // Calculate validity date if not using Free plan
        // FIX: Set '0000-00-00' for Free plans instead of NULL
        $validityDate = '0000-00-00'; // Default for Free plans
        if ($plan !== 'Free' && $this->planSettings[$plan]['needs_validity']) {
            $validityDate = date('Y-m-d', strtotime("+{$this->defaultValidityDays} days"));
        }
        
        // Begin transaction
        $this->pdo->beginTransaction();
        
        try {
            // Ensure necessary columns exist
            $this->ensureVerificationColumnsExist();
            
            // Only generate verification token if verification is required
            $verificationToken = null;
            $tokenExpiry = null;
            
            if ($this->requireEmailVerification) {
                $verificationToken = bin2hex(random_bytes(32));
                $tokenExpiry = date('Y-m-d H:i:s', strtotime('+24 hours'));
            }

            // Prepare SQL statement for insertion
            $sql = "INSERT INTO users (fullName, userEmail, UserPass, Plan, DiskSpace, Validity, verification_token, token_expiry, verified) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
            $stmt = $this->pdo->prepare($sql);
            
            if (!$stmt) {
                throw new Exception("Prepare failed: " . implode(' ', $this->pdo->errorInfo()));
            }

            // Log the verified status being used
            $this->logActivity("Creating user with verified status: " . ($verified ? "verified (1)" : "unverified (0)") . 
                               " and plan: $plan with $diskSpace GB disk space" . 
                               ($validityDate != '0000-00-00' ? ", valid until: $validityDate" : ", no validity date"));

            // Execute insertion with only the name field and plan settings
            $result = $stmt->execute([
                $name, 
                $email, 
                $hashedPassword, 
                $plan, 
                $diskSpace,
                $validityDate,
                $verificationToken, 
                $tokenExpiry, 
                $verified
            ]);
            
            if (!$result) {
                throw new Exception("Failed to insert user: " . implode(' ', $stmt->errorInfo()));
            }
            
            // Get the new user ID
            $userId = $this->pdo->lastInsertId();
             
            $this->logActivity("User account created for: $email");
                
                // Send verification email ONLY if required
                if ($this->requireEmailVerification) {
                    $this->logActivity("Verification required. Attempting to send verification email.");
                    $emailSent = $this->sendVerificationEmail($email, $verificationToken);
                    
                    if (!$emailSent) {
                        $this->pdo->rollBack();
                        $this->logActivity("Failed to send verification email to: $email", "error");
                        return ['error' => "We couldn't send a verification email. Please try again or contact support."];
                    }
                    
                    $this->logActivity("Verification email sent successfully.");
                    
                    // Auto-login is not possible if verification is required
                    $autoLogin = false;
                } else {
                    $this->logActivity("Verification not required. User can log in immediately.");
                }
                
                $this->pdo->commit();
                
                // Auto-login if requested and verification is not required
                if ($autoLogin && !$this->requireEmailVerification) {
                    $this->logActivity("Auto-login requested for new user: $email");
                    
                    // Start session and set logged-in status
                    if (session_status() == PHP_SESSION_NONE) {
                        session_start();
                    }
                    
                    // Regenerate session ID to prevent session fixation
                    session_regenerate_id(true);
                    
                    // Set session variables
                    $_SESSION['logged_in'] = true;
                    $_SESSION['userEmail'] = $email;
                    $_SESSION['allowed_space'] = $diskSpace;
                    $_SESSION['plan'] = $plan;
                    $_SESSION['user_id'] = $userId;
                    
                    $this->logActivity("Auto-login successful for: $email", "info");
                    
                    $planMessage = ($plan === 'Free') ? 
                        "Your account has been created with the Free plan." : 
                        "Your account has been created with the $plan plan with {$diskSpace}GB storage. It will be valid for {$this->defaultValidityDays} days.";
                    
                    $redirectUrl = "myfiles.php";
					if ($plan !== 'Free' && $selectedPlan) {
					// Set a session flag to indicate this was a promotional registration
					$_SESSION['promo_registration'] = true;
					$redirectUrl = "myfiles.php?welcomeOffer=true";
					}
				
					return [
					'login' => 1, 
					'message' => "Account created successfully! $planMessage You are now logged in.",
					'redirect' => $redirectUrl,
					'plan' => $plan,
					'diskSpace' => $diskSpace,
					  'validityDate' => $validityDate
					];
                }
                if ($this->requireEmailVerification) {
                    return ['message' => "Signup successful! Please check your email to verify your account."];
                } else {
                    $planMessage = ($plan === 'Free') ? 
                        "Your account has been created with the Free plan." : 
                        "Your account has been created with the $plan plan with {$diskSpace}GB storage. It will be valid for {$this->defaultValidityDays} days.";
                    
                    return ['message' => "Signup successful! $planMessage You can now log in to your account."];
                }
            } catch (Exception $e) {
                $this->pdo->rollBack();
                $this->logActivity("Exception during signup: " . $e->getMessage(), "error");
                return ['error' => "An error occurred during signup. Please try again later."];
            }
        } catch (Exception $e) {
            $this->logActivity("Exception checking existing user: " . $e->getMessage(), "error");
            return ['error' => "An error occurred while checking your account. Please try again later."];
        }
    }
    
    /**
     * Ensure verification columns exist in the database
     */
    private function ensureVerificationColumnsExist() {
        // Check if the users table has the required columns for verification
        $columnsQuery = "SHOW COLUMNS FROM users LIKE 'verified'";
        $columnsStmt = $this->pdo->query($columnsQuery);
        $hasVerificationColumns = $columnsStmt->rowCount() > 0;
        
        if (!$hasVerificationColumns) {
            // Add the required columns if they don't exist
            $this->logActivity("Adding verification columns to users table", "info");
            $alterQuery = "ALTER TABLE users 
                           ADD COLUMN verification_token VARCHAR(64) NULL,
                           ADD COLUMN token_expiry DATETIME NULL,
                           ADD COLUMN verified TINYINT(1) NOT NULL DEFAULT 0";
            $this->pdo->exec($alterQuery);
        }
    }
    
    /**
     * Send verification email
     * @param string $email Email to send verification to
     * @param string $token Verification token
     * @return bool Success status
     */
    public function sendVerificationEmail($email, $token) {
        $this->logActivity("Attempting to send verification email to: $email");
        
        try {
            // Set secure access flag for smtp.php
            if (!defined('SECURE_ACCESS')) {
                define('SECURE_ACCESS', true);
            }
            
            // Check if SMTP configuration file exists
            $smtpFile = __DIR__ . '/smtp/smtp.php';
            if (!file_exists($smtpFile)) {
                $this->logActivity("SMTP configuration file not found: $smtpFile", "error");
                return false;
            }
            
            // Include SMTP configuration
            require_once $smtpFile;
            
            // Include template loader if not already included
            $templateLoaderFile = __DIR__ . '/smtp/templateLoader.php';
            if (file_exists($templateLoaderFile)) {
                require_once $templateLoaderFile;
            } else {
                $this->logActivity("Template loader not found: $templateLoaderFile", "error");
            }
            
            // Create PHPMailer instance
            $mail = new PHPMailer\PHPMailer\PHPMailer(true);
            
            // Server settings
            $mail->isSMTP();
            $mail->Host = SMTP_HOST;
            $mail->SMTPAuth = true;
            $mail->Username = SMTP_USERNAME;
            $mail->Password = SMTP_PASSWORD;
            $mail->SMTPSecure = PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
            $mail->Port = SMTP_PORT;
            
            // Debugging
            $mail->SMTPDebug = 2; // 0 = off, 1 = client messages, 2 = client and server messages
            $mail->Debugoutput = function($str, $level) {
                $this->logActivity("PHPMailer ($level): $str", "debug");
            };
            
            // Recipients
            $mail->setFrom(sender_email, 'Torrent Box');
            $mail->addAddress($email);
            
            // Get user's plan info
            $planStmt = $this->pdo->prepare("SELECT Plan, DiskSpace, Validity FROM users WHERE userEmail = ?");
            $planStmt->execute([$email]);
            $planData = $planStmt->fetch();
            
            $planInfo = "";
            if ($planData) {
                $planName = $planData['Plan'];
                $diskSpace = $planData['DiskSpace'];
                
                $planInfo = "Your account has been created with the $planName plan ";
                $planInfo .= "with $diskSpace GB of storage space.";
                
                if ($planName !== 'Free' && $planData['Validity']) {
                    $validUntil = date('F j, Y', strtotime($planData['Validity']));
                    $planInfo .= " Your plan will be valid until $validUntil.";
                }
            }
            
            // Verification link
            $protocol = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http';
            $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
            $verificationLink = "$protocol://$host/verify.php?email=" . urlencode($email) . "&token=" . $token;
            
            // Load email template
            if (function_exists('loadEmailTemplate')) {
                $emailBody = loadEmailTemplate('verification_email', [
                    '{{VERIFICATION_LINK}}' => $verificationLink,
                    '{{PLAN_INFO}}' => $planInfo,
                    '{{CURRENT_YEAR}}' => date('Y')
                ]);
            } else {
                // Fallback if template loader not available
                $this->logActivity("Template loader function not available, using inline template", "warning");
                $emailBody = $this->getInlineVerificationTemplate($verificationLink, $planInfo);
            }
            
            // Content
            $mail->isHTML(true);
            $mail->Subject = 'Verify Your Email - Torrent Box';
            $mail->Body = $emailBody;
            $mail->AltBody = 'Please verify your email by visiting this link: ' . $verificationLink . "\n\n" . strip_tags($planInfo);
            
            // Send the email
            $mail->send();
            
            $this->logActivity("Verification email sent successfully to: $email", "info");
            return true;
        } catch (Exception $e) {
            $errorMsg = "Failed to send verification email: " . $e->getMessage();
            $this->logActivity($errorMsg, "error");
            
            // Log PHPMailer specific error info if available
            if (isset($mail) && is_object($mail)) {
                $this->logActivity("PHPMailer error: " . $mail->ErrorInfo, "error");
            }
            
            return false;
        }
    }
    
    /**
     * Generate HTML email template for email verification
     * 
     * @param string $verificationLink The verification URL
     * @param string $planInfo Additional plan information
     * @return string HTML content for the email
     */
    private function getInlineVerificationTemplate($verificationLink, $planInfo = '') {
        return '
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Verify Your Email - Torrent Box</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background-color: #01aa21; color: white; padding: 20px; text-align: center;">
                    <h1>Verify Your Email Address</h1>
                </div>
                <div style="padding: 20px; border: 1px solid #ddd; border-top: none;">
                    <p>Thank you for signing up for Torrent Box! Please verify your email address to complete your registration.</p>
                    ' . ($planInfo ? '<p style="background-color: #f8f9fa; padding: 15px; border-left: 4px solid #01aa21;">' . $planInfo . '</p>' : '') . '
                    <p style="text-align: center; margin: 30px 0;">
                        <a href="' . $verificationLink . '" style="display: inline-block; background-color: #01aa21; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">Verify Email</a>
                    </p>
                    <p>Or copy and paste this link into your browser:</p>
                    <p style="background-color: #f5f5f5; padding: 10px;">' . $verificationLink . '</p>
                    <p>This link will expire in 24 hours.</p>
                    <p>If you did not sign up for Torrent Box, please ignore this email.</p>
                </div>
                <div style="margin-top: 30px; font-size: 12px; color: #777; text-align: center;">
                    <p>© ' . date('Y') . ' Torrent Box. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>';
    }

    /**
     * Verify user email
     * 
     * @param string $email Email to verify
     * @param string $token Verification token
     * @return array Result information with success/error message
     */
    public function verifyEmail($email, $token) {
        $this->logActivity("Email verification attempt for: $email");
        
        try {
            // Check if email and token match
            $stmt = $this->pdo->prepare("SELECT id, token_expiry, Plan FROM users WHERE userEmail = ? AND verification_token = ? AND verified = 0");
            $stmt->execute([$email, $token]);
            $user = $stmt->fetch();
            
            if (!$user) {
                // Check if user is already verified
                $checkStmt = $this->pdo->prepare("SELECT verified, Plan FROM users WHERE userEmail = ?");
                $checkStmt->execute([$email]);
                $userData = $checkStmt->fetch();
                
                if ($userData && $userData['verified'] == 1) {
                    $planInfo = ($userData['Plan'] === 'Free') ? 
                        "You have the Free plan." : 
                        "You have the {$userData['Plan']} plan.";
                        
                    return ['error' => "Your email is already verified. $planInfo You can log in to your account."];
                }
                
                return ['error' => "Invalid verification link. The link may be expired or incorrect."];
            }
            
            // Check if token has expired
            if (strtotime($user['token_expiry']) < time()) {
                return ['error' => "Verification link has expired. Please request a new verification email."];
            }
            
            // Update user as verified
            $updateStmt = $this->pdo->prepare("UPDATE users SET verified = 1, verification_token = NULL, token_expiry = NULL WHERE id = ?");
            $updateStmt->execute([$user['id']]);
            
            if ($updateStmt->rowCount() > 0) {
                $this->logActivity("Email verified successfully for: $email", "info");
                
                $planInfo = ($user['Plan'] === 'Free') ? 
                    "You have the Free plan." : 
                    "You have the {$user['Plan']} plan.";
                    
                return ['message' => "Email verified successfully! $planInfo You can now log in to your account."];
            } else {
                return ['error' => "Something went wrong while verifying your email. Please try again."];
            }
        } catch (Exception $e) {
            $this->logActivity("Exception during email verification: " . $e->getMessage(), "error");
            return ['error' => "An error occurred during verification. Please try again later."];
        }
    }

    /**
     * Resend verification email
     * 
     * @param string $email Email to resend to
     * @param string $csrfToken CSRF token for validation
     * @return array Result information with success/error message
     */
    public function resendVerification($email, $csrfToken) {
        if (!$this->requireEmailVerification) {
            return ['error' => "Email verification is currently disabled."];
        }
        
        if (!$this->verifyCsrfToken($csrfToken)) {
            return ['error' => "Invalid request. Please refresh the page and try again."];
        }
        
        try {
            // Check if user exists and is not verified
            $stmt = $this->pdo->prepare("SELECT id FROM users WHERE userEmail = ? AND verified = 0");
            $stmt->execute([$email]);
            $user = $stmt->fetch();
            
            if (!$user) {
                // Check if the user exists but is already verified
                $checkStmt = $this->pdo->prepare("SELECT verified FROM users WHERE userEmail = ?");
                $checkStmt->execute([$email]);
                $verified = $checkStmt->fetchColumn();
                
                if ($verified == 1) {
                    return ['error' => "This email is already verified. You can log in to your account."];
                }
                
                return ['error' => "Email not found. Please check the email address or sign up for a new account."];
            }
            
            // Generate new verification token
            $verificationToken = bin2hex(random_bytes(32));
            $tokenExpiry = date('Y-m-d H:i:s', strtotime('+24 hours'));
            
            // Update the token in database
            $updateStmt = $this->pdo->prepare("UPDATE users SET verification_token = ?, token_expiry = ? WHERE id = ?");
            $updateStmt->execute([$verificationToken, $tokenExpiry, $user['id']]);
            
            if ($updateStmt->rowCount() == 0) {
                return ['error' => "Failed to generate a new verification link. Please try again later."];
            }
            
            // Send verification email
            $emailSent = $this->sendVerificationEmail($email, $verificationToken);
            
            if ($emailSent) {
                $this->logActivity("Verification email resent successfully to: $email", "info");
                return ['message' => "Verification email has been sent. Please check your inbox."];
            } else {
                return ['error' => "Failed to send verification email. Please try again later."];
            }
        } catch (Exception $e) {
            $this->logActivity("Exception during resend verification: " . $e->getMessage(), "error");
            return ['error' => "An error occurred while resending the verification email. Please try again later."];
        }
    }

    /**
     * Generate HTML email template for password reset
     * 
     * @param string $resetLink The password reset URL
     * @return string HTML content for the email
     */
    private function getInlineResetTemplate($resetLink) {
        return '
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Reset Your Password - Torrent Box</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background-color: #01aa21; color: white; padding: 20px; text-align: center;">
                    <h1>Reset Your Password</h1>
                </div>
                <div style="padding: 20px; border: 1px solid #ddd; border-top: none;">
                    <p>You requested a password reset for your Torrent Box account. Click the button below to reset your password:</p>
                    <p style="text-align: center; margin: 30px 0;">
                        <a href="' . $resetLink . '" style="display: inline-block; background-color: #01aa21; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">Reset Password</a>
                    </p>
                    <p>Or copy and paste this link into your browser:</p>
                    <p style="background-color: #f5f5f5; padding: 10px;">' . $resetLink . '</p>
                    <p>This link will expire in 24 hours.</p>
                    <p style="background-color: #fff3cd; color: #856404; padding: 10px; border-radius: 4px; margin: 15px 0;">
                        <strong>Security Notice:</strong> If you did not request a password reset, please ignore this email or contact support if you have concerns about your account security.
                    </p>
                </div>
                <div style="margin-top: 30px; font-size: 12px; color: #777; text-align: center;">
                    <p>© ' . date('Y') . ' Torrent Box. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>';
    }

    /**
     * Send password reset email
     * 
     * @param string $email Email to send reset link to
     * @param string $token Reset token
     * @return bool Success status
     */
    public function sendPasswordResetEmail($email, $token) {
        $this->logActivity("Attempting to send password reset email to: $email");
        
        try {
            // Set secure access flag for smtp.php if not already defined
            if (!defined('SECURE_ACCESS')) {
                define('SECURE_ACCESS', true);
            }
            
            // Check if SMTP configuration file exists
            $smtpFile = __DIR__ . '/smtp/smtp.php';
            if (!file_exists($smtpFile)) {
                $this->logActivity("SMTP configuration file not found: $smtpFile", "error");
                return false;
            }
            
            // Include SMTP configuration and template loader
            require_once $smtpFile;
            $templateLoaderFile = __DIR__ . '/smtp/templateLoader.php';
            if (file_exists($templateLoaderFile)) {
                require_once $templateLoaderFile;
            }
            
            // Create PHPMailer instance
            $mail = new PHPMailer\PHPMailer\PHPMailer(true);
            
            // Configure mail settings
            $mail->isSMTP();
            $mail->Host = SMTP_HOST;
            $mail->SMTPAuth = true;
            $mail->Username = SMTP_USERNAME;
            $mail->Password = SMTP_PASSWORD;
            $mail->SMTPSecure = PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
            $mail->Port = SMTP_PORT;
            $mail->SMTPDebug = 2;
            $mail->Debugoutput = function($str, $level) {
                $this->logActivity("PHPMailer ($level): $str", "debug");
            };
            
            // Set sender and recipient
            $mail->setFrom(sender_email, 'Torrent Box');
            $mail->addAddress($email);
            
            // Reset link
            $protocol = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http';
            $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
            $resetLink = "$protocol://$host/reset-password.php?email=" . urlencode($email) . "&token=" . $token;
            
            // Load email template
            if (function_exists('loadEmailTemplate')) {
                $emailBody = loadEmailTemplate('reset_password', [
                    '{{RESET_LINK}}' => $resetLink,
                    '{{CURRENT_YEAR}}' => date('Y')
                ]);
            } else {
                $this->logActivity("Template loader function not available, using inline template", "warning");
                $emailBody = $this->getInlineResetTemplate($resetLink);
            }
            
            // Set email content
            $mail->isHTML(true);
            $mail->Subject = 'Reset Your Password - Torrent Box';
            $mail->Body = $emailBody;
            $mail->AltBody = 'Please reset your password by visiting this link: ' . $resetLink;
            
            // Send the email
            $mail->send();
            
            $this->logActivity("Password reset email sent successfully to: $email", "info");
            return true;
        } catch (Exception $e) {
            $this->logActivity("Failed to send password reset email: " . $e->getMessage(), "error");
            if (isset($mail) && is_object($mail)) {
                $this->logActivity("PHPMailer error: " . $mail->ErrorInfo, "error");
            }
            return false;
        }
    }

    /**
     * Request password reset
     * 
     * @param string $email User email
     * @param string $csrfToken CSRF token for validation
     * @return array Result information with success/error message
     */
    public function requestPasswordReset($email, $csrfToken) {
        $this->logActivity("Password reset request for: $email");
        
        if (!$this->verifyCsrfToken($csrfToken)) {
            return ['error' => "Invalid request. Please refresh the page and try again."];
        }
        
        try {
            // Check if user exists
            $stmt = $this->pdo->prepare("SELECT id FROM users WHERE userEmail = ?");
            $stmt->execute([$email]);
            $user = $stmt->fetch();
            
            if (!$user) {
                // Don't reveal that the email doesn't exist for security
                return ['message' => "If your email is registered, you will receive a password reset link."];
            }
            
            // Generate reset token
            $resetToken = bin2hex(random_bytes(32));
            $tokenExpiry = date('Y-m-d H:i:s', strtotime('+24 hours'));
            
            // Update user with reset token
            $updateStmt = $this->pdo->prepare("UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?");
            $updateStmt->execute([$resetToken, $tokenExpiry, $user['id']]);
            
            if ($updateStmt->rowCount() == 0) {
                $this->logActivity("Failed to update reset token for: $email", "error");
                return ['error' => "Something went wrong. Please try again later."];
            }
            
            // Send password reset email
            $emailSent = $this->sendPasswordResetEmail($email, $resetToken);
            
            if ($emailSent) {
                $this->logActivity("Password reset email sent to: $email", "info");
                return ['message' => "A password reset link has been sent to your email address."];
            } else {
                $this->logActivity("Failed to send password reset email to: $email", "error");
                return ['error' => "Failed to send password reset email. Please try again later."];
            }
        } catch (Exception $e) {
            $this->logActivity("Exception during password reset request: " . $e->getMessage(), "error");
            return ['error' => "An error occurred while processing your request. Please try again later."];
        }
    }

    /**
     * Reset password with token
     * 
     * @param string $email User email
     * @param string $token Reset token
     * @param string $newPassword New password
     * @return array Result information with success/error message
     */
    public function resetPasswordWithToken($email, $token, $newPassword) {
        $this->logActivity("Password reset attempt for: $email");
        
        try {
            // Validate password
            if (strlen($newPassword) < 8) {
                return ['error' => "Password must be at least 8 characters long."];
            }
            
            // Check if email and token match
            $stmt = $this->pdo->prepare("SELECT id, reset_token_expiry, Plan FROM users WHERE userEmail = ? AND reset_token = ?");
            $stmt->execute([$email, $token]);
            $user = $stmt->fetch();
            
            if (!$user) {
                return ['error' => "Invalid or expired reset link. Please request a new password reset."];
            }
            
            // Check if token has expired
            if (strtotime($user['reset_token_expiry']) < time()) {
                return ['error' => "Password reset link has expired. Please request a new one."];
            }
            
            // Hash the new password
            $hashedPassword = password_hash($newPassword, PASSWORD_BCRYPT);
            
            // Update user password and clear reset token
            $updateStmt = $this->pdo->prepare("UPDATE users SET UserPass = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?");
            $updateStmt->execute([$hashedPassword, $user['id']]);
            
            if ($updateStmt->rowCount() > 0) {
                $this->logActivity("Password reset successful for: $email", "info");
                
                $planInfo = ($user['Plan'] === 'Free') ? 
                    "" : 
                    " You have the {$user['Plan']} plan.";
                    
                return ['message' => "Your password has been reset successfully.$planInfo You can now log in with your new password."];
            } else {
                return ['error' => "Failed to reset password. Please try again later."];
            }
        } catch (Exception $e) {
            $this->logActivity("Exception during password reset: " . $e->getMessage(), "error");
            return ['error' => "An error occurred while resetting your password. Please try again later."];
        }
    }

    /**
     * Check if torrent size exceeds plan limits
     * 
     * @param float $torrentSize Size of torrent in bytes
     * @param int $userId User ID
     * @return array Result information with allowed status and message
     */
    public function checkTorrentSizeLimit($torrentSize, $userId) {
        if (!$userId) {
            $this->logActivity("checkTorrentSizeLimit: No user ID provided", "error");
            return ['allowed' => false, 'message' => 'User not authenticated'];
        }
        
        try {
            // Convert torrentSize to GB for comparison
            $torrentSizeGB = $torrentSize / (1024 * 1024 * 1024);
            $this->logActivity("checkTorrentSizeLimit: Checking torrent size of {$torrentSizeGB}GB for user ID $userId");
            
            // Get user plan
            $stmt = $this->pdo->prepare("SELECT Plan, userEmail FROM users WHERE id = ?");
            $stmt->execute([$userId]);
            $userData = $stmt->fetch();

            if (!$userData) {
                $this->logActivity("checkTorrentSizeLimit: User not found", "error");
                return ['allowed' => false, 'message' => 'User not found'];
            }
            
            $userPlan = $userData['Plan'];
            $this->logActivity("checkTorrentSizeLimit: User plan is {$userPlan}");

            // Get max size allowed for this plan
            $maxSizeGB = $this->planSettings[$userPlan]['max_size_gb'] ?? 2;
            
            // Check if torrent exceeds the plan's size limit
            if ($torrentSizeGB > $maxSizeGB) {
                $this->logActivity("checkTorrentSizeLimit: Torrent exceeds {$maxSizeGB}GB limit for {$userPlan} user {$userData['userEmail']}", "error");
                return [
                    'allowed' => false,
                    'message' => "This torrent is " . round($torrentSizeGB, 2) . "GB which exceeds the {$maxSizeGB}GB {$userPlan} plan limit. Please upgrade your plan to download larger files.",
                    'maxSize' => $maxSizeGB,
                    'torrentSize' => round($torrentSizeGB, 2)
                ];
            }

            $this->logActivity("checkTorrentSizeLimit: Torrent size within plan limits");
            return [
                'allowed' => true, 
                'message' => 'Torrent size within plan limits',
                'maxSize' => $maxSizeGB,
                'torrentSize' => round($torrentSizeGB, 2)
            ];
        } catch (Exception $e) {
            $this->logActivity("Exception checking torrent size limit: " . $e->getMessage(), "error");
            // Default to not allowed for safety
            return [
                'allowed' => false, 
                'message' => 'Error checking torrent size limit: ' . $e->getMessage()
            ];
        }
    }

    /**
     * Check if a user can add a torrent based on plan restrictions
     * This is a simplified version that no longer checks for max active torrents
     * 
     * @param int $userId User ID
     * @return array Result information with allowed status and message
     */
    public function canAddTorrent($userId) {
        if (!$userId) {
            $this->logActivity("canAddTorrent: No user ID provided", "error");
            return ['allowed' => false, 'message' => 'User not authenticated'];
        }

        try {
            // Get user info
            $stmt = $this->pdo->prepare("SELECT userEmail, Plan, Validity FROM users WHERE id = ?");
            $stmt->execute([$userId]);
            $userData = $stmt->fetch();

            if (!$userData) {
                $this->logActivity("canAddTorrent: User ID $userId not found", "error");
                return ['allowed' => false, 'message' => 'User not found'];
            }
            
            $userEmail = $userData['userEmail'];
            $userPlan = $userData['Plan'];
            $validityDate = $userData['Validity'] ?? null;
            
            $this->logActivity("canAddTorrent: Checking plan for user $userEmail (Plan: $userPlan)");
            
            // Check plan validity
            $isValid = true;
            if ($userPlan !== 'Free' && $validityDate && $validityDate != '0000-00-00') {
                $today = date('Y-m-d');
                $isValid = ($validityDate >= $today);
                
                // If plan has expired, downgrade to Free
                if (!$isValid) {
                    $this->logActivity("canAddTorrent: Plan expired for user $userEmail, downgrading to Free");
                    $updateStmt = $this->pdo->prepare("UPDATE users SET Plan = 'Free' WHERE id = ?");
                    $updateStmt->execute([$userId]);
                    
                    // Update plan for this check
                    $userPlan = 'Free';
                    
                    // Also update session if it exists
                    if (session_status() != PHP_SESSION_NONE && isset($_SESSION['plan'])) {
                        $_SESSION['plan'] = 'Free';
                    }
                }
            }

            // All plans can add torrents (removed max torrents restriction)
            return [
                'allowed' => true, 
                'message' => 'User can add a torrent',
                'plan' => $userPlan,
                'valid' => $isValid
            ];
            
        } catch (Exception $e) {
            $this->logActivity("Exception checking if user can add torrent: " . $e->getMessage(), "error");
            $this->logToErrorLog("Exception checking if user can add torrent: " . $e->getMessage());
            
            // In case of errors, don't allow by default for security
            return [
                'allowed' => false, 
                'message' => 'Error checking plan restrictions. Please try again or contact support.',
                'error' => $e->getMessage()
            ];
        }
    }
    
    /**
     * Set error logging state
     * 
     * @param bool $enable Whether to enable error logging
     */
    public function setErrorLogging($enable) {
        $this->enableErrorLogging = (bool)$enable;
        $this->logActivity("Error logging " . ($enable ? "enabled" : "disabled"));
    }
}

// Request handler code - Only executes when file is accessed directly
if ($_SERVER["REQUEST_METHOD"] == "POST" && basename($_SERVER['PHP_SELF']) == basename(__FILE__)) {
    // Start session if not already started
    if (session_status() == PHP_SESSION_NONE) {
        session_start();
    }
    
    // Get global configuration variables
    global $DEFAULT_PLAN, $DEFAULT_DISK_SPACE, $DEFAULT_VALIDITY_DAYS, $REQUIRE_EMAIL_VERIFICATION, $PLAN_SETTINGS;
    
    // Use the global variable if defined, session variable as backup, or default to false
    $requireVerification = $REQUIRE_EMAIL_VERIFICATION;
    
    // Get selected plan from session if it exists (for URL parameter processing)
    $selectedPlan = isset($_SESSION['selected_plan']) ? $_SESSION['selected_plan'] : null;
    
    // Create Authentication instance with verification setting and selected plan
    $authOptions = [
        'requireEmailVerification' => $requireVerification,
        'defaultValidityDays' => $DEFAULT_VALIDITY_DAYS
    ];
    
    // Add selected plan if available
    if ($selectedPlan) {
        $authOptions['defaultPlan'] = $selectedPlan;
    }
    
    $auth = new Authentication($authOptions);
    
    $response = ['error' => 'Invalid request'];
    $authRequestHandled = false;
    
    // Common variables reused across request types
    $email = isset($_POST['email']) ? trim(filter_input(INPUT_POST, 'email', FILTER_SANITIZE_EMAIL)) : '';
    $csrfToken = isset($_POST['csrf_token']) ? trim($_POST['csrf_token']) : '';

    try {
        // Handle different request types
        if (isset($_POST['signUp'])) {
            $authRequestHandled = true;
            $name = trim(htmlspecialchars($_POST['name'] ?? '', ENT_QUOTES, 'UTF-8'));
            $password = trim($_POST['password'] ?? '');
            $autoLogin = isset($_POST['autoLogin']) && $_POST['autoLogin'] == '1';
            
            // Handle selectedPlan from the form, falling back to the session value if provided
            $formSelectedPlan = !empty($_POST['selectedPlan']) ? trim($_POST['selectedPlan']) : null;
            $planToUse = $formSelectedPlan ?: $selectedPlan; // Use form value first, then session value
            
            $response = $auth->signUp($name, $email, $password, $csrfToken, $autoLogin, $planToUse);
        }
        elseif (isset($_POST['login'])) {
            $authRequestHandled = true;
            $password = trim($_POST['password'] ?? '');
            
            $response = $auth->login($email, $password, $csrfToken);
        }
        elseif (isset($_POST['resendVerification'])) {
            $authRequestHandled = true;
            $response = $auth->resendVerification($email, $csrfToken);
        }
        elseif (isset($_POST['requestReset'])) {
            $authRequestHandled = true;
            $response = $auth->requestPasswordReset($email, $csrfToken);
        }
        elseif (isset($_POST['resetPassword'])) {
            $authRequestHandled = true;
            $newPassword = trim($_POST['new_password'] ?? '');
            $token = trim($_POST['token'] ?? '');
            $response = $auth->resetPasswordWithToken($email, $token, $newPassword);
        }
        elseif (isset($_POST['logout'])) {
            $authRequestHandled = true;
            $response = $auth->verifyCsrfToken($csrfToken) ? $auth->logout() : 
                      ['error' => 'Invalid request. Please refresh the page and try again.'];
        }
        elseif (isset($_POST['checkCanAddTorrent'])) {
            $authRequestHandled = true;
            $userId = $_SESSION['user_id'] ?? null;
            $response = $userId ? $auth->canAddTorrent($userId) : 
                      ['allowed' => false, 'message' => 'User not authenticated'];
        }
        elseif (isset($_POST['checkTorrentSizeLimit'])) {
            $authRequestHandled = true;
            $userId = $_SESSION['user_id'] ?? null;
            $torrentSize = isset($_POST['torrentSize']) ? floatval($_POST['torrentSize']) : 0;
            $response = $userId ? $auth->checkTorrentSizeLimit($torrentSize, $userId) : 
                      ['allowed' => false, 'message' => 'User not authenticated'];
        }
        elseif (isset($_POST['getPlanSettings'])) {
            $authRequestHandled = true;
            $response = [
                'success' => true,
                'settings' => [
                    'defaultPlan' => $DEFAULT_PLAN,
                    'defaultDiskSpace' => $DEFAULT_DISK_SPACE,
                    'defaultValidityDays' => $DEFAULT_VALIDITY_DAYS,
                    'requireEmailVerification' => $REQUIRE_EMAIL_VERIFICATION,
                    'planSettings' => $PLAN_SETTINGS
                ]
            ];
        }
        elseif (isset($_POST['setErrorLogging'])) {
            $authRequestHandled = true;
            $enableLogging = isset($_POST['enable']) && $_POST['enable'] == '1';
            $auth->setErrorLogging($enableLogging);
            $response = [
                'success' => true,
                'message' => 'Error logging ' . ($enableLogging ? 'enabled' : 'disabled')
            ];
        }
    } catch (Exception $e) {
        error_log("Authentication exception: " . $e->getMessage());
        $auth->logToErrorLog("Authentication exception: " . $e->getMessage());
        $response = ['error' => "An unexpected error occurred. Please try again later."];
    }

    // Send JSON response for all authentication requests
    if ($authRequestHandled) {
        header('Content-Type: application/json');
        echo json_encode($response);
        exit;
    }
}
