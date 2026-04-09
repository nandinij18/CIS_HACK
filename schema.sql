CREATE DATABASE IF NOT EXISTS website_monitor;
USE website_monitor;

CREATE TABLE IF NOT EXISTS pages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    url VARCHAR(500) NOT NULL,
    content LONGTEXT,
    last_checked DATETIME,
    interval_minutes INT DEFAULT 60,
    change_type VARCHAR(50) DEFAULT 'Initial',
    change_diff LONGTEXT
);
