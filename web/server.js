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
const passport = require('./auth');
const moment = require('moment-timezone');
require('dotenv').config();

const {
    client,
    sendDiscordMessage,
    scheduleMessage,
    cancelScheduledMessage,
    getGuildData
} = require('../bot/index');

const app = express();
const port = process.env.PORT || 30000;

// Security
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
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

const csrfProtection = csrf();

// Middleware для проверки аутентификации
function requireAuth(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.redirect('/login');
}

// Middleware для проверки роли
async function checkRole(req, res, next) {
    try {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const member = await guild.members.fetch(req.user.id);
        const requiredRole = await guild.roles.fetch(process.env.REQUIRED_ROLE_ID);

        if (!requiredRole) {
            return res.status(403).render('login', {
                error: 'Требуемая роль не найдена на сервере'
            });
        }

        const hasRequiredRole = member.roles.cache.some(role =>
            role.position >= requiredRole.position
        );

        if (!hasRequiredRole) {
            req.logout(() => {
                res.redirect('/login?error=Недостаточно прав для доступа');
            });
            return;
        }

        next();
    } catch (error) {
        console.error('Ошибка проверки роли:', error);
        req.logout(() => {
            res.redirect('/login?error=Ошибка проверки прав доступа');
        });
    }
}

// guild data middleware
async function attachGuildData(req, res, next) {
    try {
        if (req.isAuthenticated() && process.env.GUILD_ID) {
            res.locals.guildData = await getGuildData(process.env.GUILD_ID);
            res.locals.user = req.user;
        }
    } catch {
        res.locals.guildData = { channels: [], roles: [], guildName: 'Error' };
    }
    next();
}
app.use(attachGuildData);

// uploads
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

// static + views
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Список поддерживаемых часовых поясов
const timezones = [
    { value: 'UTC', name: 'UTC' },
    { value: 'Europe/Moscow', name: 'Москва (UTC+3)' },
    { value: 'Europe/London', name: 'Лондон (UTC+0/UTC+1)' },
    { value: 'Europe/Berlin', name: 'Берлин (UTC+1/UTC+2)' },
    { value: 'America/New_York', name: 'Нью-Йорк (UTC-5/UTC-4)' },
    { value: 'America/Los_Angeles', name: 'Лос-Анджелес (UTC-8/UTC-7)' },
    { value: 'Asia/Tokyo', name: 'Токио (UTC+9)' },
    { value: 'Asia/Shanghai', name: 'Шанхай (UTC+8)' },
    { value: 'Australia/Sydney', name: 'Сидней (UTC+10/UTC+11)' }
];

// Routes
app.get('/login', csrfProtection, (req, res) => {
    if (req.isAuthenticated()) return res.redirect('/');
    res.render('login', {
        csrfToken: req.csrfToken(),
        error: req.query.error
    });
});

app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback',
    passport.authenticate('discord', {
        failureRedirect: '/login',
        failureMessage: true
    }),
    (req, res) => {
        res.redirect('/');
    }
);

app.get('/logout', (req, res) => {
    req.logout(() => {
        res.redirect('/login');
    });
});

app.get('/', requireAuth, checkRole, csrfProtection, async (req, res) => {
    try {
        let history = [];
        const historyPath = path.join(__dirname, 'data/history.json');
        try {
            await fs.access(historyPath);
            const historyData = await fs.readFile(historyPath, 'utf8');
            history = JSON.parse(historyData || '[]');

            // Преобразуем время в локальный часовой пояс пользователя
            history = history.map(item => {
                const userTimezone = req.user.timezone || 'UTC';
                return {
                    ...item,
                    createdAtLocal: moment(item.createdAt).tz(userTimezone).format('YYYY-MM-DD HH:mm:ss'),
                    scheduledTimeLocal: item.scheduledTime ?
                        moment(item.scheduledTime).tz(userTimezone).format('YYYY-MM-DD HH:mm:ss') : null,
                    userTimezone: userTimezone
                };
            });
        } catch {
            await fs.mkdir(path.dirname(historyPath), { recursive: true });
            await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
        }

        res.render('dashboard', {
            csrfToken: req.csrfToken(),
            channels: res.locals.guildData?.channels || [],
            roles: res.locals.guildData?.roles || [],
            guildName: res.locals.guildData?.guildName || 'Discord Server',
            history: history.slice(-20).reverse(),
            user: req.user,
            timezones: timezones
        });
    } catch (error) {
        console.error('Ошибка загрузки dashboard:', error);
        res.status(500).send('Ошибка загрузки данных');
    }
});

