// Expose selectProject globally for UI usage
window.selectProject = selectProject;
// Expose toggleTaskComplete globally for UI usage
window.toggleTaskComplete = toggleTaskComplete;
// Expose createTask globally for UI usage
window.createTask = createTask;
// Expose getTask globally for UI usage
window.getTask = getTask;

console.log('tasks.js laddas!');

// Cache för användar-id till namn
const assigneeNameCache = {};

// Global task state
let tasks = [];
window.tasks = tasks;
let currentProject = 'all';

// Loading state management
let isLoading = false;
let loadingOperations = new Set();

// Retry configuration
const RETRY_CONFIG = {
    maxRetries: 3,
    baseDelay: 1000, // 1 second
    maxDelay: 10000  // 10 seconds
};

// Loader helpers (must be available globally before anything else)
window.showTaskLoader = function showTaskLoader() {
    const taskList = document.getElementById('task-list');
    if (taskList) {
        taskList.innerHTML = '<li class="loading-state"><span>Laddar aktiviteter...</span></li>';
    }
};

window.hideTaskLoader = function hideTaskLoader() {
    // Gör inget, renderTasks() skriver över listan
};

console.log('window.showTaskLoader är nu satt:', typeof window.showTaskLoader);
console.log('window.hideTaskLoader är nu satt:', typeof window.hideTaskLoader);

// Operation loading management
function setOperationLoading(operation, loading) {
    if (loading) {
        loadingOperations.add(operation);
    } else {
        loadingOperations.delete(operation);
    }
    
    isLoading = loadingOperations.size > 0;
    updateLoadingUI();
}

function updateLoadingUI() {
    // Update sync status based on loading state
    const indicator = document.getElementById('sync-indicator');
    if (!navigator.onLine) {
        updateSyncStatus('error', 'Offline-läge – ändringar sparas lokalt');
        if (indicator) {
            indicator.className = 'sync-indicator sync-indicator-error';
            indicator.title = 'Offline – ändringar sparas lokalt';
        }
    } else if (isLoading) {
        updateSyncStatus('syncing', 'Synkar...');
        if (indicator) {
            indicator.className = 'sync-indicator sync-indicator-syncing';
            indicator.title = 'Synkar med server...';
        }
    } else {
        updateSyncStatus('synced', 'Synkad');
        if (indicator) {
            indicator.className = 'sync-indicator sync-indicator-synced';
            indicator.title = 'Synkad';
        }
    }
}

// Hämta användarnamn från Supabase/profiles
window.getAssigneeName = async function(userId) {
    if (!userId) return '';
    if (assigneeNameCache[userId]) return assigneeNameCache[userId];
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('full_name, email')
            .eq('id', userId)
            .single();
        if (error) throw error;
        const name = data.full_name || data.email || userId;
        assigneeNameCache[userId] = name;
        return name;
    } catch (err) {
        console.error('Kunde inte hämta användarnamn:', err);
        return userId;
    }
};

