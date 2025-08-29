
// Flikväxling för huvudflikarna
window.selectTab = async function(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    showTaskLoader();
    try {
        await window.loadTasks(); // Ladda alltid tasks på flikbyte
    } catch (e) {
        console.error('Kunde inte ladda tasks vid flikbyte:', e);
    }
    if (tab === 'calendar') {
        renderTasksGroupedByDeadline();
    } else if (tab === 'journal') {
        renderTasks();
    } else if (tab === 'who') {
        renderTasksGroupedByAssignee();
    } else if (tab === 'projects') {
        await renderTasksGroupedByProject();
    } else {
        document.getElementById('task-list').innerHTML = '<li class="empty-state"><h3>Ingen vy implementerad ännu</h3></li>';
    }
// Rendera tasks grupperade per projekt, sorterade i deadline-ordning (för fliken Projekt)
function renderTasksGroupedByProject() {
    const taskList = document.getElementById('task-list');
    if (!taskList) return;
    taskList.innerHTML = '';
    if (!window.tasks || window.tasks.length === 0) {
        taskList.innerHTML = `<li class="empty-state"><h3>Inga uppgifter ännu</h3></li>`;
        return;
    }
    // Filtrera på öppna (ej completed)
    const openTasks = window.tasks.filter(task => !task.completed);
    // Gruppera på projekt
    const groups = {};
    for (const task of openTasks) {
        const key = task.project || 'Okänt projekt';
        if (!groups[key]) groups[key] = [];
        groups[key].push(task);
    }
    // Sortera projekt alfabetiskt
    const projectKeys = Object.keys(groups).sort();
        for (const projectKey of projectKeys) {
            const group = groups[projectKey];
            // Sortera gruppen på deadline (null sist)
            group.sort((a, b) => {
                if (!a.deadline && !b.deadline) return 0;
                if (!a.deadline) return 1;
                if (!b.deadline) return -1;
                return new Date(a.deadline) - new Date(b.deadline);
            });
            const groupHeader = document.createElement('li');
            groupHeader.className = 'task-group-header';
            groupHeader.textContent = projectKey;
            taskList.appendChild(groupHeader);
            for (const task of group) {
                const li = document.createElement('li');
                li.className = `task-item minimalist ${task.completed ? 'completed' : ''}`;
                li.onclick = () => editTask(task.id);
                let assigneeName = '';
                if (task.assignee) {
                    assigneeName = await window.getAssigneeName(task.assignee);
                }
                let metaParts = [];
                if (task.priority !== 'medium') metaParts.push(`Prioritet: ${task.priority}`);
                if (assigneeName) metaParts.push(escapeHtml(assigneeName));
                if (task.deadline) metaParts.unshift(new Date(task.deadline).toLocaleDateString('sv-SE'));
                li.innerHTML = `
                    <span class="task-checkbox minimalist ${task.completed ? 'completed' : ''}" onclick="event.stopPropagation(); toggleTaskComplete('${task.id}')">${task.completed ? '✓' : ''}</span>
                    <span class="task-title minimalist">${escapeHtml(task.title)}</span>
                    <span class="task-meta minimalist">${metaParts.join(' • ')}</span>
                    <span class="task-actions minimalist"><button class="task-action-btn" onclick="event.stopPropagation(); deleteTask('${task.id}')" title="Ta bort">🗑️</button></span>
                `;
                taskList.appendChild(li);
            }
        }
}
// Rendera tasks grupperade per tilldelad användare (för fliken Vem?)
function renderTasksGroupedByAssignee() {
    const taskList = document.getElementById('task-list');
    if (!taskList) return;
    taskList.innerHTML = '';
    if (!window.tasks || window.tasks.length === 0) {
        taskList.innerHTML = `<li class="empty-state"><h3>Inga uppgifter ännu</h3></li>`;
        return;
    }
    // Filtrera på öppna (ej completed)
    const openTasks = window.tasks.filter(task => !task.completed);
    // Gruppera på assignee
    const groups = {};
    for (const task of openTasks) {
        const key = task.assignee || 'Ingen tilldelad';
        if (!groups[key]) groups[key] = [];
        groups[key].push(task);
    }
    // Hämta alla unika assignee-id och hämta namn
    const assigneeIds = Object.keys(groups);
    Promise.all(assigneeIds.map(id => id !== 'Ingen tilldelad' ? getAssigneeName(id) : Promise.resolve('Ingen tilldelad')))
        .then(names => {
            const idToName = {};
            assigneeIds.forEach((id, i) => { idToName[id] = names[i]; });
            // Sortera grupper efter namn
            assigneeIds.sort((a, b) => idToName[a].localeCompare(idToName[b]));
            assigneeIds.forEach(assigneeId => {
                const group = groups[assigneeId];
                const groupHeader = document.createElement('li');
                groupHeader.className = 'task-group-header';
                groupHeader.textContent = idToName[assigneeId];
                taskList.appendChild(groupHeader);
                group.forEach(task => {
                    const li = document.createElement('li');
                    li.className = `task-item minimalist ${task.completed ? 'completed' : ''}`;
                    li.onclick = () => editTask(task.id);
                    li.innerHTML = `
                        <span class="task-checkbox minimalist ${task.completed ? 'completed' : ''}" onclick="event.stopPropagation(); toggleTaskComplete('${task.id}')">${task.completed ? '✓' : ''}</span>
                        <span class="task-title minimalist">${escapeHtml(task.title)}</span>
                        <span class="task-meta minimalist"></span>
                        <span class="task-actions minimalist"><button class="task-action-btn" onclick="event.stopPropagation(); deleteTask('${task.id}')" title="Ta bort">🗑️</button></span>
                    `;
                    taskList.appendChild(li);
                });
            });
        });
}
}

