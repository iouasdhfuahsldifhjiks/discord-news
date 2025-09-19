const { Client, GatewayIntentBits, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs').promises;
require('dotenv').config({ path: path.join(__dirname, '../web/.env') });

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
    ]
});

// Планировщик
const scheduledMessages = new Map();

client.once('ready', async () => {
    console.log(`✅ Бот авторизован как ${client.user.tag}`);
    console.log(`📊 На ${client.guilds.cache.size} серверах`);

    // восстановление запланированных
    try {
        const historyPath = path.join(__dirname, '../web/data/history.json');
        await fs.access(historyPath);
        const historyData = await fs.readFile(historyPath, 'utf8');
        const history = JSON.parse(historyData || '[]');

        const now = new Date();
        for (const item of history) {
            if (item.scheduled && item.scheduledTime && !item.sent && !item.canceled) {
                const scheduledTime = new Date(item.scheduledTime);
                if (scheduledTime > now) {
                    scheduleMessage(item);
                    console.log(`↻ Восстановлено запланированное сообщение: ${item.id}`);
                }
            }
        }
    } catch {
        console.log('ℹ История сообщений не найдена, создаем новую');
    }
});

// Отправка сообщения
async function sendDiscordMessage(channelId, content, files = [], roleId = null, buttons = [], embedData = null, attachmentPosition = 'start') {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) throw new Error('Канал не найден!');
        if (!channel.isTextBased()) throw new Error('Указанный канал не является текстовым!');

        // Упоминание роли/everyone
        let roleMention = null;
        let allowedMentions = { parse: [], roles: [], users: [] };

        if (roleId === '@everyone') {
            roleMention = '@everyone';
            allowedMentions.parse.push('everyone');
        } else if (roleId) {
            roleMention = `<@&${roleId}>`;
            allowedMentions.roles = [roleId];
        }

        // Контент: если есть embed — не дублируем текст, оставляем только упоминание (если есть)
        let contentToSend = null;
        if (embedData) {
            contentToSend = roleMention || null;
        } else {
            contentToSend = (roleMention ? roleMention + ' ' : '') + (content || '');
        }

        // Вложения
        const attachments = (files || []).map(file =>
            new AttachmentBuilder(file.path, { name: file.originalname })
        );

        // Кнопки
        let components = [];
        if (buttons && buttons.length > 0) {
            const row = new ActionRowBuilder();
            buttons.forEach(btn => {
                if (btn.label && btn.url) {
                    row.addComponents(
                        new ButtonBuilder()
                            .setLabel(btn.label)
                            .setURL(btn.url)
                            .setStyle(ButtonStyle.Link)
                    );
                }
            });
            if (row.components.length > 0) components.push(row);
        }

        // Embed
        let embeds = [];
        if (embedData) {
            const embed = new EmbedBuilder();
            if (embedData.title) embed.setTitle(embedData.title);
            if (embedData.description) embed.setDescription(embedData.description);

            if (embedData.color) {
                try {
                    if (typeof embedData.color === 'string') {
                        const hex = embedData.color.replace('#', '').trim();
                        if (/^[0-9A-Fa-f]{6}$/.test(hex)) {
                            embed.setColor(parseInt(hex, 16));
                        } else {
                            const num = Number(embedData.color);
                            if (!isNaN(num)) embed.setColor(num);
                        }
                    } else if (typeof embedData.color === 'number') {
                        embed.setColor(embedData.color);
                    }
                } catch {}
            }

            if (embedData.image) embed.setImage(embedData.image);
            if (embedData.thumbnail) embed.setThumbnail(embedData.thumbnail);
            if (embedData.footer) embed.setFooter({ text: embedData.footer });
            embeds.push(embed);
        }

        // Отправка сообщения с учетом позиции вложений
        let sentMessage;
        if (attachments.length > 0 && attachmentPosition === 'end') {
            // Сначала отправляем текстовую часть, затем файлы
            const messageOptions = {
                content: contentToSend,
                components,
                embeds,
                allowedMentions
            };

            sentMessage = await channel.send(messageOptions);

            // Отправляем файлы отдельным сообщением
            await channel.send({
                files: attachments
            });
        } else {
            // Стандартная отправка (файлы в начале или нет файлов)
            const messageOptions = {
                content: contentToSend,
                files: attachments,
                components,
                embeds,
                allowedMentions
            };

            sentMessage = await channel.send(messageOptions);
        }

        return { success: true, messageId: sentMessage.id };
    } catch (error) {
        console.error('❌ Ошибка отправки сообщения:', error);
        return { success: false, error: error.message };
    }
}

// Планировщик
function scheduleMessage(messageData) {
    const { scheduledTime, channelId, content, files, roleId, buttons, embed, attachmentPosition } = messageData;
    const time = new Date(scheduledTime);
    const now = new Date();

    if (time <= now) {
        return { success: false, error: 'Время отправки должно быть в будущем!' };
    }

    const timeout = time.getTime() - now.getTime();
    if (timeout > 2147483647) {
        return { success: false, error: 'Слишком большое время планирования! Максимум 24 дня.' };
    }

    const timerId = setTimeout(async () => {
        try {
            await sendDiscordMessage(channelId, content, files, roleId, buttons, embed, attachmentPosition);
            console.log(`✅ Запланированное сообщение отправлено в канал ${channelId}`);

            try {
                const historyPath = path.join(__dirname, '../web/data/history.json');
                const historyData = await fs.readFile(historyPath, 'utf8');
                let history = JSON.parse(historyData || '[]');
                const index = history.findIndex(item => item.id === messageData.id);
                if (index !== -1) {
                    history[index].sent = true;
                    history[index].sentAt = new Date().toISOString();
                    await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
                }
            } catch (error) {
                console.error('❌ Ошибка обновления истории:', error);
            }
        } catch (error) {
            console.error('❌ Ошибка отправки запланированного сообщения:', error);
        }
    }, timeout);

    scheduledMessages.set(messageData.id, timerId);
    return { success: true, id: messageData.id };
}

function cancelScheduledMessage(messageId) {
    const timerId = scheduledMessages.get(messageId);
    if (timerId) {
        clearTimeout(timerId);
        scheduledMessages.delete(messageId);
        return true;
    }
    return false;
}

async function getGuildData(guildId) {
    try {
        const guild = await client.guilds.fetch(guildId);
        await guild.members.fetch();
        await guild.roles.fetch();
        await guild.channels.fetch();

        const channels = guild.channels.cache
            .filter(ch => ch.isTextBased() && ch.viewable)
            .map(ch => ({ id: ch.id, name: `#${ch.name}`, type: ch.type }));

        // @everyone не добавляем сюда, он есть статично на фронте
        const roles = guild.roles.cache
            .filter(role => !role.managed && role.name !== '@everyone' && !role.tags)
            .map(role => ({ id: role.id, name: role.name, color: role.hexColor }));

        return { channels, roles, guildName: guild.name };
    } catch (error) {
        console.error('❌ Ошибка получения данных сервера:', error);
        return { channels: [], roles: [], guildName: 'Unknown' };
    }
}

client.login(process.env.BOT_TOKEN);

module.exports = {
    client,
    sendDiscordMessage,
    scheduleMessage,
    cancelScheduledMessage,
    getGuildData
};