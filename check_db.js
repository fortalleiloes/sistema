
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function checkDb() {
    const db = await open({
        filename: path.join(__dirname, './db/database.sqlite'),
        driver: sqlite3.Database
    });

    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
    console.log('Tables:', tables.map(t => t.name));

    const oportunidades = await db.all("PRAGMA table_info(oportunidades)");
    console.log('Columns in oportunidades:', oportunidades);
}

checkDb();