// Rendera tasks grupperade på deadline (endast för kalenderfliken)
function renderTasksGroupedByDeadline() {
    const taskList = document.getElementById('task-list');
    if (!taskList) return;
    taskList.innerHTML = '';
    if (!window.tasks || window.tasks.length === 0) {
        taskList.innerHTML = `<li class="empty-state"><h3>Inga uppgifter ännu</h3></li>`;
        return;
    }
    // Gruppera tasks på deadline (YYYY-MM-DD)
    const groups = {};
    window.tasks.forEach(task => {
        const key = task.deadline ? task.deadline : 'Ingen deadline';
        if (!groups[key]) groups[key] = [];
        groups[key].push(task);
    });
    // Sortera grupper (datum i ordning, "Ingen deadline" sist)
    const sortedKeys = Object.keys(groups).sort((a, b) => {
        if (a === 'Ingen deadline') return 1;
        if (b === 'Ingen deadline') return -1;
        return new Date(a) - new Date(b);
    });
    sortedKeys.forEach(dateKey => {
        const group = groups[dateKey];
        const dateLabel = dateKey === 'Ingen deadline' ? 'Ingen deadline' : new Date(dateKey).toLocaleDateString('sv-SE');
        const groupHeader = document.createElement('li');
        groupHeader.className = 'task-group-header';
        groupHeader.textContent = dateLabel;
        taskList.appendChild(groupHeader);
        group.forEach(async task => {
            const li = document.createElement('li');
            li.className = `task-item minimalist ${task.completed ? 'completed' : ''}`;
            li.onclick = () => editTask(task.id);
            let assigneeName = '';
            if (task.assignee) {
                assigneeName = await getAssigneeName(task.assignee);
            }
            let metaParts = [];
            if (task.priority !== 'medium') metaParts.push(`Prioritet: ${task.priority}`);
            if (assigneeName) metaParts.push(escapeHtml(assigneeName));
            if (task.deadline) metaParts.unshift(new Date(task.deadline).toLocaleDateString('sv-SE'));
            li.innerHTML = `
                <span class="task-checkbox minimalist ${task.completed ? 'completed' : ''}" onclick="event.stopPropagation(); toggleTaskComplete('${task.id}')">${task.completed ? '✓' : ''}</span>
                <span class="task-title minimalist">${escapeHtml(task.title)}</span>
                <span class="task-meta minimalist">${metaParts.join(' • ')}</span>
                <span class="task-actions minimalist"><button class="task-action-btn" onclick="event.stopPropagation(); deleteTask('${task.id}')" title="Ta bort">🗑️</button></span>
            `;
            taskList.appendChild(li);
        });
    });
}
// Right sidebar state
let currentEditingTask = null;
let isEditMode = false;

