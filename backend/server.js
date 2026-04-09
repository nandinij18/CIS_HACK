require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const Diff = require('diff');
const Page = require('./db'); // Require our Mongoose model

// Ignore self-signed/proxy SSL errors
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Store active cron timers in memory (so we can clear them if needed)
const activeTimers = {};

/**
 * Calculates similarity and returns differences between old and new text
 */
function analyzeDifference(oldText, newText) {
    if (!oldText) oldText = '';
    if (!newText) newText = '';
    
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

    return { changeType, diffPercentage, changes };
}

/**
 * Checks a specific URL and saves a new version to MongoDB
 */
async function checkWebsite(url, interval_minutes) {
    console.log(`[Scheduler] Checking URL: ${url}`);
    try {
        // Fetch HTML content with timeout and user-agent
        const response = await axios.get(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36' },
            timeout: 10000 
        });
        const newContent = response.data;

        // Fetch last checked version from MongoDB
        const lastPage = await Page.findOne({ url }).sort({ last_checked: -1 });

        let oldContent = '';
        let changeType = 'Initial';

        if (lastPage) {
            oldContent = lastPage.content;
            const diffResult = analyzeDifference(oldContent, newContent);
            changeType = diffResult.changeType;

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

        // Insert new version into Mongoose model
        await Page.create({
            url,
            content: newContent,
            interval_minutes: interval_minutes || 60,
            change_type: changeType
        });

    } catch (error) {
        console.error(`[Error] Failed to check ${url}:`, error.message);
        
        await Page.create({
            url,
            content: `Error: ${error.message}`,
            interval_minutes: interval_minutes || 60,
            change_type: 'Error'
        });
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
        await checkWebsite(url, parseInt(interval, 10));

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
 * Fetch all URLs currently being monitored using Mongo Aggregation
 */
app.get('/api/monitors', async (req, res) => {
    try {
        const rows = await Page.aggregate([
            { $sort: { last_checked: -1 } },
            { 
                $group: {
                    _id: "$url",
                    url: { $first: "$url" },
                    last_checked: { $first: "$last_checked" },
                    change_type: { $first: "$change_type" },
                    interval_minutes: { $first: "$interval_minutes" }
                }
            },
            { $sort: { last_checked: -1 } }
        ]);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch monitors.', details: error.message });
    }
});

/**
 * Fetch full history of a specific URL
 */
app.get('/api/history', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'URL parameter is required.' });

    try {
        const rows = await Page.find({ url })
            .select('url last_checked change_type interval_minutes')
            .sort({ last_checked: -1 });
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
        const page = await Page.findOne({ url }).select('interval_minutes');
        const interval = page ? page.interval_minutes : 60;
        
        await checkWebsite(url, interval);
        res.json({ message: 'Check complete!' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to manually check URL.' });
    }
});

/**
 * Boot up active schedules on restart using Mongo Aggregation
 */
async function restoreSchedules() {
    try {
        const pages = await Page.aggregate([
            { $group: { _id: "$url", interval_minutes: { $first: "$interval_minutes" } } }
        ]);
        
        pages.forEach(row => {
            if (!row._id) return;
            const url = row._id;
            const interval_minutes = row.interval_minutes || 60;
            const intervalMs = interval_minutes * 60 * 1000;
            
            activeTimers[url] = setInterval(() => checkWebsite(url, interval_minutes), intervalMs);
            console.log(`[Init] Restored schedule for ${url} every ${interval_minutes} mins`);
        });
    } catch (err) {
        console.error('[Init] Failed to load schedules from MongoDB.', err.message);
    }
}

app.listen(PORT, async () => {
    console.log(`Server is running at http://localhost:${PORT}`);
    // Wait slightly to ensure DB connection is active before restoring
    setTimeout(restoreSchedules, 2000); 
});
