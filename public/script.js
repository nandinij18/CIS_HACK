document.addEventListener('DOMContentLoaded', () => {
    fetchActiveMonitors();

    // Handle form submission
    document.getElementById('add-url-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const url = document.getElementById('urlInput').value.trim();
        const interval = document.getElementById('intervalInput').value.trim();
        const btn = document.getElementById('start-btn');
        const statusMsg = document.getElementById('status-msg');

        if (!url || !interval) return;

        try {
            btn.disabled = true;
            btn.innerText = 'Adding...';
            statusMsg.style.color = '#cbd5e1';
            statusMsg.innerText = 'Setting up monitor and fetching initial state...';

            const response = await fetch('/api/add-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, interval })
            });

            const data = await response.json();

            if (response.ok) {
                statusMsg.style.color = '#4ade80';
                statusMsg.innerText = 'Success! Website is now being monitored.';
                document.getElementById('add-url-form').reset();
                fetchActiveMonitors(); // Refresh list
            } else {
                statusMsg.style.color = '#ef4444';
                statusMsg.innerText = data.error || 'Failed to add URL';
            }
        } catch (err) {
            statusMsg.style.color = '#ef4444';
            statusMsg.innerText = 'Network error occurred.';
        } finally {
            btn.disabled = false;
            btn.innerText = 'Start Monitoring';
            setTimeout(() => { if (statusMsg.innerText.includes('Success')) statusMsg.innerText = ''; }, 3000);
        }
    });
});

async function fetchActiveMonitors() {
    const container = document.getElementById('monitors-container');
    const loader = document.getElementById('loader');
    
    loader.style.display = 'block';
    container.innerHTML = '';

    try {
        const response = await fetch('/api/monitors');
        const data = await response.json();
        
        loader.style.display = 'none';

        if (data.length === 0) {
            container.innerHTML = '<p style="color:#94a3b8;">No websites are currently being monitored.</p>';
            return;
        }

        data.forEach(item => {
            const date = new Date(item.last_checked).toLocaleString();
            let badgeClass = 'badge-none';
            if (item.change_type.includes('Major')) badgeClass = 'badge-major';
            else if (item.change_type.includes('Minor')) badgeClass = 'badge-minor';
            else if (item.change_type.includes('Initial')) badgeClass = 'badge-initial';

            const card = document.createElement('div');
            card.className = 'monitor-card';
            
            // Format nice title from URL
            let hostname = '';
            try {
                hostname = new URL(item.url).hostname;
            } catch(e) { hostname = item.url; }

            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <h3 title="${item.url}">${hostname}</h3>
                    <span class="badge ${badgeClass}">${item.change_type}</span>
                </div>
                <div class="url">${item.url}</div>
                <div style="font-size: 0.85rem; color: #cbd5e1; margin-bottom:1rem;">
                    Checking every ${item.interval_minutes} mins<br>
                    Last updated: ${date}
                </div>
                <div style="display: flex; gap: 0.5rem;">
                    <a href="history.html?url=${encodeURIComponent(item.url)}" class="btn btn-secondary" style="font-size: 0.8rem; padding: 0.5rem 1rem;">View History</a>
                    <button class="btn btn-primary" style="font-size: 0.8rem; padding: 0.5rem 1rem;" onclick="forceCheck('${item.url}')">Check Now</button>
                </div>
            `;
            container.appendChild(card);
        });

    } catch (error) {
        loader.style.display = 'none';
        container.innerHTML = '<p style="color:#ef4444;">Failed to load monitors. Please check backend connection.</p>';
        console.error(error);
    }
}

async function forceCheck(url) {
    if(!confirm(`Force an immediate check for ${url}?`)) return;
    
    try {
        const response = await fetch('/api/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        
        if(response.ok) {
            alert('Check triggered successfully!');
            fetchActiveMonitors(); // Refresh status
        } else {
            alert('Error triggering check.');
        }
    } catch(e) {
        alert('Network error.');
    }
}
