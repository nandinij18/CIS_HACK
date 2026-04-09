const mongoose = require('mongoose');

// The Mongo URI provided by the user, injected with 'website_monitor' as the target DB name
const mongoURI = process.env.DATABASE_URL || 'mongodb+srv://nandinij955621_db_user:p6BKdjYpszpuFMPV@cluster0.tz4nmsd.mongodb.net/website_monitor?appName=Cluster0';

mongoose.connect(mongoURI)
.then(() => console.log('[MongoDB] Connected successfully!'))
.catch(err => console.error('[MongoDB] Connection error:', err));

// Define the Schema that mirrors the old SQL Table
const pageSchema = new mongoose.Schema({
    url: { type: String, required: true },
    content: { type: String }, // Holds the readable Diff strings
    raw_html: { type: String }, // Holds the massive background code
    last_checked: { type: Date, default: Date.now },
    interval_minutes: { type: Number, default: 60 },
    change_type: { type: String, default: 'Initial' },
    change_diff: { type: String }
});

// Compile into a Model
const Page = mongoose.model('Page', pageSchema);

module.exports = Page;
