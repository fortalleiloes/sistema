
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testQuery() {
    try {
        const db = await open({
            filename: path.join(__dirname, './db/database.sqlite'),
            driver: sqlite3.Database
        });

        const query = `
            SELECT oportunidades.*, users.username as autor 
            FROM oportunidades 
            LEFT JOIN users ON oportunidades.user_id = users.id 
            ORDER BY oportunidades.created_at DESC
        `;

        console.log('Executing query...');
        const results = await db.all(query);
        console.log('Query success!');
        console.log('Results:', results);
    } catch (err) {
        console.error('Query failed:', err.message);
    }
}

testQuery();
