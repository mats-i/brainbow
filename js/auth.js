// Supabase configuration
const SUPABASE_URL = 'https://xatcagucuovqsgznjnae.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdGNhZ3VjdW92cXNnem5qbmFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0ODU5NzksImV4cCI6MjA3MjA2MTk3OX0.QjnOKDruSkasrzA5zcYbS-ImyFNrcUqbNOefdYwLfZE';

// Initialize Supabase client
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Global auth state
let currentUser = null;
let userProfile = null;

// Utility functions
function showMessage(message, type = 'error') {
    const messageEl = document.getElementById('auth-message');
    messageEl.textContent = message;
    messageEl.className = type === 'error' ? 'error-message' : 'success-message';
    setTimeout(() => {
        messageEl.textContent = '';
        messageEl.className = '';
    }, 4000);
}

function setLoading(loading) {
    const form = document.getElementById('login-form');
    if (loading) {
        form.classList.add('loading');
    } else {
        form.classList.remove('loading');
    }
}

function updateSyncStatus(status, message) {
    const statusEl = document.getElementById('sync-status');
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.className = `sync-status ${status}`;
        
        if (status === 'synced') {
            setTimeout(() => {
                statusEl.style.opacity = '0';
                setTimeout(() => statusEl.style.display = 'none', 300);
            }, 2000);
        }
    }
}

// Authentication functions
async function initAuth() {
    console.log('Initializing authentication...');
    updateSyncStatus('syncing', 'Ansluter...');
    
    try {
        // Check if user is already logged in
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session) {
            currentUser = session.user;
            await loadUserProfile();
            showMainApp();
            await loadTasks();
            updateSyncStatus('synced', 'Ansluten');
        } else {
            showLoginScreen();
        }
        
        // Listen for auth changes
        supabase.auth.onAuthStateChange(async (event, session) => {
            console.log('Auth state changed:', event);
            
            if (event === 'SIGNED_IN' && session) {
                currentUser = session.user;
                await loadUserProfile();
                showMainApp();
                await loadTasks();
                updateSyncStatus('synced', 'Ansluten');
            } else if (event === 'SIGNED_OUT') {
                currentUser = null;
                userProfile = null;
                tasks = [];
                showLoginScreen();
            }
        });
    } catch (error) {
        console.error('Auth initialization error:', error);
        updateSyncStatus('error', 'Anslutningsfel');
        showLoginScreen();
    }
}

async function loadUserProfile() {
    if (!currentUser) return;
    
    try {
        // Try to get existing profile
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id)
            .single();
            
        if (error && error.code === 'PGRST116') {
            // Profile doesn't exist, create one
            const newProfile = {
                id: currentUser.id,
                email: currentUser.email,
                full_name: currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0]
            };
            
            const { data: createdProfile, error: createError } = await supabase
                .from('profiles')
                .insert(newProfile)
                .select()
                .single();
                
            if (createError) throw createError;
            userProfile = createdProfile;
        } else if (error) {
            throw error;
        } else {
            userProfile = profile;
        }
        
        updateUserInfo();
    } catch (error) {
        console.error('Error loading user profile:', error);
        // Create basic profile from user data
        userProfile = {
            id: currentUser.id,
            email: currentUser.email,
            full_name: currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0]
        };
        updateUserInfo();
    }
}

async function signup() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
        showMessage('Fyll i både email och lösenord');
        return;
    }

    if (password.length < 6) {
        showMessage('Lösenordet måste vara minst 6 tecken');
        return;
    }

    setLoading(true);
    
    try {
        const { error } = await supabase.auth.signUp({
            email: email,
            password: password,
            options: {
                emailRedirectTo: window.location.href
            }
        });
        
        if (error) throw error;
        
        showMessage('Konto skapat! Kolla din email för att bekräfta kontot.', 'success');
    } catch (error) {
        console.error('Signup error:', error);
        showMessage('Fel vid kontoskapande: ' + error.message);
    }
    
    setLoading(false);
}

async function signin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
        showMessage('Fyll i både email och lösenord');
        return;
    }

    setLoading(true);
    
    try {
        const { error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });
        
        if (error) throw error;
        
    } catch (error) {
        console.error('Signin error:', error);
        showMessage('Fel vid inloggning: ' + error.message);
        setLoading(false);
    }
}

async function logout() {
    try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        console.log('SignOut: Success, calling hideUserMenu and fallback to login screen.');
        hideUserMenu();
        // Fallback: visa login-skärmen även om event inte triggar
        setTimeout(() => {
            if (document.getElementById('app-container').style.display !== 'none') {
                console.warn('Fallback: Forcing login screen after logout.');
                showLoginScreen();
            }
        }, 500);
    } catch (error) {
        console.error('Error signing out:', error);
        showMessage('Fel vid utloggning: ' + error.message);
        // Fallback: visa login-skärmen även vid fel
        setTimeout(() => {
            if (document.getElementById('app-container').style.display !== 'none') {
                console.warn('Fallback: Forcing login screen after logout error.');
                showLoginScreen();
            }
        }, 500);
    }
}

function showLoginScreen() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-container').style.display = 'none';
    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';
    const syncStatus = document.getElementById('sync-status');
    if (syncStatus) syncStatus.style.display = 'none';
}

function showMainApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    const syncStatus = document.getElementById('sync-status');
    if (syncStatus) syncStatus.style.display = 'block';
}

function updateUserInfo() {
    if (!userProfile) return;
    
    const userNameEl = document.getElementById('user-name');
    const userAvatarEl = document.getElementById('user-avatar');
    
    if (userNameEl) userNameEl.textContent = userProfile.full_name || userProfile.email;
    if (userAvatarEl) userAvatarEl.textContent = (userProfile.full_name || userProfile.email).charAt(0).toUpperCase();
}

function toggleUserMenu() {
    const dropdown = document.getElementById('user-dropdown');
    dropdown.classList.toggle('show');
}

function hideUserMenu() {
    const dropdown = document.getElementById('user-dropdown');
    if (dropdown) dropdown.classList.remove('show');
}

function showProfile() {
    hideUserMenu();
    if (userProfile) {
        alert(`Profil:\nEmail: ${userProfile.email}\nNamn: ${userProfile.full_name}\nMedlem sedan: ${new Date(userProfile.created_at).toLocaleDateString('sv-SE')}`);
    }
}

function exportData() {
    hideUserMenu();
    
    const data = {
        tasks: tasks,
        profile: userProfile,
        exported_at: new Date().toISOString(),
        version: '1.0'
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `brainbow-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
}