app.post('/api/send-news', requireAuth, checkRole, csrfProtection, upload.array('attachments'), async (req, res) => {
    try {
        const { channel, role, content, scheduledTime, buttons, embed, attachmentPosition, timezone } = req.body;

        if (!channel || (!content && !embed)) {
            return res.status(400).json({ success: false, error: 'Заполните обязательные поля' });
        }

        // Сохраняем часовой пояс пользователя
        if (timezone && req.user) {
            req.user.timezone = timezone;
            // Здесь можно сохранить часовой пояс в базе данных или сессии
        }

        // role mapping (everyone)
        let roleId = null;
        if (role === 'everyone') roleId = '@everyone';
        else if (role) roleId = role;

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
                    btn && btn.label && btn.url && btn.label.length <= 80 && /^https?:\/\//i.test(btn.url)
                ).slice(0, 5);
            }
        } catch {}

        let embedData = null;
        try {
            if (embed) embedData = JSON.parse(embed);
        } catch (err) {
            console.error('Ошибка парсинга embed:', err);
        }

        // Добавляем информацию об авторе
        const authorInfo = {
            id: req.user.id,
            username: req.user.username,
            avatar: req.user.avatar,
            discriminator: req.user.discriminator,
            timezone: timezone || 'UTC'
        };

        const messageData = {
            id: uuidv4(),
            channelId: channel,
            content: content || '',
            files,
            roleId,
            buttons: buttonArray,
            embed: embedData,
            attachmentPosition: attachmentPosition || 'start',
            scheduled: !!scheduledTime,
            scheduledTime: scheduledTime || new Date().toISOString(),
            createdAt: new Date().toISOString(),
            sent: !scheduledTime,
            canceled: false,
            author: authorInfo  // Добавляем информацию об авторе
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
            const result = await sendDiscordMessage(channel, content, files, roleId, buttonArray, embedData);
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

app.post('/api/cancel-scheduled/:id', requireAuth, checkRole, csrfProtection, async (req, res) => {
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

app.get('/api/channels', requireAuth, checkRole, async (req, res) => {
    try {
        const guildData = await getGuildData(process.env.GUILD_ID);
        res.json(guildData.channels);
    } catch {
        res.status(500).json({ error: 'Ошибка получения каналов' });
    }
});

app.get('/api/roles', requireAuth, checkRole, async (req, res) => {
    try {
        const guildData = await getGuildData(process.env.GUILD_ID);
        res.json(guildData.roles);
    } catch {
        res.status(500).json({ error: 'Ошибка получения ролей' });
    }
});

// errors
app.use((error, req, res, next) => {
    console.error(error);
    if (error.code === 'EBADCSRFTOKEN') {
        if (req.isAuthenticated()) {
            return res.status(403).render('dashboard', {
                error: 'Недействительный CSRF токен',
                csrfToken: req.csrfToken(),
                channels: res.locals.guildData?.channels || [],
                roles: res.locals.guildData?.roles || [],
                guildName: res.locals.guildData?.guildName || 'Discord Server',
                history: [],
                user: req.user
            });
        }
        return res.status(403).redirect('/login');
    }
    res.status(500).send(`Ошибка сервера: ${error.message}`);
});

// start
app.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Веб-панель запущена на http://localhost:${port}`);
    console.log(`🤖 Бот должен запуститься автоматически`);
});

module.exports = app;