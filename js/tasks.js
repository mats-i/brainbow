
// Cache för användar-id till namn (måste ligga överallt där getAssigneeName används)
const assigneeNameCache = {};

// Global task state
let tasks = [];
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

// Utility functions
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

// Enhanced Task Management
async function loadTasks() {
    if (!currentUser) return;
    
    setOperationLoading('load', true);
    showTaskLoader();

    try {
        // Alltid försök ladda från Supabase först om online
        if (navigator.onLine) {
            const { data, error } = await supabase
                .from('tasks')
                .select('*')
                .eq('user_id', currentUser.id)
                .order('created_at', { ascending: false });

            console.log('Supabase loadTasks response:', { data, error });
            if (error) throw error;

            tasks = data || [];
            saveToLocalStorage();
            renderTasks();
            updateProjectCounts();
            console.log(`Loaded ${tasks.length} tasks successfully`);
        } else {
            // Endast om offline: ladda från localStorage
            const userTasks = localStorage.getItem(`brainbow_tasks_${currentUser.id}`);
            if (userTasks) {
                try {
                    tasks = JSON.parse(userTasks);
                    console.log(`Loaded ${tasks.length} tasks from localStorage`);
                } catch (parseError) {
                    console.error('Error parsing localStorage tasks:', parseError);
                    tasks = [];
                }
            } else {
                tasks = [];
            }
            renderTasks();
            updateProjectCounts();
            updateSyncStatus('error', 'Offline-läge');
            showNotification('Kunde inte ansluta till servern. Arbetar offline.', 'error');
        }
    } catch (error) {
        console.error('Error loading tasks from Supabase:', error);
        // Om Supabase misslyckas, ladda från localStorage
        const userTasks = localStorage.getItem(`brainbow_tasks_${currentUser.id}`);
        if (userTasks) {
            try {
                tasks = JSON.parse(userTasks);
                console.log(`Loaded ${tasks.length} tasks from localStorage (fallback)`);
            } catch (parseError) {
                console.error('Error parsing localStorage tasks:', parseError);
                tasks = [];
            }
        } else {
            tasks = [];
        }
        renderTasks();
        updateProjectCounts();
        updateSyncStatus('error', 'Offline-läge');
        showNotification('Kunde inte ansluta till servern. Arbetar offline.', 'error');
    } finally {
        setOperationLoading('load', false);
        hideTaskLoader();
    }
// Loader helpers
function showTaskLoader() {
    const taskList = document.getElementById('task-list');
    if (taskList) {
        taskList.innerHTML = '<li class="loading-state"><span>Laddar aktiviteter...</span></li>';
    }
}
function hideTaskLoader() {
    // Gör inget, renderTasks() skriver över listan
}
}

async function createTask(taskData) {
    if (!currentUser || !taskData.title?.trim()) {
        throw new Error('Titel krävs för att skapa uppgift');
    }

    const tempId = generateId();
    console.log('createTask: currentUser', currentUser);
    console.log('createTask: taskData', taskData);
    // Skicka INTE med user_id, låt RLS sätta det
    const newTask = {
        id: tempId,
        ...taskData,
        title: taskData.title?.trim(),
        completed: false,
        completed_at: null,
        created_at: new Date().toISOString()
    };
    console.log('createTask: newTask', JSON.stringify(newTask, null, 2));

    // Optimistic update - add to UI immediately
    tasks.unshift(newTask);
    renderTasks();
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
            renderTasks();
            saveToLocalStorage();
        }

        console.log('Task created successfully:', result.id);
        showNotification('Uppgift skapad', 'success');
        
        return result;

    } catch (error) {
        console.error('Error creating task:', error);
        // Lägg till pending change vid nätverksfel
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
    if (!currentUser || !taskId) {
        throw new Error('Task ID krävs för uppdatering');
    }

    const taskIndex = tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) {
        throw new Error('Uppgift hittades inte');
    }

    const originalTask = { ...tasks[taskIndex] };
    const updatedTask = { 
        ...originalTask, 
        ...updates,
        updated_at: new Date().toISOString()
    };

    // Optimistic update
    tasks[taskIndex] = updatedTask;
    renderTasks();
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
            const { data, error } = await supabase
                .from('tasks')
                .update(updates)
                .eq('id', taskId)
                .eq('user_id', currentUser.id)
                .select()
                .single();
            
            if (error) throw error;
            return data;
        });

        // Update with server response
        tasks[taskIndex] = result;
        renderTasks();
        saveToLocalStorage();

        console.log('Task updated successfully:', taskId);
        showNotification('Uppgift uppdaterad', 'success');
        
        return result;

    } catch (error) {
        console.error('Error updating task:', error);
        // Lägg till pending change vid nätverksfel
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
    if (!currentUser || !taskId) {
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
    renderTasks();
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
                .eq('user_id', currentUser.id);
                
            if (error) throw error;
        });

        console.log('Task deleted successfully:', taskId);
        showNotification('Uppgift borttagen', 'success');
        
        return true;

    } catch (error) {
        console.error('Error deleting task:', error);
        // Lägg till pending change vid nätverksfel
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
        completed: !task.completed,
        completed_at: !task.completed ? new Date().toISOString() : null
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
    if (!currentUser) return;

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
    if (!currentUser) return;
    
    try {
        localStorage.setItem(`brainbow_tasks_${currentUser.id}`, JSON.stringify(tasks));
        localStorage.setItem(`brainbow_last_sync_${currentUser.id}`, new Date().toISOString());
    } catch (error) {
        console.error('Error saving to localStorage:', error);
    }
}

