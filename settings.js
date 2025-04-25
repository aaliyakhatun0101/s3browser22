document.addEventListener('DOMContentLoaded', function() {
    console.log('settings.js loaded');
    
    // Tab switching functionality
    const tabHeaders = document.querySelectorAll('.tab-header');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabHeaders.forEach(header => {
        header.addEventListener('click', function() {
            // Remove active class from all headers and contents
            tabHeaders.forEach(h => h.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            
            // Add active class to clicked header
            this.classList.add('active');
            
            // Get the tab name and activate the corresponding content
            const tabName = this.getAttribute('data-tab');
            document.getElementById(tabName + '-tab').classList.add('active');
        });
    });
    
    // Change Password Functionality
    const savePasswordBtn = document.getElementById('save-password');
    const newPasswordInput = document.getElementById('new-password');
    const confirmPasswordInput = document.getElementById('confirm-password');
    const passwordMessage = document.getElementById('password-message');
    
    if (savePasswordBtn) {
        savePasswordBtn.addEventListener('click', function() {
            const newPassword = newPasswordInput.value;
            const confirmPassword = confirmPasswordInput.value;
            
            // Clear previous messages
            passwordMessage.innerHTML = '';
            passwordMessage.className = 'message-container';
            
            // Validate inputs
            if (!newPassword) {
                showMessage(passwordMessage, 'Please enter a new password', 'error');
                return;
            }
            
            if (newPassword.length < 8) {
                showMessage(passwordMessage, 'Password must be at least 8 characters long', 'error');
                return;
            }
            
            if (newPassword !== confirmPassword) {
                showMessage(passwordMessage, 'Passwords do not match', 'error');
                return;
            }
            
            // Show loading state
            savePasswordBtn.disabled = true;
            savePasswordBtn.textContent = 'Saving...';
            
            // Send AJAX request
            sendAjaxRequest('changePassword', {
                newPassword: newPassword,
                confirmPassword: confirmPassword
            }).then(response => {
                if (response.success) {
                    showMessage(passwordMessage, response.message, 'success');
                    newPasswordInput.value = '';
                    confirmPasswordInput.value = '';
                } else {
                    showMessage(passwordMessage, response.message, 'error');
                }
            }).catch(error => {
                showMessage(passwordMessage, 'Error: ' + error.message, 'error');
            }).finally(() => {
                savePasswordBtn.disabled = false;
                savePasswordBtn.textContent = 'Save';
            });
        });
    }
    
    // Change Email Functionality
    const saveEmailBtn = document.getElementById('save-email');
    const newEmailInput = document.getElementById('new-email');
    const emailMessage = document.getElementById('email-message');
    
    if (saveEmailBtn) {
        saveEmailBtn.addEventListener('click', function() {
            const newEmail = newEmailInput.value;
            
            // Clear previous messages
            emailMessage.innerHTML = '';
            emailMessage.className = 'message-container';
            
            // Validate input
            if (!newEmail) {
                showMessage(emailMessage, 'Please enter a new email', 'error');
                return;
            }
            
            if (!isValidEmail(newEmail)) {
                showMessage(emailMessage, 'Please enter a valid email address', 'error');
                return;
            }
            
            // Show loading state
            saveEmailBtn.disabled = true;
            saveEmailBtn.textContent = 'Saving...';
            
            // Send AJAX request
            sendAjaxRequest('changeEmail', {
                newEmail: newEmail
            }).then(response => {
                if (response.success) {
                    showMessage(emailMessage, response.message, 'success');
                    newEmailInput.value = '';
                    
                    // Update displayed email in the UI
                    const userEmailEl = document.querySelector('.user-email');
                    if (userEmailEl) {
                        userEmailEl.textContent = newEmail;
                    }
                } else {
                    showMessage(emailMessage, response.message, 'error');
                }
            }).catch(error => {
                showMessage(emailMessage, 'Error: ' + error.message, 'error');
            }).finally(() => {
                saveEmailBtn.disabled = false;
                saveEmailBtn.textContent = 'Save';
            });
        });
    }
    
    // Delete Account Functionality
    const deleteAccountBtn = document.querySelector('.delete-account-btn');
    
    if (deleteAccountBtn) {
        deleteAccountBtn.addEventListener('click', function() {
            if (confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
                if (confirm('All your data will be permanently deleted. Are you absolutely sure?')) {
                    // Send AJAX request
                    sendAjaxRequest('deleteAccount').then(response => {
                        if (response.success) {
                            alert(response.message);
                            // Redirect to login page
                            window.location.href = 'login.php';
                        } else {
                            alert('Error: ' + response.message);
                        }
                    }).catch(error => {
                        alert('Error: ' + error.message);
                    });
                }
            }
        });
    }
    
    
    
    // Helper Functions
    function isValidEmail(email) {
        const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        return re.test(email);
    }
    
    function showMessage(container, message, type) {
        container.textContent = message;
        container.className = 'message-container ' + type;
    }
    
    function sendAjaxRequest(action, data = {}) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const formData = new FormData();
            
            // Add action to form data
            formData.append('action', action);
            
            // Add other data to form data
            for (const key in data) {
                formData.append(key, data[key]);
            }
            
            xhr.open('POST', window.location.href, true);
            
            xhr.onload = function() {
                if (xhr.status === 200) {
                    try {
                        const response = JSON.parse(xhr.responseText);
                        resolve(response);
                    } catch (e) {
                        reject(new Error('Invalid response format'));
                    }
                } else {
                    reject(new Error('Request failed. Status: ' + xhr.status));
                }
            };
            
            xhr.onerror = function() {
                reject(new Error('Network error'));
            };
            
            xhr.send(formData);
        });
    }
});