// Right sidebar functions
function openRightSidebar(taskId = null) {
    const sidebar = document.getElementById('rightSidebar');
    const overlay = document.getElementById('rightSidebarOverlay');
    const container = document.getElementById('app-container');
    const title = document.getElementById('rightSidebarTitle');
    const deleteBtn = document.getElementById('deleteTaskBtn');

    if (!sidebar || !overlay || !container) return;

    // Ladda användarlistan till assignee-dropdown
    populateAssigneeDropdown();

    if (taskId) {
        // Edit mode
        isEditMode = true;
        currentEditingTask = getTask(taskId);
        if (title) title.textContent = 'Redigera uppgift';
        if (deleteBtn) deleteBtn.style.display = 'block';
        if (currentEditingTask) loadTaskIntoSidebar(currentEditingTask);
    } else {
        // Create mode
        isEditMode = false;
        currentEditingTask = null;
        if (title) title.textContent = 'Ny uppgift';
        if (deleteBtn) deleteBtn.style.display = 'none';
        clearSidebarForm();
        // Sätt assignee till currentUser.id som default om inloggad
        setTimeout(() => {
            const assigneeSelect = document.getElementById('task-assignee');
            if (assigneeSelect && window.currentUser && window.currentUser.id) {
                assigneeSelect.value = window.currentUser.id;
            }
        }, 200);
    }
// Hämta användarlistan från Supabase och fyll assignee-dropdown
async function populateAssigneeDropdown() {
    const select = document.getElementById('task-assignee');
    if (!select) return;
    // Spara nuvarande värde om det finns
    const prevValue = select.value;
    select.innerHTML = '<option value="">Välj användare...</option>';
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('id, full_name, email');
        if (error) throw error;
        data.forEach(user => {
            const option = document.createElement('option');
            option.value = user.id;
            option.textContent = user.full_name || user.email;
            select.appendChild(option);
        });
        // Återställ tidigare värde om det finns
        if (prevValue) select.value = prevValue;
    } catch (err) {
        console.error('Kunde inte hämta användarlista:', err);
        // Fallback: visa bara "Mig själv"
        select.innerHTML = '<option value="me">Mig själv</option>';
    }
}

    sidebar.classList.add('active');
    overlay.classList.add('active');
    container.classList.add('sidebar-open');
    
    // Focus first input
    setTimeout(() => {
        const firstInput = document.getElementById('task-title');
        if (firstInput) firstInput.focus();
    }, 300);
}

function closeRightSidebar() {
    const sidebar = document.getElementById('rightSidebar');
    const overlay = document.getElementById('rightSidebarOverlay');
    const container = document.getElementById('app-container');

    if (!sidebar || !overlay || !container) return;

    sidebar.classList.remove('active');
    overlay.classList.remove('active');
    container.classList.remove('sidebar-open');
    
    // Clear form after animation
    setTimeout(() => {
        clearSidebarForm();
        currentEditingTask = null;
        isEditMode = false;
    }, 300);
}

function loadTaskIntoSidebar(task) {
    if (!task) return;
    
    const fields = [
        { id: 'task-title', value: task.title },
        { id: 'task-description', value: task.description },
        { id: 'task-project', value: task.project },
        { id: 'task-deadline', value: task.deadline },
        { id: 'task-assignee', value: task.assignee },
        { id: 'task-tags', value: task.tags }
    ];

    fields.forEach(field => {
        const element = document.getElementById(field.id);
        if (element) element.value = field.value || '';
    });
    
    // Set priority
    setPriority(task.priority || 'medium');
}

function clearSidebarForm() {
    const fields = [
        'task-title',
        'task-description', 
        'task-project',
        'task-deadline',
        'task-assignee',
        'task-tags'
    ];

    fields.forEach(fieldId => {
        const element = document.getElementById(fieldId);
        if (element) element.value = '';
    });
    
    // Reset project to work
    const projectSelect = document.getElementById('task-project');
    if (projectSelect) projectSelect.value = 'work';
    
    // Reset assignee to me
    const assigneeSelect = document.getElementById('task-assignee');
    if (assigneeSelect) assigneeSelect.value = 'me';
    
    // Reset priority to medium
    setPriority('medium');
}

function setPriority(priority) {
    document.querySelectorAll('.priority-option').forEach(option => {
        option.classList.remove('selected');
        if (option.dataset.priority === priority) {
            option.classList.add('selected');
        }
                        if (task.deadline) metaParts.unshift(new Date(task.deadline).toLocaleDateString('sv-SE'));
    });
}

function getSelectedPriority() {
    const selected = document.querySelector('.priority-option.selected');
    return selected ? selected.dataset.priority : 'medium';
}

async function saveTaskFromSidebar() {
    const title = document.getElementById('task-title');
    if (!title || !title.value.trim()) {
        alert('Titel krävs för att spara uppgiften');
        return;
    }

    let assigneeValue = getFieldValue('task-assignee');
    // Sätt alltid assignee till currentUser.id om "me" är valt
    if (assigneeValue === 'me' && window.currentUser && window.currentUser.id) {
        assigneeValue = window.currentUser.id;
    } else if (!assigneeValue || assigneeValue === '') {
        assigneeValue = null;
    }

    // Extra säkerhet: om taskData.assignee fortfarande är 'me', byt ut det
    const taskData = {
        title: title.value.trim(),
        description: getFieldValue('task-description'),
        project: getFieldValue('task-project'),
        priority: getSelectedPriority(),
        deadline: getFieldValue('task-deadline') || null,
        assignee: assigneeValue,
        tags: getFieldValue('task-tags')
    };
    if (taskData.assignee === 'me' && window.currentUser && window.currentUser.id) {
        taskData.assignee = window.currentUser.id;
    }

    try {
        if (isEditMode && currentEditingTask) {
            await updateTask(currentEditingTask.id, taskData);
        } else {
            await createTask(taskData);
        }

        renderTasks();
        updateProjectCounts();
        closeRightSidebar();
        
    } catch (error) {
        console.error('Error saving task:', error);
        alert('Fel vid sparande: ' + error.message);
    }
}