function getPendingChanges() {
    if (!currentUser) return [];
    
    try {
        const pending = localStorage.getItem(`brainbow_pending_${currentUser.id}`);
        return pending ? JSON.parse(pending) : [];
    } catch (error) {
        console.error('Error reading pending changes:', error);
        return [];
    }
}

function addPendingChange(operation, id, data) {
    if (!currentUser) return;
    
    try {
        const pending = getPendingChanges();
        pending.push({
            operation,
            id,
            data,
            timestamp: new Date().toISOString()
        });
        localStorage.setItem(`brainbow_pending_${currentUser.id}`, JSON.stringify(pending));
    } catch (error) {
        console.error('Error adding pending change:', error);
    }
}

function clearPendingChanges() {
    if (!currentUser) return;
    localStorage.removeItem(`brainbow_pending_${currentUser.id}`);
}

// Utility functions (unchanged)
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function renderTasks() {
    const taskList = document.getElementById('task-list');
    if (!taskList) return;
    
    taskList.innerHTML = '';

    window.tasks = tasks;
    let filteredTasks = tasks;
    if (currentProject !== 'all') {
        filteredTasks = tasks.filter(task => task.project === currentProject);
    }

    if (filteredTasks.length === 0) {
        taskList.innerHTML = `
            <li class="empty-state">
                <h3>Inga uppgifter ännu</h3>
                <p>Skapa din första uppgift genom att klicka "+ Ny uppgift"</p>
            </li>
        `;
        return;
    }

    filteredTasks.forEach(async task => {
        const li = document.createElement('li');
        li.className = `task-item minimalist ${task.completed ? 'completed' : ''}`;
        li.onclick = () => editTask(task.id);

        // Minimalistisk rad: titel, ev. prioritet, deadline-datum, tilldelad namn
        const isOverdue = task.deadline && new Date(task.deadline) < new Date() && !task.completed;
        const deadlineText = task.deadline ? new Date(task.deadline).toLocaleDateString('sv-SE') : '';
        let assigneeName = '';
        if (task.assignee) {
            assigneeName = await getAssigneeName(task.assignee);
        }
        let metaParts = [];
        if (task.priority !== 'medium') metaParts.push(`Prioritet: ${task.priority}`);
        if (deadlineText) metaParts.push(`${deadlineText}${isOverdue ? ' (försenad)' : ''}`);
        if (assigneeName) metaParts.push(escapeHtml(assigneeName));

        li.innerHTML = `
            <span class="task-checkbox minimalist ${task.completed ? 'completed' : ''}" onclick="event.stopPropagation(); toggleTaskComplete('${task.id}')">${task.completed ? '✓' : ''}</span>
            <span class="task-title minimalist">${escapeHtml(task.title)}</span>
            <span class="task-meta minimalist">${metaParts.join(' • ')}</span>
            <span class="task-actions minimalist"><button class="task-action-btn" onclick="event.stopPropagation(); deleteTask('${task.id}')" title="Ta bort">🗑️</button></span>
        `;
        taskList.appendChild(li);
    });


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
}
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
    
    renderTasks();
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

// Initialize network monitoring
if (typeof window !== 'undefined') {
    initializeNetworkMonitoring();
}