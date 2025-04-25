<?php
// Ensure session is started
if (session_status() == PHP_SESSION_NONE) {
    session_start();
}

// ========== CENTRAL CONFIGURATION ==========
// Set this to true to enable email verification, false to disable it
$REQUIRE_EMAIL_VERIFICATION = false;

// Define this as a constant so it's globally accessible
if (!defined('REQUIRE_EMAIL_VERIFICATION')) {
    define('REQUIRE_EMAIL_VERIFICATION', $REQUIRE_EMAIL_VERIFICATION);
}
// ==========================================

// Include the Authentication class
require_once 'authentication.php';

// Check for source parameter in URL for plan selection
$planFromSource = null;
if (isset($_GET['source'])) {
    $sourceParam = $_GET['source'];
    
    // Include authentication to access plan settings
    global $PLAN_SETTINGS;
    
    // Check if the source parameter matches any plan ID
    foreach ($PLAN_SETTINGS as $planName => $planDetails) {
        if (isset($planDetails['plan_ID']) && $planDetails['plan_ID'] === $sourceParam) {
            $planFromSource = $planName;
            break;
        }
    }
}

// Create the Authentication instance with the verification setting and selected plan
$authOptions = ['requireEmailVerification' => $REQUIRE_EMAIL_VERIFICATION];

// Add plan from source if found
if ($planFromSource) {
    $authOptions['defaultPlan'] = $planFromSource;
    
    // Store the selected plan in session for use during registration
    $_SESSION['selected_plan'] = $planFromSource;
}

$auth = new Authentication($authOptions);

// Store verification setting in a session variable as an additional backup
$_SESSION['requireEmailVerification'] = $REQUIRE_EMAIL_VERIFICATION;
 
// Redirect if already logged in
if ($auth->isLoggedIn()) {
    header("Location: myfiles.php");
    exit();
}

// Generate CSRF token
$csrfToken = $auth->generateCsrfToken();