async function deleteCurrentTask() {
    if (!currentEditingTask) return;

    const success = await deleteTask(currentEditingTask.id);
    if (success) {
        closeRightSidebar();
    }
}

function getFieldValue(fieldId) {
    const element = document.getElementById(fieldId);
    return element ? element.value.trim() : '';
}

// Edit task function (called from task list)
function editTask(taskId) {
    openRightSidebar(taskId);
}

// Priority selector event handling
function initializePrioritySelector() {
    document.querySelectorAll('.priority-option').forEach(option => {
        option.addEventListener('click', function() {
            document.querySelectorAll('.priority-option').forEach(opt => 
                opt.classList.remove('selected'));
            this.classList.add('selected');
        });
    });
}

// Project selection handling
function initializeProjectSelection() {
    document.querySelectorAll('.project-item').forEach(item => {
        item.addEventListener('click', function() {
            const project = this.getAttribute('data-project');
            if (project) selectProject(project);
        });
    });
}

// User menu handling
function initializeUserMenu() {
    // Close user menu when clicking outside
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.user-menu')) {
            hideUserMenu();
        }
    });
}

// Keyboard shortcuts
function initializeKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
        // ESC to close sidebar
        if (e.key === 'Escape') {
            closeRightSidebar();
        }
        
        // Ctrl/Cmd + N to create new task
        if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
            e.preventDefault();
            openRightSidebar();
        }
        
        // Enter key in login form
        if (e.key === 'Enter') {
            const loginScreen = document.getElementById('login-screen');
            if (loginScreen && loginScreen.style.display !== 'none') {
                signin();
            }
        }
    });
}

// Form validation
function validateTaskForm() {
    const title = getFieldValue('task-title');
    
    if (!title) {
        showFormError('Titel är obligatorisk');
        return false;
    }
    
    if (title.length > 200) {
        showFormError('Titel får inte vara längre än 200 tecken');
        return false;
    }
    
    const description = getFieldValue('task-description');
    if (description.length > 1000) {
        showFormError('Beskrivning får inte vara längre än 1000 tecken');
        return false;
    }
    
    return true;
}

function showFormError(message) {
    // Create or update error message element
    let errorEl = document.getElementById('form-error');
    if (!errorEl) {
        errorEl = document.createElement('div');
        errorEl.id = 'form-error';
        errorEl.style.cssText = `
            color: #ff3b30;
            font-size: 14px;
            margin-top: 8px;
            padding: 8px 12px;
            background: #ffebee;
            border-radius: 6px;
            border: 1px solid #ffcdd2;
        `;
        
        const content = document.querySelector('.right-sidebar-content');
        if (content) content.insertBefore(errorEl, content.firstChild);
    }
    
    errorEl.textContent = message;
    
    // Remove error after 5 seconds
    setTimeout(() => {
        if (errorEl && errorEl.parentNode) {
            errorEl.parentNode.removeChild(errorEl);
        }
    }, 5000);
}

// Notification system
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.textContent = message;
    
    const colors = {
        success: { bg: '#e8f5e8', border: '#c3e6c3', text: '#2e7d2e' },
        error: { bg: '#ffebee', border: '#ffcdd2', text: '#c62828' },
        info: { bg: '#e3f2fd', border: '#bbdefb', text: '#1565c0' }
    };
    
    const color = colors[type] || colors.info;
    
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${color.bg};
        color: ${color.text};
        padding: 12px 20px;
        border-radius: 8px;
        border: 1px solid ${color.border};
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        z-index: 10000;
        max-width: 300px;
        word-wrap: break-word;
        animation: slideInFromRight 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOutToRight 0.3s ease forwards';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 4000);
}

// Add notification animations to page
function addNotificationStyles() {
    if (document.getElementById('notification-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'notification-styles';
    style.textContent = `
        @keyframes slideInFromRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOutToRight {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
    `;
    document.head.appendChild(style);
}

// Initialize all UI components
function initializeUI() {
    initializePrioritySelector();
    initializeProjectSelection();
    initializeUserMenu();
    initializeKeyboardShortcuts();
    addNotificationStyles();
}