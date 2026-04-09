const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const util = require('util');
const Diff = require('diff');
const db = require('./db'); // Require our database connection

// Ignore self-signed/proxy SSL errors
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
// Serve frontend static files
app.use(express.static(path.join(__dirname, '../public')));

// Store active cron timers in memory (so we can clear them if needed)
const activeTimers = {};

/**
 * Calculates similarity and returns differences between old and new text
 */
function analyzeDifference(oldText, newText) {
    if (!oldText) oldText = '';
    if (!newText) newText = '';
    
    // Using string length or simple diffing. Let's use the diff library to count changes
    const changes = Diff.diffChars(oldText, newText);
    
    let changedChars = 0;
    let totalChars = oldText.length || 1;
    
    changes.forEach((part) => {
        if (part.added || part.removed) {
            changedChars += part.value.length;
        }
    });

    const diffPercentage = (changedChars / totalChars) * 100;
    
    let changeType = 'None';
    if (diffPercentage === 0) {
        changeType = 'No Change';
    } else if (diffPercentage > 30) {
        changeType = 'Major Change';
    } else {
        changeType = 'Minor Change';
    }

    return {
        changeType,
        diffPercentage,
        changes
    };
}

/**
 * Checks a specific URL and saves a new version to the database
 */
async function checkWebsite(url, interval_minutes) {
    console.log(`[Scheduler] Checking URL: ${url}`);
    try {
        // Fetch HTML content
        const response = await axios.get(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36' },
            timeout: 10000 // Force it to give up after 10 seconds
        });
        const newContent = response.data;

        // Fetch last checked version from DB
        const [rows] = await db.execute(
            'SELECT * FROM pages WHERE url = ? ORDER BY last_checked DESC LIMIT 1',
            [url]
        );

        let oldContent = '';
        let changeType = 'Initial';

        if (rows.length > 0) {
            oldContent = rows[0].content;
            const diffResult = analyzeDifference(oldContent, newContent);
            changeType = diffResult.changeType;

            // Simple console alert
            if (changeType === 'Major Change') {
                console.log(`[ALERT] Major Change Detected for ${url}!`);
            } else if (changeType === 'Minor Change') {
                console.log(`[INFO] Minor Change for ${url}`);
            } else {
                console.log(`[INFO] No Change for ${url}`);
            }
        } else {
            console.log(`[INFO] First time checking ${url}. Marked as Initial.`);
        }

        // Insert new version into history table
        await db.execute(
            'INSERT INTO pages (url, content, last_checked, interval_minutes, change_type) VALUES (?, ?, NOW(), ?, ?)',
            [url, newContent, interval_minutes || 60, changeType]
        );

    } catch (error) {
        console.error(`[Error] Failed to check ${url}:`, error.message);
        
        // Log the error nicely in the DB history
        await db.execute(
            'INSERT INTO pages (url, content, last_checked, interval_minutes, change_type) VALUES (?, ?, NOW(), ?, ?)',
            [url, `Error: ${error.message}`, interval_minutes || 60, 'Error']
        );
    }
}

/**
 * Endpoint to add a URL for monitoring
 */
app.post('/api/add-url', async (req, res) => {
    const { url, interval } = req.body;
    
    if (!url || !interval) {
        return res.status(400).json({ error: 'URL and interval are required.' });
    }

    try {
        // First, explicitly check it now
        await checkWebsite(url, parseInt(interval, 10));

        // Schedule periodic checks in memory
        const intervalMs = parseInt(interval, 10) * 60 * 1000;
        
        if (activeTimers[url]) {
            clearInterval(activeTimers[url]);
        }
        activeTimers[url] = setInterval(() => checkWebsite(url, interval), intervalMs);

        res.json({ message: 'URL added to monitoring list and scheduled!' });
    } catch (error) {
        res.status(500).json({ error: 'An error occurred while adding the URL.' });
    }
});

/**
 * Fetch all URLs currently being monitored with their latest status
 */
app.get('/api/monitors', async (req, res) => {
    try {
        const query = `
            SELECT p1.id, p1.url, p1.last_checked, p1.change_type, p1.interval_minutes
            FROM pages p1
            INNER JOIN (
                SELECT url, MAX(last_checked) as max_date
                FROM pages
                GROUP BY url
            ) p2 ON p1.url = p2.url AND p1.last_checked = p2.max_date
            ORDER BY p1.last_checked DESC
        `;
        const [rows] = await db.execute(query);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch monitors.' });
    }
});

/**
 * Fetch full history of a specific URL
 */
app.get('/api/history', async (req, res) => {
    const url = req.query.url;
    if (!url) {
        return res.status(400).json({ error: 'URL parameter is required.' });
    }

    try {
        const [rows] = await db.execute(
            'SELECT id, url, last_checked, change_type, interval_minutes FROM pages WHERE url = ? ORDER BY last_checked DESC',
            [url]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch history.' });
    }
});

/**
 * Force check a URL right now
 */
app.post('/api/check', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL parameter is required.' });

    try {
        // Find interval
        const [rows] = await db.execute('SELECT interval_minutes FROM pages WHERE url = ? LIMIT 1', [url]);
        const interval = rows.length ? rows[0].interval_minutes : 60;
        
        await checkWebsite(url, interval);
        res.json({ message: 'Check complete!' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to manually check URL.' });
    }
});

/**
 * Boot up active schedules on restart
 */
async function restoreSchedules() {
    try {
        const [rows] = await db.execute('SELECT url, interval_minutes FROM pages GROUP BY url, interval_minutes');
        rows.forEach(row => {
            const intervalMs = row.interval_minutes * 60 * 1000;
            activeTimers[row.url] = setInterval(() => checkWebsite(row.url, row.interval_minutes), intervalMs);
            console.log(`[Init] Restored schedule for ${row.url} every ${row.interval_minutes} mins`);
        });
    } catch (err) {
        console.error('[Init] Failed to load schedules from DB. Does the table exist?', err.message);
    }
}

app.listen(PORT, async () => {
    console.log(`Server is running at http://localhost:${PORT}`);
    await restoreSchedules();
});