// Get the plan that will be used for registration
$registrationPlan = $planFromSource ?: $auth->getDefaultPlanSettings()['plan'];
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Torcomet Registration</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css">
    <style>
        :root {
            --primary-color: #01aa21;
            --primary-dark: #00702a;
            --error-color: #dc3545;
            --success-color: #28a745;
            --info-color: #17a2b8;
            --warning-color: #ffc107;
            --text-color: #333;
            --light-bg: #f8f9fa;
            --border-color: #dee2e6;
        }
        
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: var(--text-color);
            background: #f4f4f4;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 15px;
        }
        
        .container {
            background-color: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            width: 100%;
            max-width: 600px;
            overflow: hidden;
            padding: 40px;
        }
        
        h1 {
            margin-bottom: 10px;
            font-weight: 500;
            font-size: 32px;
            color: var(--primary-color);
        }
        
        .subtitle {
            color: #868e96;
            margin-bottom: 30px;
        }
        
        .plan-badge {
            display: inline-block;
            background-color: var(--primary-color);
            color: white;
            padding: 5px 10px;
            border-radius: 4px;
            font-size: 14px;
            margin-bottom: 20px;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        .input-container {
            display: flex;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            overflow: hidden;
        }
        
        .input-icon {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 50px;
            background-color: #f8f9fa;
            color: #6c757d;
            border-right: 1px solid var(--border-color);
        }
        
        input {
            flex: 1;
            padding: 12px 15px;
            border: none;
            font-size: 16px;
            outline: none;
        }
        
        button {
            width: 100%;
            padding: 12px 30px;
            background-color: var(--primary-color);
            color: white;
            border: none;
            border-radius: 4px;
            font-size: 16px;
            cursor: pointer;
            transition: background-color 0.2s;
            margin-top: 10px;
        }
        
        button:hover {
            background-color: var(--primary-dark);
        }
        
        .form-footer {
            margin-top: 30px;
            text-align: center;
            font-size: 15px;
        }
        
        .form-footer a {
            color: var(--primary-color);
            text-decoration: none;
            font-weight: 500;
        }
        
        .form-footer a:hover {
            text-decoration: underline;
        }
        
        .message {
            padding: 12px;
            border-radius: 4px;
            margin: 15px 0;
            font-size: 14px;
        }
        
        .error {
            background-color: #f8d7da;
            color: var(--error-color);
            border: 1px solid #f5c6cb;
        }
        
        .success {
            background-color: #d4edda;
            color: var(--success-color);
            border: 1px solid #c3e6cb;
        }
        
        .info {
            background-color: #d1ecf1;
            color: var(--info-color);
            border: 1px solid #bee5eb;
        }
        
        .hidden {
            display: none;
        }
        
        /* Loading spinner */
        .spinner {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid rgba(255,255,255,0.3);
            border-radius: 50%;
            border-top-color: white;
            animation: spin 1s ease-in-out infinite;
            margin-right: 10px;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        /* Responsive adjustments */
        @media (max-width: 500px) {
            .container {
                border-radius: 0;
                box-shadow: none;
                padding: 20px;
            }
            
            body {
                padding: 0;
                background-color: white;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Register</h1>
        <p class="subtitle">Create your account</p>
        
        <?php if ($planFromSource): ?>
        <div class="plan-badge">
            <?php echo htmlspecialchars($registrationPlan); ?> Plan
        </div>
        <?php endif; ?>
        
        <!-- Signup Form -->
        <form id="signupForm">
            <div class="form-group">
                <div class="input-container">
                    <div class="input-icon">
                        <i class="fas fa-user"></i>
                    </div>
                    <input type="text" name="name" id="name" placeholder="Your Name" required>
                </div>
            </div>
            
            <div class="form-group">
                <div class="input-container">
                    <div class="input-icon">
                        <i class="fas fa-envelope"></i>
                    </div>
                    <input type="email" name="email" id="signupEmail" placeholder="Email Address" required>
                </div>
            </div>
            
            <div class="form-group">
                <div class="input-container">
                    <div class="input-icon">
                        <i class="fas fa-lock"></i>
                    </div>
                    <input type="password" name="password" id="signupPassword" placeholder="Password (min 8 characters)" required minlength="8">
                </div>
            </div>
            
            <input type="hidden" name="signUp" value="1">
            <input type="hidden" name="csrf_token" value="<?php echo $csrfToken; ?>">
            <input type="hidden" name="autoLogin" value="1">
            <?php if ($planFromSource): ?>
            <input type="hidden" name="selectedPlan" value="<?php echo htmlspecialchars($planFromSource); ?>">
            <?php endif; ?>
            
            <button type="submit" id="signupBtn">Create Account</button>
            
            <div id="signupMessage" class="message hidden"></div>
            
            <div class="form-footer">
                Already have an account? <a href="login.php">Login here</a>
            </div>
        </form>
    </div>
    
    <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
    <script>
    $(document).ready(function() {
        // Helper function to validate email format
        function validateEmail(email) {
            const re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
            return re.test(String(email).toLowerCase());
        }
        
        // Signup form submission
        $("#signupForm").submit(function(e) {
            e.preventDefault();
            
            // Simple client-side validation
            const email = $("#signupEmail").val();
            const password = $("#signupPassword").val();
            const name = $("#name").val();
            
            const messageDiv = $("#signupMessage");
            messageDiv.removeClass("hidden error success info");
            
            // Validate email format
            if (!validateEmail(email)) {
                messageDiv.addClass("error").text("Please enter a valid email address.").removeClass("hidden");
                return;
            }
            
            // Validate password length
            if (password.length < 8) {
                messageDiv.addClass("error").text("Password must be at least 8 characters long.").removeClass("hidden");
                return;
            }
            
            // Validate name
            if (!name) {
                messageDiv.addClass("error").text("Please enter your name.").removeClass("hidden");
                return;
            }
            
            // Add loading state to button
            const $btn = $("#signupBtn");
            $btn.html('<span class="spinner"></span> Creating account...').prop('disabled', true);
            
            // Show loading message
            messageDiv.addClass("info").text("Processing your request...").removeClass("hidden");
            
            const formData = $(this).serialize();
            
            $.ajax({
                type: "POST",
                url: "authentication.php",
                data: formData,
                dataType: "json",
                success: function(response) {
                    // Reset button
                    $btn.html('Create Account').prop('disabled', false);
                    
                    messageDiv.removeClass("hidden error success info");
                    
                    if (response.error) {
                        messageDiv.addClass("error").text(response.error).removeClass("hidden");
                    } else if (response.login === 1) {
                        // Auto-login successful
                        messageDiv.addClass("success").text("Account created successfully! Redirecting to dashboard...").removeClass("hidden");
                        
                        // Redirect to dashboard immediately
                        window.location.href = "myfiles.php";
                    } else if (response.message) {
                        messageDiv.addClass("success").text(response.message).removeClass("hidden");
                        
                        // Clear form fields
                        $("#signupForm")[0].reset();
                        
                        // If there's a redirect URL in the response, use it
                        if (response.redirect) {
                            setTimeout(function() {
                                window.location.href = response.redirect;
                            }, 1500);
                        } else {
                            // Otherwise redirect to login page after successful signup with delay
                            setTimeout(function() {
                                window.location.href = "login.php";
                            }, 1500);
                        }
                    }
                },
                error: function(xhr, status, error) {
                    // Reset button
                    $btn.html('Create Account').prop('disabled', false);
                    
                    console.log("AJAX Error:", xhr.responseText, status, error);
                    messageDiv.removeClass("hidden info").addClass("error")
                        .text("Signup server error. Please try again later.");
                }
            });
        });
    });
    </script>
</body>
</html>