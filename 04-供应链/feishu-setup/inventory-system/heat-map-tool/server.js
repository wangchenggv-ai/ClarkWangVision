const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3456;
const EXCEL_FILE = path.join(__dirname, 'stock.xlsx');

let workbook = null;
let mainSheet = null;

function loadExcel() {
    const XLSX = require('xlsx');
    if (!fs.existsSync(EXCEL_FILE)) {
        throw new Error('Excel file not found: ' + EXCEL_FILE);
    }
    workbook = XLSX.readFile(EXCEL_FILE);
    mainSheet = workbook.Sheets[workbook.SheetNames[0]];
    console.log('  [OK] Loaded sheet:', workbook.SheetNames[0]);
}

function saveExcel() {
    const XLSX = require('xlsx');
    XLSX.writeFile(workbook, EXCEL_FILE);
    console.log('  [OK] Saved at', new Date().toLocaleTimeString());
}

function getStockData() {
    const XLSX = require('xlsx');
    const data = XLSX.utils.sheet_to_json(mainSheet, { header: 1 });
    
    if (data.length < 3) return [];
    
    const cylValues = data[0].slice(1).map(v => parseFloat(v) || 0);
    const records = [];
    
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length === 0) continue;
        
        const sph = parseFloat(row[0]) || 0;
        
        for (let j = 1; j < row.length && j <= cylValues.length; j++) {
            records.push({
                _row: i + 1,
                _col: j + 1,
                sph: sph,
                cyl: cylValues[j - 1],
                stock: parseFloat(row[j]) || 0
            });
        }
    }
    return records;
}

function updateStockCell(sph, cyl, value) {
    const XLSX = require('xlsx');
    const data = XLSX.utils.sheet_to_json(mainSheet, { header: 1 });
    
    if (data.length < 3) return false;
    
    const cylValues = data[0].slice(1).map(v => parseFloat(v) || 0);
    const cylIdx = cylValues.findIndex(c => Math.abs(c - cyl) < 0.001);
    
    let sphRowIdx = -1;
    for (let i = 1; i < data.length; i++) {
        if (Math.abs((parseFloat(data[i][0]) || 0) - sph) < 0.001) {
            sphRowIdx = i;
            break;
        }
    }
    
    if (sphRowIdx === -1 || cylIdx === -1) return false;
    
    const colIdx = cylIdx + 1;
    mainSheet[XLSX.utils.encode_cell({ r: sphRowIdx, c: colIdx })] = { t: 'n', v: value };
    
    saveExcel();
    return true;
}

const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    if (pathname === '/' || pathname === '/index.html') {
        const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
    }

    let result;
    try {
        if (pathname === '/api/health' && req.method === 'GET') {
            result = { ok: true, auth: true, message: 'Excel connected' };

        } else if (pathname === '/api/stock' && req.method === 'GET') {
            const records = getStockData();
            result = { ok: true, records };

        } else if (pathname === '/api/stock/by-key' && req.method === 'GET') {
            const sph = parseFloat(parsed.query.sph) || 0;
            const cyl = parseFloat(parsed.query.cyl) || 0;
            const records = getStockData();
            const found = records.find(r => Math.abs(r.sph - sph) < 0.001 && Math.abs(r.cyl - cyl) < 0.001);
            if (!found) {
                result = { ok: false, error: 'Not found' };
            } else {
                result = { ok: true, sph: found.sph, cyl: found.cyl, stock: found.stock };
            }

        } else if (pathname === '/api/stock/edit' && req.method === 'POST') {
            const body = await readBody(req);
            const { sph, cyl, value } = JSON.parse(body);
            if (updateStockCell(sph, cyl, value)) {
                result = { ok: true };
            } else {
                result = { ok: false, error: 'Update failed' };
            }

        } else if (pathname === '/api/stock/out' && req.method === 'POST') {
            const body = await readBody(req);
            const { sph, cyl, qty } = JSON.parse(body);
            const records = getStockData();
            const found = records.find(r => Math.abs(r.sph - sph) < 0.001 && Math.abs(r.cyl - cyl) < 0.001);
            if (!found) {
                result = { ok: false, error: 'Not found' };
            } else {
                const newStock = Math.max(0, found.stock - qty);
                updateStockCell(sph, cyl, newStock);
                result = { ok: true, old: found.stock, new: newStock };
            }

        } else if (pathname === '/api/stock/in' && req.method === 'POST') {
            const body = await readBody(req);
            const { sph, cyl, qty } = JSON.parse(body);
            const records = getStockData();
            const found = records.find(r => Math.abs(r.sph - sph) < 0.001 && Math.abs(r.cyl - cyl) < 0.001);
            if (!found) {
                result = { ok: false, error: 'Not found' };
            } else {
                const newStock = found.stock + qty;
                updateStockCell(sph, cyl, newStock);
                result = { ok: true, old: found.stock, new: newStock };
            }

        } else {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
    } catch (err) {
        result = { ok: false, error: err.message };
        console.error('  [ERROR]', err.message);
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
});

function readBody(req) {
    return new Promise(resolve => {
        let data = '';
        req.on('data', c => data += c);
        req.on('end', () => resolve(data));
    });
}

try {
    loadExcel();
    
    server.listen(PORT, () => {
        console.log('\n  Ultra Stock Manager');
        console.log('  http://localhost:' + PORT);
        console.log('  File:', EXCEL_FILE);
        console.log('  Press Ctrl+C to stop\n');
    });
} catch (err) {
    console.error('\n  [FAILED]', err.message);
    process.exit(1);
}
