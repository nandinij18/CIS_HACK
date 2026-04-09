const mysql = require('mysql2/promise');

const pool = mysql.createPool(
    process.env.DATABASE_URL || {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'nandu@555777',
        database: process.env.DB_NAME || 'website_monitor',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    }
);

module.exports = pool;
