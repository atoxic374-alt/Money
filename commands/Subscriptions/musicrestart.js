const fs = require('fs');
const { owners, emco, logChannelId, prefix, Services, price, Botsname } = require(`${process.cwd()}/settings/config`);
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js'); 
const path = require('path');

module.exports = {
    name: 'musicrestart',
    aliases: ["musicrestart"],
    async execute(client, message, args) {
        if (!owners.includes(message.author.id)) return;

        try {
            const botsData = fs.readFileSync('./settings/bots.json', 'utf8');
            const botsArray = JSON.parse(botsData);

            let totalBots = botsArray.length;
            let timePerBot = 5000; 
            let estimatedTimeInSeconds = (totalBots * timePerBot) / 1000;
            let estimatedMinutes = Math.floor(estimatedTimeInSeconds / 60);
            let estimatedSeconds = Math.round(estimatedTimeInSeconds % 60);

            message.reply(`سستم خروج **${totalBots}** بوت. سيتغرق حوالي (\`${estimatedMinutes}:${estimatedSeconds < 10 ? '0' : ''}${estimatedSeconds}\`) دقيقة تقريبًا`);

            for (const bot of botsArray) {
                const token = bot.token;
                const botClient = new Client({ intents: [GatewayIntentBits.Guilds] });

                try {
                    await botClient.login(token);
                    console.log(`Logged in as ${botClient.user.tag}`);

                    const randomNumber = generateRandomNumber();
                    await botClient.user.setUsername(`${Botsname}-${randomNumber}`);

                    const musicAvatar = path.join(process.cwd(), 'settings', 'image', 'music.png');
                    await botClient.user.setAvatar(musicAvatar);

                    const bannerPath = path.join(process.cwd(), 'settings', 'image', 'banner.png');
                    const bannerImage = fs.readFileSync(bannerPath);
                    const base64BannerImage = bannerImage.toString('base64');
                    const bannerUrl = `data:image/png;base64,${base64BannerImage}`;

                    await botClient.user.setBanner(bannerUrl); 

                } catch (error) {
                    console.error(`Error setting avatar or banner for bot with token ${token}:`, error);
                    continue;
                }

                botClient.once('ready', async () => {
                    for (const guild of botClient.guilds.cache.values()) {
                        try {
                            await guild.leave();
                            console.log(`Left guild: ${guild.name}`);
                        } catch (error) {
                            console.error(`Error leaving guild ${guild.name}:`, error);
                        }
                    }

                    await botClient.destroy();
                });
            }
        } catch (error) {
            console.error('Error reading bots data:', error);
            message.reply('حدث خطأ أثناء معالجة الأمر.');
        }
    }
};

function generateRandomNumber() {
    return Math.floor(1000 + Math.random() * 9000); 
}
