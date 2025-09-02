const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const helmet = require('helmet');
const csrf = require('csurf');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const { 
  sendDiscordMessage, 
  scheduleMessage, 
  cancelScheduledMessage, 
  getGuildData 
} = require('../bot/index');

const app = express();
const port = process.env.PORT || 30000;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "blob:", "https://cdn.discordapp.com"],
      fontSrc: ["'self'", "https://cdn.jsdelivr.net"]
    }
  }
}));

app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

const csrfProtection = csrf();

function requireAuth(req, res, next) {
  if (req.session.authenticated) return next();
  res.redirect('/login');
}

async function attachGuildData(req, res, next) {
  try {
    if (req.session.authenticated && process.env.GUILD_ID) {
      res.locals.guildData = await getGuildData(process.env.GUILD_ID);
    }
  } catch {
    res.locals.guildData = { channels: [], roles: [], guildName: 'Error' };
  }
  next();
}
app.use(attachGuildData);

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'public/uploads');
    try {
      await fs.access(uploadDir);
    } catch {
      await fs.mkdir(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|txt|zip|mp4|webm/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) cb(null, true);
    else cb(new Error('Недопустимый тип файла!'));
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/login', csrfProtection, (req, res) => {
  if (req.session.authenticated) return res.redirect('/');
  res.render('login', { csrfToken: req.csrfToken(), error: null });
});

app.post('/login', csrfProtection, async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.render('login', { csrfToken: req.csrfToken(), error: 'Введите пароль' });
  }
  try {
    const isMatch = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
    if (isMatch) {
      req.session.authenticated = true;
      res.redirect('/');
    } else {
      res.render('login', { csrfToken: req.csrfToken(), error: 'Неверный пароль' });
    }
  } catch {
    res.render('login', { csrfToken: req.csrfToken(), error: 'Ошибка сервера' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/', requireAuth, csrfProtection, async (req, res) => {
  try {
    let history = [];
    const historyPath = path.join(__dirname, 'data/history.json');
    try {
      await fs.access(historyPath);
      const historyData = await fs.readFile(historyPath, 'utf8');
      history = JSON.parse(historyData || '[]');
    } catch {
      await fs.mkdir(path.dirname(historyPath), { recursive: true });
      await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
    }
    res.render('dashboard', {
      csrfToken: req.csrfToken(),
      channels: res.locals.guildData?.channels || [],
      roles: res.locals.guildData?.roles || [],
      guildName: res.locals.guildData?.guildName || 'Discord Server',
      history: history.slice(-20).reverse()
    });
  } catch (error) {
    console.error('Ошибка загрузки dashboard:', error);
    res.status(500).send('Ошибка загрузки данных');
  }
});

app.post('/api/send-news', requireAuth, csrfProtection, upload.array('attachments'), async (req, res) => {
  try {
    const { channel, role, content, scheduledTime, buttons, embed } = req.body;
    
    // теперь требуется либо контент, либо embed
    if (!channel || (!content && !embed)) {
      return res.status(400).json({ success: false, error: 'Заполните обязательные поля' });
    }

    const files = req.files ? req.files.map(file => ({
      originalname: file.originalname,
      path: file.path,
      size: file.size,
      mimetype: file.mimetype
    })) : [];

    let buttonArray = [];
    try {
      if (buttons) {
        buttonArray = JSON.parse(buttons);
        buttonArray = buttonArray.filter(btn => 
          btn && btn.label && btn.url && btn.label.length <= 80 && btn.url.startsWith('http')
        ).slice(0, 5);
      }
    } catch {}

    // парсим embed, если пришёл
    let embedData = null;
    try {
      if (embed) embedData = JSON.parse(embed);
    } catch (err) {
      console.error("Ошибка парсинга embed:", err);
    }

    const messageData = {
      id: uuidv4(),
      channelId: channel,
      content: content || '',
      files: files,
      roleId: role || null,
      buttons: buttonArray,
      embed: embedData,
      scheduled: !!scheduledTime,
      scheduledTime: scheduledTime || new Date().toISOString(),
      createdAt: new Date().toISOString(),
      sent: !scheduledTime,
      canceled: false
    };

    const historyPath = path.join(__dirname, 'data/history.json');
    let history = [];
    try {
      const historyData = await fs.readFile(historyPath, 'utf8');
      history = JSON.parse(historyData || '[]');
    } catch {}
    history.push(messageData);
    await fs.writeFile(historyPath, JSON.stringify(history, null, 2));

    if (scheduledTime) {
      const result = scheduleMessage(messageData);
      if (result.success) {
        res.json({ success: true, message: '✅ Сообщение запланировано!', messageId: messageData.id });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } else {
      const result = await sendDiscordMessage(channel, content, files, role, buttonArray, embedData);
      if (result.success) {
        const index = history.findIndex(item => item.id === messageData.id);
        if (index !== -1) {
          history[index].sent = true;
          history[index].sentAt = new Date().toISOString();
          history[index].messageId = result.messageId;
          await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
        }
        res.json({ success: true, message: '✅ Сообщение отправлено!', messageId: result.messageId });
      } else {
        res.status(500).json({ success: false, error: result.error });
      }
    }
  } catch (error) {
    console.error('Ошибка отправки сообщения:', error);
    res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
  }
});

app.post('/api/cancel-scheduled/:id', requireAuth, csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const canceled = cancelScheduledMessage(id);
    if (canceled) {
      const historyPath = path.join(__dirname, 'data/history.json');
      const historyData = await fs.readFile(historyPath, 'utf8');
      let history = JSON.parse(historyData || '[]');
      const index = history.findIndex(item => item.id === id);
      if (index !== -1) {
        history[index].canceled = true;
        history[index].canceledAt = new Date().toISOString();
        await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
      }
      res.json({ success: true, message: 'Запланированное сообщение отменено' });
    } else {
      res.status(404).json({ success: false, message: 'Сообщение не найдено или уже отправлено' });
    }
  } catch (error) {
    console.error('Ошибка отмены сообщения:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/channels', requireAuth, async (req, res) => {
  try {
    const guildData = await getGuildData(process.env.GUILD_ID);
    res.json(guildData.channels);
  } catch {
    res.status(500).json({ error: 'Ошибка получения каналов' });
  }
});

app.get('/api/roles', requireAuth, async (req, res) => {
  try {
    const guildData = await getGuildData(process.env.GUILD_ID);
    res.json(guildData.roles);
  } catch {
    res.status(500).json({ error: 'Ошибка получения ролей' });
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  if (error.code === 'EBADCSRFTOKEN') {
    return res.status(403).send('Недействительный CSRF токен');
  }
  res.status(500).send(`Ошибка сервера: ${error.message}`);
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.listen(port, '0.0.0.0', () => {
  console.log(`🌐 Веб-панель запущена на http://localhost:${port}`);
  console.log(`🤖 Бот должен запуститься автоматически`);
});

module.exports = app;
