// Main application initialization
document.addEventListener('DOMContentLoaded', function() {
    console.log('Initializing Brainbow application...');
    
    // Initialize authentication first
    initAuth();
    
    // Initialize UI components
    initializeUI();
    
    // Bind event listeners
    bindEventListeners();
    
    console.log('Application initialized');
});

function bindEventListeners() {
    // Authentication buttons
    const signinBtn = document.getElementById('signin-btn');
    const signupBtn = document.getElementById('signup-btn');
    
    if (signinBtn) signinBtn.addEventListener('click', signin);
    if (signupBtn) signupBtn.addEventListener('click', signup);
    
    // Login form enter key support
    const loginEmail = document.getElementById('login-email');
    const loginPassword = document.getElementById('login-password');
    
    if (loginEmail) {
        loginEmail.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') signin();
        });
    }
    
    if (loginPassword) {
        loginPassword.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') signin();
        });
    }
    
    // Task form validation
    const taskTitle = document.getElementById('task-title');
    if (taskTitle) {
        taskTitle.addEventListener('blur', function() {
            if (this.value.trim() && this.value.length > 200) {
                showFormError('Titel får inte vara längre än 200 tecken');
            }
        });
    }
    
    const taskDescription = document.getElementById('task-description');
    if (taskDescription) {
        taskDescription.addEventListener('blur', function() {
            if (this.value.length > 1000) {
                showFormError('Beskrivning får inte vara längre än 1000 tecken');
            }
        });
    }
    
    // Prevent form submission on enter in sidebar
    const sidebarForm = document.querySelector('.right-sidebar-content');
    if (sidebarForm) {
        sidebarForm.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && e.target.type !== 'textarea') {
                e.preventDefault();
            }
        });
    }
    
    // Window resize handler for responsive behavior
    window.addEventListener('resize', handleResize);
}

function handleResize() {
    const sidebar = document.getElementById('sidebar');
    const rightSidebar = document.getElementById('rightSidebar');
    
    // Close mobile sidebars on desktop
    if (window.innerWidth > 768) {
        if (sidebar) sidebar.classList.remove('show');
        if (rightSidebar && rightSidebar.classList.contains('active')) {
            // Only close if it was opened via mobile menu
            const container = document.getElementById('app-container');
            if (container && !container.classList.contains('sidebar-open')) {
                closeRightSidebar();
            }
        }
    }
}

// Error handling for unhandled errors
window.addEventListener('error', function(e) {
    console.error('Unhandled error:', e.error);
    
    // Don't show user-facing error for minor issues
    if (e.error && e.error.message && e.error.message.includes('ResizeObserver')) {
        return;
    }
    
    // Show notification for other errors in development
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        showNotification('Ett fel uppstod: ' + e.error?.message, 'error');
    }
});

// Handle unhandled promise rejections
window.addEventListener('unhandledrejection', function(e) {
    console.error('Unhandled promise rejection:', e.reason);
    
    // Show user-friendly error for network issues
    if (e.reason && e.reason.message && e.reason.message.includes('fetch')) {
        showNotification('Nätverksproblem. Kontrollera din internetanslutning.', 'error');
    }
    
    // Prevent default error handling
    e.preventDefault();
});

// Service worker registration (if you add PWA support later)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        // Uncomment when you add a service worker
        // navigator.serviceWorker.register('/sw.js').then(function(registration) {
        //     console.log('SW registered: ', registration);
        // }).catch(function(registrationError) {
        //     console.log('SW registration failed: ', registrationError);
        // });
    });
}

// Performance monitoring
if (window.performance) {
    window.addEventListener('load', function() {
        setTimeout(function() {
            const perfData = performance.getEntriesByType('navigation')[0];
            if (perfData) {
                console.log('Page load time:', perfData.loadEventEnd - perfData.loadEventStart, 'ms');
            }
        }, 0);
    });
}

// Debug mode helpers (only in development)
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    window.brainbowDebug = {
        getTasks: () => tasks,
        getCurrentUser: () => currentUser,
        getUserProfile: () => userProfile,
        getSupabase: () => supabase,
        clearLocalStorage: () => {
            if (currentUser) {
                localStorage.removeItem(`brainbow_tasks_${currentUser.id}`);
                console.log('Local storage cleared');
            }
        },
        reloadTasks: async () => {
            await loadTasks();
            console.log('Tasks reloaded');
        },
        exportTasksJson: () => {
            const data = JSON.stringify(tasks, null, 2);
            console.log(data);
            return data;
        }
    };
    
    console.log('Debug helpers available at window.brainbowDebug');
}

// Cleanup function for page unload
window.addEventListener('beforeunload', function() {
    // Save any pending changes to localStorage as backup
    if (currentUser && tasks.length > 0) {
        localStorage.setItem(`brainbow_tasks_${currentUser.id}`, JSON.stringify(tasks));
    }
});