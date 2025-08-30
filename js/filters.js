// Filter management for Brainbow
// Handles creation, saving, loading, and applying user filters via Supabase

// List of filters in memory
let userFilters = [];

// Fetch filters from Supabase for current user
async function loadUserFilters() {
    if (!window.currentUser) return [];
    const { data, error } = await supabase
        .from('filters')
        .select('*')
        .eq('user_id', window.currentUser.id)
        .order('created_at', { ascending: true });
    if (error) {
        console.error('Kunde inte ladda filter:', error);
        return [];
    }
    userFilters = data || [];
    renderFilterList();
    return userFilters;
}

// Save a filter to Supabase
async function saveUserFilter(filter) {
    if (!window.currentUser) return;
    filter.user_id = window.currentUser.id;
    const { data, error } = await supabase
        .from('filters')
        .upsert([filter], { onConflict: ['id'] });
    if (error) {
        console.error('Kunde inte spara filter:', error);
        return;
    }
    await loadUserFilters();
}

// Delete a filter
async function deleteUserFilter(filterId) {
    if (!window.currentUser) return;
    const { error } = await supabase
        .from('filters')
        .delete()
        .eq('id', filterId)
        .eq('user_id', window.currentUser.id);
    if (error) {
        console.error('Kunde inte ta bort filter:', error);
        return;
    }
    await loadUserFilters();
}

// Render filter list in sidebar
function renderFilterList() {
    const filterList = document.getElementById('filter-list');
    if (!filterList) return;
    filterList.innerHTML = '';
    userFilters.forEach(filter => {
        const li = document.createElement('li');
        li.className = 'filter-item sidebar-list-item';
        li.style.display = 'flex';
        li.style.alignItems = 'center';
        li.style.gap = '0.5em';
        li.style.cursor = 'pointer';
        li.innerHTML = `<span class="icon"><i class="fa-solid fa-filter" aria-hidden="true"></i></span><span class="name">${filter.name}</span>`;
        li.onclick = () => applyUserFilter(filter);
        filterList.appendChild(li);
    });
}

// Apply a filter to the task list
function applyUserFilter(filter) {
    // This function should update the task list based on filter criteria
    // (project, assignee, date, status, priority, tags, groupby, sortby)
        // (project, assignee, date, status, priority, tags, groupby, sortby)
    window.activeUserFilter = filter;
    // Anropa endast renderTasks om tasks är laddade
    if (window.tasks && Array.isArray(window.tasks)) {
        renderTasks();
    }
}

// Expose globally
window.loadUserFilters = loadUserFilters;
window.saveUserFilter = saveUserFilter;
window.deleteUserFilter = deleteUserFilter;
window.applyUserFilter = applyUserFilter;
window.renderFilterList = renderFilterList;
window.userFilters = userFilters;