async function retryOperation(operation, maxRetries = RETRY_CONFIG.maxRetries) {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            
            if (attempt === maxRetries) {
                throw error;
            }
            
            // Exponential backoff with jitter
            const delay = Math.min(
                RETRY_CONFIG.baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
                RETRY_CONFIG.maxDelay
            );
            
            console.log(`Operation failed, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw lastError;
}

function renderTasksNew() {
    console.log('renderTasksNew called with', tasks.length, 'total tasks');
    console.log('This is the NEW renderTasks function from tasks.js!');
    const taskList = document.getElementById('task-list');
    if (!taskList) {
        console.error('task-list element not found in DOM');
        return;
    }
    
    taskList.innerHTML = '';
    window.tasks = tasks;

    let filteredTasks = tasks;
    // Apply project filter if not "all"
    if (currentProject !== 'all') {
        filteredTasks = filteredTasks.filter(task => task.project === currentProject);
    }
    // Apply active user filter if set
    if (window.activeUserFilter) {
        const f = window.activeUserFilter;
        if (f.project) filteredTasks = filteredTasks.filter(task => task.project === f.project);
        if (f.assignee) filteredTasks = filteredTasks.filter(task => (task.assignee || '').toString().includes(f.assignee));
        if (f.status === 'open') filteredTasks = filteredTasks.filter(task => !task.completed);
        if (f.status === 'completed') filteredTasks = filteredTasks.filter(task => task.completed);
        if (f.priority) filteredTasks = filteredTasks.filter(task => task.priority === f.priority);
        if (f.tags) {
            const tags = f.tags.split(',').map(t => t.trim().replace(/^#/, ''));
            filteredTasks = filteredTasks.filter(task => {
                if (!task.tags) return false;
                return tags.every(tag => task.tags.includes(tag));
            });
        }
        if (f.date_from) filteredTasks = filteredTasks.filter(task => task.deadline && task.deadline >= f.date_from);
        if (f.date_to) filteredTasks = filteredTasks.filter(task => task.deadline && task.deadline <= f.date_to);
        // Sort
        if (f.sortby) {
            filteredTasks = filteredTasks.slice().sort((a, b) => {
                if (!a[f.sortby] && !b[f.sortby]) return 0;
                if (!a[f.sortby]) return 1;
                if (!b[f.sortby]) return -1;
                if (f.sortby === 'priority') {
                    const prioOrder = { high: 1, medium: 2, low: 3 };
                    return (prioOrder[a.priority] || 99) - (prioOrder[b.priority] || 99);
                }
                return a[f.sortby] > b[f.sortby] ? 1 : -1;
            });
        }
    }

    console.log('Filtered tasks count:', filteredTasks.length, 'Current project:', currentProject);

    if (filteredTasks.length === 0) {
        console.log('No filtered tasks, showing empty state');
        taskList.innerHTML = `
            <li class="empty-state">
                <h3>Inga uppgifter ännu</h3>
                <p>Skapa din första uppgift genom att klicka "+ Ny uppgift"</p>
            </li>
        `;
        return;
    }

    console.log('Rendering', filteredTasks.length, 'tasks to DOM');

    // Render tasks asynchronously
    (async () => {
        console.log('Starting async task rendering...');
        try {
            for (const task of filteredTasks) {
                console.log('Rendering task:', task.id, task.title);
                const li = document.createElement('li');
                li.className = `task-item${task.completed ? ' completed' : ''}`;
                li.onclick = () => editTask(task.id);

                const isOverdue = task.deadline && new Date(task.deadline) < new Date() && !task.completed;
                const deadlineText = task.deadline ? new Date(task.deadline).toLocaleDateString('sv-SE') : '';
                let assigneeName = '';
                if (task.assignee) {
                    assigneeName = await window.getAssigneeName(task.assignee);
                }
                let metaParts = [];
                if (task.priority !== 'medium') metaParts.push(`Prioritet: ${task.priority}`);
                if (deadlineText) metaParts.push(`${deadlineText}${isOverdue ? ' (försenad)' : ''}`);
                if (assigneeName) metaParts.push(escapeHtml(assigneeName));
                // Visa projektet på aktivitetsraden i ALLA vyer utom "Projekt" (där currentProject === 'all')
                if (currentProject !== 'all' && task.project) {
                    metaParts.push(`<span class='task-project-label'>${escapeHtml(task.project)}</span>`);
                }

                li.innerHTML = `
                    <div class="task-checkbox ${task.completed ? 'completed' : ''}" onclick="event.stopPropagation(); toggleTaskComplete('${task.id}')">
                        ${task.completed ? '✓' : ''}
                    </div>
                    <div class="task-content">
                        <div class="task-title">${escapeHtml(task.title)}</div>
                        <div class="task-meta">${metaParts.join(' • ')}</div>
                    </div>
                    <div class="task-actions">
                        <button class="task-action-btn" onclick="event.stopPropagation(); deleteTask('${task.id}')" title="Ta bort">🗑️</button>
                    </div>
                `;
                taskList.appendChild(li);
                console.log('Task appended to taskList:', task.id);
            }
            console.log('Finished rendering all tasks');
        } catch (error) {
            console.error('Error during task rendering:', error);
            taskList.innerHTML = `<li class="error-state">Fel vid visning av uppgifter: ${error.message}</li>`;
        }
    })();
}

async function createTask(taskData) {
    if (!window.currentUser || !taskData.title?.trim()) {
        throw new Error('Titel krävs för att skapa uppgift');
    }

    const tempId = generateId();
    console.log('createTask: currentUser', window.currentUser);
    console.log('createTask: taskData', taskData);
    
    const now = new Date().toISOString();
    const newTask = {
        id: tempId,
        ...taskData,
        title: taskData.title?.trim(),
        priority: taskData.priority || 'medium',
        completed: false,
        completed_at: null,
        created_at: now,
        updated_at: now,
        created_by: window.currentUser.id,
        updated_by: window.currentUser.id,
        completed_by: null
    };
    console.log('createTask: newTask', JSON.stringify(newTask, null, 2));

    // Optimistic update - add to UI immediately
    tasks.unshift(newTask);
    renderTasksNew();
    updateProjectCounts();
    saveToLocalStorage();
    
    setOperationLoading('create', true);

    // Om offline: lägg till pending change och visa notis
    if (!navigator.onLine) {
        addPendingChange('create', tempId, newTask);
        showNotification('Uppgift skapad (offline)', 'info');
        setOperationLoading('create', false);
        return newTask;
    }

    try {
        const result = await retryOperation(async () => {
            console.log('Supabase INSERT newTask:', JSON.stringify(newTask, null, 2));
            const { data, error } = await supabase
                .from('tasks')
                .insert(newTask)
                .select()
                .single();
            if (error) {
                console.error('Supabase insert error:', JSON.stringify(error, null, 2));
                throw error;
            }
            return data;
        });

        // Update with server response (in case server modified anything)
        const taskIndex = tasks.findIndex(t => t.id === tempId);
        if (taskIndex !== -1) {
            tasks[taskIndex] = result;
            renderTasksNew();
            saveToLocalStorage();
        }

        console.log('Task created successfully:', result.id);
        showNotification('Uppgift skapad', 'success');
        
        return result;

    } catch (error) {
        console.error('Error creating task:', error);
        addPendingChange('create', tempId, newTask);
        showNotification('Kunde inte synka, sparar lokalt', 'warning');
        updateSyncStatus('error', 'Syncfel');
        setOperationLoading('create', false);
        return newTask;
    } finally {
        setOperationLoading('create', false);
    }
}

async function updateTask(taskId, updates) {
    if (!window.currentUser || !taskId) {
        throw new Error('Task ID krävs för uppdatering');
    }

    const taskIndex = tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) {
        throw new Error('Uppgift hittades inte');
    }

    const originalTask = { ...tasks[taskIndex] };
    const now = new Date().toISOString();
    
    // If marking as completed, set completed_at/by, else clear
    let completedFields = {};
    if (typeof updates.completed !== 'undefined') {
        if (updates.completed) {
            completedFields.completed_at = now;
            completedFields.completed_by = window.currentUser.id;
        } else {
            completedFields.completed_at = null;
            completedFields.completed_by = null;
        }
    }
    
    const updatedTask = {
        ...originalTask,
        ...updates,
        ...completedFields,
        priority: (typeof updates.priority !== 'undefined' && updates.priority !== null) ? updates.priority : (originalTask.priority || 'medium'),
        updated_at: now,
        updated_by: window.currentUser.id
    };

    // Optimistic update
    tasks[taskIndex] = updatedTask;
    renderTasksNew();
    updateProjectCounts();
    saveToLocalStorage();

    setOperationLoading('update', true);

    // Om offline: lägg till pending change och visa notis
    if (!navigator.onLine) {
        addPendingChange('update', taskId, updates);
        showNotification('Uppgift uppdaterad (offline)', 'info');
        setOperationLoading('update', false);
        return updatedTask;
    }

    try {
        const result = await retryOperation(async () => {
            const dbUpdates = {
                ...updates,
                ...completedFields,
                updated_at: now,
                updated_by: window.currentUser.id
            };
            const { data, error } = await supabase
                .from('tasks')
                .update(dbUpdates)
                .eq('id', taskId)
                .eq('user_id', window.currentUser.id)
                .select('*, created_at, updated_at, completed_at, created_by, updated_by, completed_by')
                .single();
            if (error) throw error;
            return data;
        });

        // Update with server response
        tasks[taskIndex] = result;
        renderTasksNew();
        saveToLocalStorage();

        console.log('Task updated successfully:', taskId);
        showNotification('Uppgift uppdaterad', 'success');
        
        return result;

    } catch (error) {
        console.error('Error updating task:', error);
        addPendingChange('update', taskId, updates);
        showNotification('Kunde inte synka, sparar lokalt', 'warning');
        updateSyncStatus('error', 'Syncfel');
        setOperationLoading('update', false);
        return updatedTask;
    } finally {
        setOperationLoading('update', false);
    }
}

async function deleteTask(taskId) {
    if (!window.currentUser || !taskId) {
        throw new Error('Task ID krävs för borttagning');
    }

    if (!confirm('Är du säker på att du vill ta bort denna uppgift?')) {
        return false;
    }

    const taskIndex = tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) {
        throw new Error('Uppgift hittades inte');
    }

    const taskToDelete = { ...tasks[taskIndex] };

    // Optimistic update
    tasks.splice(taskIndex, 1);
    renderTasksNew();
    updateProjectCounts();
    saveToLocalStorage();

    setOperationLoading('delete', true);

    // Om offline: lägg till pending change och visa notis
    if (!navigator.onLine) {
        addPendingChange('delete', taskId, null);
        showNotification('Uppgift borttagen (offline)', 'info');
        setOperationLoading('delete', false);
        return true;
    }

    try {
        await retryOperation(async () => {
            const { error } = await supabase
                .from('tasks')
                .delete()
                .eq('id', taskId)
                .eq('user_id', window.currentUser.id);
                
            if (error) throw error;
        });

        console.log('Task deleted successfully:', taskId);
        showNotification('Uppgift borttagen', 'success');
        
        return true;

    } catch (error) {
        console.error('Error deleting task:', error);
        addPendingChange('delete', taskId, null);
        showNotification('Kunde inte synka, sparar lokalt', 'warning');
        updateSyncStatus('error', 'Syncfel');
        setOperationLoading('delete', false);
        return true;
    } finally {
        setOperationLoading('delete', false);
    }
}

async function toggleTaskComplete(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
        console.error('Task not found:', taskId);
        return;
    }

    const updates = {
        completed: !task.completed
    };

    setOperationLoading('toggle', true);
    try {
        const result = await updateTask(taskId, updates);
        showNotification(
            result.completed ? 'Uppgift markerad som klar' : 'Uppgift markerad som ej klar',
            'success'
        );
    } catch (error) {
        showNotification('Fel vid ändring av status: ' + error.message, 'error');
        console.error('Error toggling task completion:', error);
    } finally {
        setOperationLoading('toggle', false);
    }
}

// Batch operations for offline/online sync
async function syncPendingChanges() {
    if (!window.currentUser) return;

    const pendingChanges = getPendingChanges();
    if (pendingChanges.length === 0) return;

    setOperationLoading('sync', true);

    try {
        for (const change of pendingChanges) {
            switch (change.operation) {
                case 'create':
                    await createTask(change.data);
                    break;
                case 'update':
                    await updateTask(change.id, change.data);
                    break;
                case 'delete':
                    await deleteTask(change.id);
                    break;
            }
        }

        clearPendingChanges();
        showNotification('Alla ändringar synkade', 'success');

    } catch (error) {
        console.error('Error syncing pending changes:', error);
        showNotification('Vissa ändringar kunde inte synkas', 'error');
    } finally {
        setOperationLoading('sync', false);
    }
}

// Offline support
function saveToLocalStorage() {
    if (!window.currentUser) return;
    
    try {
        localStorage.setItem(`brainbow_tasks_${window.currentUser.id}`, JSON.stringify(tasks));
        localStorage.setItem(`brainbow_last_sync_${window.currentUser.id}`, new Date().toISOString());
    } catch (error) {
        console.error('Error saving to localStorage:', error);
    }
}

function getPendingChanges() {
    if (!window.currentUser) return [];
    
    try {
        const pending = localStorage.getItem(`brainbow_pending_${window.currentUser.id}`);
        return pending ? JSON.parse(pending) : [];
    } catch (error) {
        console.error('Error reading pending changes:', error);
        return [];
    }
}

function addPendingChange(operation, id, data) {
    if (!window.currentUser) return;
    
    try {
        const pending = getPendingChanges();
        pending.push({
            operation,
            id,
            data,
            timestamp: new Date().toISOString()
        });
        localStorage.setItem(`brainbow_pending_${window.currentUser.id}`, JSON.stringify(pending));
    } catch (error) {
        console.error('Error adding pending change:', error);
    }
}

function clearPendingChanges() {
    if (!window.currentUser) return;
    localStorage.removeItem(`brainbow_pending_${window.currentUser.id}`);
}

// Utility functions
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function updateProjectCounts() {
    const counts = {
        all: tasks.length,
        work: tasks.filter(t => t.project === 'work').length,
        personal: tasks.filter(t => t.project === 'personal').length
    };

    Object.entries(counts).forEach(([project, count]) => {
        const countEl = document.getElementById(`count-${project}`);
        if (countEl) {
            countEl.textContent = count;
        }
    });
}

function selectProject(project) {
    currentProject = project;
    
    // Update active project
    document.querySelectorAll('.project-item').forEach(item => {
        item.classList.remove('active');
    });
    
    const projectEl = document.querySelector(`[data-project="${project}"]`);
    if (projectEl) projectEl.classList.add('active');
    
    // Update title
    const titles = {
        'all': 'Alla uppgifter',
        'work': 'Arbete',
        'personal': 'Personligt'
    };
    
    const titleEl = document.getElementById('main-title');
    if (titleEl) titleEl.textContent = titles[project] || 'Okänt projekt';
    
    renderTasksNew();
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (window.innerWidth <= 768) {
        sidebar.classList.toggle('show');
    } else {
        sidebar.classList.toggle('collapsed');
    }
}

// Utility function to escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// Get task by ID
function getTask(taskId) {
    return tasks.find(t => t.id === taskId);
}

// Filter tasks by criteria
function filterTasks(criteria) {
    return tasks.filter(task => {
        let matches = true;
        
        if (criteria.project && criteria.project !== 'all') {
            matches = matches && task.project === criteria.project;
        }
        
        if (criteria.completed !== undefined) {
            matches = matches && task.completed === criteria.completed;
        }
        
        if (criteria.priority) {
            matches = matches && task.priority === criteria.priority;
        }
        
        if (criteria.search) {
            const search = criteria.search.toLowerCase();
            matches = matches && (
                task.title.toLowerCase().includes(search) ||
                (task.description && task.description.toLowerCase().includes(search)) ||
                (task.tags && task.tags.toLowerCase().includes(search))
            );
        }
        
        return matches;
    });
}

// Sort tasks by criteria
function sortTasks(taskArray, sortBy = 'created_at', order = 'desc') {
    return [...taskArray].sort((a, b) => {
        let aVal = a[sortBy];
        let bVal = b[sortBy];
        
        // Handle dates
        if (sortBy.includes('_at') || sortBy === 'deadline') {
            aVal = aVal ? new Date(aVal) : new Date(0);
            bVal = bVal ? new Date(bVal) : new Date(0);
        }
        
        // Handle priority
        if (sortBy === 'priority') {
            const priorityOrder = { low: 1, medium: 2, high: 3 };
            aVal = priorityOrder[aVal] || 2;
            bVal = priorityOrder[bVal] || 2;
        }
        
        if (order === 'desc') {
            return bVal > aVal ? 1 : -1;
        } else {
            return aVal > bVal ? 1 : -1;
        }
    });
}

// Network status monitoring
function initializeNetworkMonitoring() {
    window.addEventListener('online', () => {
        console.log('Back online, syncing pending changes...');
        syncPendingChanges();
    });
    
    window.addEventListener('offline', () => {
        console.log('Gone offline, will cache changes locally');
        updateSyncStatus('error', 'Offline');
    });
}

// Utility functions for UI feedback
function showNotification(message, type = 'info') {
    // Simple console fallback if no notification system exists
    console.log(`[${type.toUpperCase()}] ${message}`);
    
    // Try to use existing notification system if available
    if (window.showNotification && typeof window.showNotification === 'function') {
        window.showNotification(message, type);
    }
}

function updateSyncStatus(status, message) {
    // Simple console fallback
    console.log(`Sync status: ${status} - ${message}`);
    
    // Try to use existing sync status system if available
    if (window.updateSyncStatus && typeof window.updateSyncStatus === 'function') {
        window.updateSyncStatus(status, message);
    }
}

function editTask(taskId) {
    // Simple fallback - just log for now
    console.log('Edit task:', taskId);
    
    // Try to use existing edit system if available
    if (window.editTask && typeof window.editTask === 'function') {
        window.editTask(taskId);
    } else {
        // Basic fallback: show task details in console
        const task = getTask(taskId);
        if (task) {
            console.log('Task details:', task);
        }
    }
}

// Load tasks from database
async function loadTasks() {
    if (!window.currentUser) {
        console.error('No current user when loading tasks');
        return;
    }

    setOperationLoading('load', true);

    try {
        // First try to load from localStorage as fallback
        const cachedTasks = localStorage.getItem(`brainbow_tasks_${window.currentUser.id}`);
        if (cachedTasks) {
            const parsedTasks = JSON.parse(cachedTasks);
            tasks.length = 0; // Clear array
            tasks.push(...parsedTasks);
            renderTasksNew();
            updateProjectCounts();
        }

        // Then fetch from database if online
        if (navigator.onLine) {
            const { data, error } = await supabase
                .from('tasks')
                .select('*')
                .eq('user_id', window.currentUser.id)
                .order('created_at', { ascending: false });

            if (error) {
                throw error;
            }

            // Update tasks array
            tasks.length = 0; // Clear array
            tasks.push(...(data || []));
            
            // Update UI
            renderTasksNew();
            updateProjectCounts();
            saveToLocalStorage();
            
            console.log(`Loaded ${tasks.length} tasks from database`);
            
            // Sync any pending offline changes
            await syncPendingChanges();
        }

    } catch (error) {
        console.error('Error loading tasks:', error);
        showNotification('Kunde inte ladda uppgifter', 'error');
    } finally {
        setOperationLoading('load', false);
    }
}

// Expose loadTasks globally for auth usage
window.loadTasks = loadTasks;

// Expose new render function globally
window.renderTasksNew = renderTasksNew;
console.log('tasks.js: renderTasksNew is now available globally');

// Force call the new function after a short delay to ensure DOM is ready
setTimeout(() => {
    console.log('tasks.js: Testing renderTasksNew...');
    if (typeof window.renderTasksNew === 'function' && tasks.length > 0) {
        console.log('tasks.js: Calling renderTasksNew with', tasks.length, 'tasks');
        window.renderTasksNew();
    }
}, 1500);

// Initialize network monitoring
if (typeof window !== 'undefined') {
    initializeNetworkMonitoring();
}