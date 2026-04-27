import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { parseLogFile } from './parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;
const LOG_FILE_PATH = path.join(__dirname, '..', '..', 'logs', 'access.log');

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer setup
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

// Serve static frontend files from 'public' directory
const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));

// Request logging middleware for debugging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.get('/api/logs/summary', async (req, res) => {
  try {
    const includeStatic = req.query.includeStatic === 'true';
    console.log(`Summary requested, includeStatic: ${includeStatic}`);
    const summary = await parseLogFile(LOG_FILE_PATH, includeStatic);
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: 'Failed to parse log file' });
  }
});

app.get('/api/logs/raw', (req, res) => {
  try {
    if (fs.existsSync(LOG_FILE_PATH)) {
      const content = fs.readFileSync(LOG_FILE_PATH, 'utf-8');
      res.send(content);
    } else {
      res.status(404).send('Log file not found');
    }
  } catch (error) {
    res.status(500).send('Failed to read log file');
  }
});

// Explicitly handle POST for analysis
app.post('/api/logs/analyze', upload.single('logFile'), async (req, res) => {
  console.log('Analyze POST request received');
  let filePath = '';
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const includeStatic = req.body.includeStatic === 'true';
    filePath = req.file.path;
    console.log(`Analyzing file: ${req.file.originalname} at ${filePath}, includeStatic: ${includeStatic}`);
    
    const summary = await parseLogFile(filePath, includeStatic);
    
    // Check if any stats were actually parsed
    if (Object.keys(summary.hourlyStats).length === 0) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(422).json({ error: 'No valid log entries found. Please check the log format.' });
    }

    const rawContent = fs.readFileSync(filePath, 'utf-8');

    fs.unlinkSync(filePath); // Cleanup
    res.json({ summary, rawContent });
  } catch (error: any) {
    console.error('Analyze error:', error);
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(500).json({ error: error.message || 'Failed to analyze file' });
  }
});

// Catch-all to serve frontend's index.html for SPA routing
app.get('*', (req, res) => {
  const indexHtml = path.join(publicPath, 'index.html');
  if (fs.existsSync(indexHtml)) {
    res.sendFile(indexHtml);
  } else {
    res.status(404).send('Static files not found. Please build the frontend and place it in the public folder.');
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
