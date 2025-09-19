const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const { client } = require('../bot/index');

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((obj, done) => {
    done(null, obj);
});

passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL,
    scope: ['identify', 'guilds', 'guilds.members.read']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const member = await guild.members.fetch(profile.id);

        // Проверяем наличие требуемой роли или выше
        const requiredRole = await guild.roles.fetch(process.env.REQUIRED_ROLE_ID);
        if (!requiredRole) return done(null, false);

        const hasRequiredRole = member.roles.cache.some(role =>
            role.position >= requiredRole.position
        );

        if (!hasRequiredRole) return done(null, false);

        profile.roles = member.roles.cache;
        return done(null, profile);
    } catch (error) {
        return done(error, null);
    }
}));

module.exports = passport;