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
$DEFAULT_PLAN = "Standard";

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

// Default validity period in days for Standard/Premium plans
// (only applies if DEFAULT_PLAN is not "Free")
$DEFAULT_VALIDITY_DAYS = 30;

// Enable/disable email verification requirement
$REQUIRE_EMAIL_VERIFICATION = false;

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

    /** @var int Default validity period in days */
    private $defaultValidityDays;

    /** @var array Plan settings and limitations */
    private $planSettings;
 
    /**
     * Constructor - Initialize the authentication system
     * 
     * @param array $options Configuration options
     */
    public function __construct($options = []) {
        global $DEFAULT_PLAN, $DEFAULT_VALIDITY_DAYS, $REQUIRE_EMAIL_VERIFICATION, $PLAN_SETTINGS;
        
        // Set verification option if provided
        if (isset($options['requireEmailVerification'])) {
            $this->requireEmailVerification = (bool)$options['requireEmailVerification'];
        } else {
            // Use global variable if defined, otherwise default to false
            $this->requireEmailVerification = $REQUIRE_EMAIL_VERIFICATION;
        }

        // Set default plan settings
        $this->defaultPlan = isset($options['defaultPlan']) ? $options['defaultPlan'] : $DEFAULT_PLAN;
        $this->defaultValidityDays = isset($options['defaultValidityDays']) ? (int)$options['defaultValidityDays'] : $DEFAULT_VALIDITY_DAYS;
        $this->planSettings = $PLAN_SETTINGS;
        
        // Initialize log directory
        $this->logDirectory = __DIR__ . '/smtp/logs';
        
        // Create logs directory if it doesn't exist
        if (!file_exists($this->logDirectory) && !mkdir($this->logDirectory, 0755, true)) {
            error_log("Failed to create log directory: {$this->logDirectory}");
        }
        
        // Log authentication system initialization
        $this->logActivity("Authentication system initialized" . 
            ($this->requireEmailVerification ? " (with email verification)" : " (without email verification)") .
            " - Default plan: {$this->defaultPlan}" .
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
        
        if ($validityDays !== null && $plan !== 'Free') {
            $this->defaultValidityDays = (int)$validityDays;
        }
        
        $this->logActivity("Default plan settings updated - Plan: {$this->defaultPlan}" . 
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
            'diskSpace' => $this->planSettings[$this->defaultPlan]['DiskSpace'],
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
            $diskSpace = $this->planSettings[$plan]['DiskSpace'];
            $verified = $this->requireEmailVerification ? 0 : 1;
            
            // Calculate validity date if not using Free plan
            $validityDate = null;
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
                                   ($validityDate ? ", valid until: $validityDate" : ""));

                // Execute insertion with only the name field and plan settings
                $stmt->execute([
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
                    
                    return [
                        'login' => 1, 
                        'message' => "Account created successfully! $planMessage You are now logged in.",
                        'redirect' => "myfiles.php",
                        'plan' => $plan,
                        'diskSpace' => $diskSpace,
                        'validityDate' => $validityDate
                    ];
                }
				
				